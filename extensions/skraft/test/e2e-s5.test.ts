/**
 * Critères de sortie de S5 (SPEC-skraft §14) : US-12 livrée sur le projet Swift de démonstration ;
 * modification de test refusée par la garde, puis détectée par empreinte quand elle passe par un
 * autre chemin (tour annulé par rollback). Vraie chaîne SwiftPM + XCTest ; sauté sans chaîne Swift.
 * Muter n'existe pas pour Linux : la mutation est une doublure qui renvoie un rapport au format de l'adaptateur.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { createSwiftAdapter, findLocalSwiftToolchain, type MutationReport, type StackAdapter } from "@agent-studio/stack-adapters";
import { createJsonEvidenceStore } from "@agent-studio/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, fakeSwiftStack, git, put, shutdownHosts, simulatedAgents, stateOf, unitTestWriter, until } from "./support/harness.js";

const toolchain = findLocalSwiftToolchain();

const PACKAGE = `// swift-tools-version:5.9
import PackageDescription
let package = Package(name: "Bolus", targets: [
  .target(name: "Domain"),
  .target(name: "Settings", dependencies: ["Domain"]),
  .testTarget(name: "DomainTests", dependencies: ["Domain"]),
  .testTarget(name: "AcceptanceTests", dependencies: ["Domain"]),
])
`;

const CALCULATOR = `public struct BolusCalculator {
  public init() {}
  public func propose(calcul: Double) -> Double { calcul }
}
`;

/** Signatures minimales écrites en DISTILL pour que les tests d'acceptance compilent (§7.3). */
const STUB = `public struct MaxBolus: Equatable {
  public let units: Double
  public init(units: Double) { self.units = units }
}

public struct CappedDose: Equatable {
  public let units: Double
  public let alert: String?
  public init(units: Double, alert: String?) { self.units = units; self.alert = alert }
}

extension BolusCalculator {
  public func propose(calcul: Double, max: MaxBolus) -> CappedDose { CappedDose(units: 0, alert: nil) }
}
`;

const ACCEPTANCE = `import XCTest
@testable import Domain

final class BolusCapAcceptanceTests: XCTestCase {
  // ac-1 : plafond de 10 U, calcul à 6 U
  func testAc1DoseSousLePlafond() {
    XCTAssertEqual(BolusCalculator().propose(calcul: 6, max: MaxBolus(units: 10)), CappedDose(units: 6, alert: nil))
  }

  // ac-2 : plafond de 10 U, calcul à 12,5 U
  func testAc2DosePlafonnee() {
    XCTAssertEqual(BolusCalculator().propose(calcul: 12.5, max: MaxBolus(units: 10)), CappedDose(units: 10, alert: "Dose plafonnée à 10 U"))
  }

  // ac-3 : aucun plafond configuré
  func testAc3AucunPlafond() {
    XCTAssertEqual(BolusCalculator().propose(calcul: 7), 7)
  }
}
`;

const UNIT_TEST = `import XCTest
@testable import Domain

final class BolusCapPolicyTests: XCTestCase {
  func testKeepsDoseUnderMax() {
    XCTAssertEqual(BolusCapPolicy(max: MaxBolus(units: 10)).apply(6), CappedDose(units: 6, alert: nil))
  }
}
`;

const POLICY = `public struct BolusCapPolicy {
  public let max: MaxBolus

  public init(max: MaxBolus) { self.max = max }

  public func apply(_ dose: Double) -> CappedDose {
    guard dose > max.units else { return CappedDose(units: dose, alert: nil) }
    return CappedDose(units: max.units, alert: "Dose plafonnée à \\(Int(max.units)) U")
  }
}
`;

async function createSwiftProject(): Promise<string> {
  const root = await createProject();
  await put(root, ".gitignore", ".build\n");
  await put(root, "Package.swift", PACKAGE);
  await put(root, "Sources/Domain/BolusCalculator.swift", CALCULATOR);
  await put(root, "Tests/DomainTests/BolusCalculatorTests.swift", "import XCTest\n@testable import Domain\n\nfinal class BolusCalculatorTests: XCTestCase {\n  func testProposesCalculatedDose() { XCTAssertEqual(BolusCalculator().propose(calcul: 7), 7) }\n}\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "projet Swift");
  return root;
}

describe.skipIf(!toolchain)("skraft — critères de sortie de S5 (DELIVER, Swift)", () => {
  let root: string;
  let tasksDir: string;
  beforeEach(async () => {
    root = await createSwiftProject();
    tasksDir = await mkdtemp(join(tmpdir(), "agent-studio-skraft-tasks-"));
  });
  afterEach(async () => {
    await shutdownHosts();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(tasksDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("US-12 livrée en TDD ; écriture d'un test refusée par la garde, modification détectée par empreinte et annulée", async () => {
    const devPrompts: string[] = [];
    const probes: unknown[] = [];
    const acceptance: ScriptedBehavior = async (t) => {
      const criteria = [...t.prompt.matchAll(/^\s+(\d+)\. (.+)$/gm)].map((m) => ({ n: m[1]!, text: m[2]! }));
      await put(root, ".skraft/us-12/distill/features/plafond.feature", `Fonctionnalité: plafond\n\n${criteria.map((c) => `  @ac-${c.n}\n  Scénario: critère ${c.n}\n    Alors ${c.text}\n`).join("\n")}`);
      await put(root, ".skraft/us-12/distill/test-plan.md", "# Plan de test\n- @ac-3 : role: regression — justification : le comportement « aucun plafond » existe déjà.\n");
      await put(root, ".skraft/us-12/distill/impl-plan.md", "1. @ac-1 : politique de plafond\n2. @ac-2 : alerte\n");
      await put(root, "Sources/Domain/BolusCap.swift", STUB);
      await put(root, "Tests/AcceptanceTests/BolusCapAcceptanceTests.swift", ACCEPTANCE);
      await t.callTool("report_phase", { summary: "scénarios et tests d'acceptance", files: [] });
    };
    const tester: ScriptedBehavior = async (t) => {
      await put(root, "Tests/DomainTests/BolusCapPolicyTests.swift", UNIT_TEST);
      await t.callTool("run_tests", {});
      await t.callTool("report_phase", { summary: "test de la politique", files: [] });
    };
    const dev: ScriptedBehavior = async (t) => {
      devPrompts.push(t.prompt);
      if (devPrompts.length === 1) {
        // 1. Écrire un test : refusé par la garde.
        probes.push(await t.config.guard.check({ kind: "write", toolName: "edit", path: "Tests/DomainTests/BolusCapPolicyTests.swift" }));
        // 2. Autre chemin (hors outils) : le test est affaibli ; l'empreinte le détectera.
        await put(root, "Tests/DomainTests/BolusCapPolicyTests.swift", UNIT_TEST.replace(/XCTAssertEqual\(.*\)/, "XCTAssertTrue(true)"));
      }
      await put(root, "Sources/Domain/BolusCapPolicy.swift", POLICY);
      await put(root, "Sources/Domain/BolusCap.swift", STUB.replace("CappedDose(units: 0, alert: nil) }", "BolusCapPolicy(max: max).apply(calcul) }"));
      await t.callTool("run_tests", {});
      await t.callTool("report_phase", { summary: "politique de plafond", files: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-acceptance": acceptance, "skraft-test": tester, "skraft-dev": dev });

    const mutationRuns: string[] = [];
    const swift = createSwiftAdapter({ toolchain: toolchain! });
    const stack: StackAdapter = {
      ...swift,
      mutation: async (): Promise<MutationReport> => {
        mutationRuns.push("muter");
        return { score: 100, files: [{ file: "Sources/Domain/BolusCapPolicy.swift", score: 100, survived: [] }] };
      },
    };
    const app = await assemble(root, runtime, tasksDir, { stack });
    answerQuestions(app);
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    await app.interactions.respond((await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!.id, "medium-hard");
    const id = (await app.engine.list())[0]!.id;
    await until(async () => ["DONE", "ESCALATED", "ABORTED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 540_000);

    const s = stateOf(await app.engine.status(id))!;
    expect(s.lastRejection).toBeNull();
    expect(s.stage).toBe("DONE");
    expect(s.phasesCompleted).toEqual(["RESEARCH", "DESIGN", "DISTILL", "DELIVER"]);
    expect(s.deliver?.granularity).toBe("turn-per-scenario");
    expect(s.deliver?.scenarios.map((x) => [x.id, x.role, x.status])).toEqual([
      ["ac-1", "driver", "done"],
      ["ac-2", "driver", "done"],
      ["ac-3", "regression", "done"],
    ]);

    // Garde : l'agent dev ne peut pas écrire un test.
    expect(probes).toEqual([{ decision: "deny", reason: expect.any(String) }]);
    // Empreinte : la modification hors outils est détectée, le tour annulé et relancé avec le motif.
    expect(devPrompts).toHaveLength(2);
    expect(devPrompts[1]).toContain("Les tests unitaires ont été modifiés pendant le pas de code");
    expect(await readFile(join(root, "Tests/DomainTests/BolusCapPolicyTests.swift"), "utf8")).toBe(UNIT_TEST);
    expect(git(root, "log", "-p", "--format=", `${s.baseSha}..HEAD`, "--", "Tests/DomainTests/BolusCapPolicyTests.swift")).not.toContain("XCTAssertTrue(true)");

    // Preuves : rouge du test unitaire (symbole manquant) puis vert, porte de fin de scénario verte.
    const evidence = await createJsonEvidenceStore(join(tasksDir, "evidence")).list(id);
    const red = evidence.find((e) => e.phase === "DELIVER_RED");
    expect(red?.failing).toEqual([expect.objectContaining({ id: "Tests/DomainTests/BolusCapPolicyTests.swift", failureKind: "missing_symbol" })]);
    const gate = evidence.filter((e) => e.phase === "DELIVER_SCENARIO");
    expect(gate.map((e) => [e.stepId, e.counts.failed])).toEqual([
      ["ac-1", 0],
      ["ac-2", 0],
    ]);
    expect(gate[0]!.testIds).toContain("Tests/DomainTests/BolusCapPolicyTests.swift > DomainTests.BolusCapPolicyTests/testKeepsDoseUnderMax");
    expect(mutationRuns).toHaveLength(1);

    // Historique : test rouge, code vert, livraison.
    const log = git(root, "log", "--format=%s", `${s.baseSha}..HEAD`).split("\n");
    expect(log.slice(0, 3)).toEqual(["feat(us-12): livraison de la story", "feat(us-12): ac-1", "test(us-12): ac-1, Tests/DomainTests/BolusCapPolicyTests.swift"]);
  }, 600_000);
});

describe("skraft — porte de fin de scénario (pile simulée)", () => {
  let root: string;
  let tasksDir: string;
  beforeEach(async () => {
    root = await createProject();
    tasksDir = await mkdtemp(join(tmpdir(), "agent-studio-skraft-tasks-"));
  });
  afterEach(async () => {
    await shutdownHosts();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(tasksDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("mutation sous le seuil du domaine : scénario refusé avec les survivants, repris en sessions séparées, puis livré", async () => {
    const roles: string[] = [];
    const testPrompts: string[] = [];
    const writeTest = unitTestWriter(root);
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-test": async (t) => {
        testPrompts.push(t.prompt);
        await writeTest(t);
      },
    });
    let mutation = 0;
    const stack: StackAdapter = {
      ...fakeSwiftStack(),
      mutation: async () => {
        mutation++;
        const survived = mutation === 1 ? [{ line: 1, operator: "RemoveSideEffects" }] : [];
        return { score: mutation === 1 ? 50 : 100, files: [{ file: "Sources/Domain/BolusCap.swift", score: mutation === 1 ? 50 : 100, survived }] };
      },
      architecture: async () => ({ modules: [{ name: "Domain", imports: [] }], violations: [] }),
    };
    const app = await assemble(root, runtime, tasksDir, { stack });
    answerQuestions(app);
    await app.registry.command("skraft")!.handler("--auto stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;
    await until(async () => ["DONE", "ESCALATED", "ABORTED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 60_000);
    for (const h of runtime.history) roles.push(runtime.configs.get(h.id)!.role.split("/")[1]!);

    const s = stateOf(await app.engine.status(id))!;
    expect(s.stage).toBe("DONE");
    expect(testPrompts).toHaveLength(2);
    expect(testPrompts[1]).toContain("Mutation : Sources/Domain/BolusCap.swift à 50 % (minimum 100 %) ; mutants survivants : ligne 1 (RemoveSideEffects).");
    expect(s.deliver?.granularity).toBe("session-per-step");
    expect(s.deliver?.notes).toEqual(["Scénario ac-1 : repris en sessions séparées après un échec."]);
    // Après la reprise : sessions séparées pour le vert puis le nettoyage.
    const deliverRoles = roles.filter((r) => r === "skraft-test" || r === "skraft-dev");
    expect(deliverRoles).toEqual(["skraft-test", "skraft-dev", "skraft-test", "skraft-dev", "skraft-dev"]);
    expect(mutation).toBe(2);
  }, 90_000);
});
