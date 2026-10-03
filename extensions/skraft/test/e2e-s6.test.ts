/**
 * Critères de sortie de S6 (SPEC-skraft §14) :
 *  - bout en bout 13.3 vert sur le projet Swift de démonstration (vraie chaîne SwiftPM + XCTest ;
 *    mutation simulée, Muter n'existant pas sous Linux) ;
 *  - verdict reproductible depuis les mêmes JSON ;
 *  - mesures d'usage par état sur trois stories (agents simulés).
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { createSwiftAdapter, findLocalSwiftToolchain, type StackAdapter } from "@agent-studio/stack-adapters";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { replayReview } from "../src/review.js";
import {
  answerQuestions,
  assemble,
  createProject,
  git,
  put,
  researchDoc,
  shutdownHosts,
  simulatedAgents,
  stateOf,
  unitTestWriter,
  until,
} from "./support/harness.js";
import { ACCEPTANCE, createSwiftProject, POLICY, STUB, UNIT_TEST } from "./support/swift-demo.js";

const toolchain = findLocalSwiftToolchain();

const ADR = {
  title: "Plafond appliqué dans le domaine",
  status: "Proposed",
  context: "La dose proposée peut dépasser le plafond défini par le médecin.",
  decision: "`BolusCapPolicy` applique le plafond dans le module Domain.",
  consequences: "L'interface affiche l'alerte produite par le domaine.",
  alternatives: "Plafonner dans l'interface : rejeté.",
};

type App = Awaited<ReturnType<typeof assemble>>;

/** Répond au fil de l'eau : difficulté confirmée, questions ouvertes (PO), ratification (architecte). */
function humans(app: App): void {
  answerQuestions(app);
  const done = new Set<string>();
  const tick = async () => {
    for (const p of await app.interactions.pending()) {
      if (done.has(p.id)) continue;
      if (p.title.startsWith("Difficulté")) {
        done.add(p.id);
        await app.interactions.respond(p.id, p.options[0]!.id);
      } else if (p.title.startsWith("Ratifier")) {
        done.add(p.id);
        await app.interactions.respond(p.id, p.options.find((o) => o.id.startsWith("accept:"))!.id, undefined, { role: "architecte" });
      }
    }
  };
  app.interactions.onChange(() => void tick());
  void tick();
}

describe.skipIf(!toolchain)("skraft — bout en bout 13.3 (Swift)", () => {
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

  it("US-12 : un rejet par porte, question tranchée, ADR ratifié, test protégé, défaut major corrigé, DONE avec bilan", async () => {
    const calls: Record<string, string[]> = {};
    const record = (role: string, behavior: ScriptedBehavior): ScriptedBehavior => async (t) => {
      (calls[role] ??= []).push(t.prompt);
      await behavior(t);
    };
    const n = (role: string) => calls[role]?.length ?? 0;
    const probes: unknown[] = [];

    const runtime = simulatedAgents(
      new ScriptedRuntime(),
      root,
      {
        // RESEARCH : citation hors du fichier au premier essai.
        "skraft-researcher": record("researcher", async (t) => {
          const bad = n("researcher") === 1;
          await put(root, ".skraft/us-12/research/research.md", researchDoc(bad ? { Découvertes: "Le calcul vit dans `Sources/Domain/BolusCalculator.swift:40-72`." } : {}));
          await t.callTool("report_phase", { summary: "recherche", files: [] });
        }),
        "skraft-architect-model": record("model", async (t) => {
          await put(root, ".skraft/us-12/design/event-model.md", "Commande `CapBolus` → événement `BolusCapped`.\n");
          await put(root, ".skraft/us-12/design/domain-model.md", "Objet-valeur `MaxBolus`, politique `BolusCapPolicy`.\n");
          await t.callTool("report_phase", { summary: "modèle", files: [] });
        }),
        // DESIGN : nom d'événement incohérent au premier essai ; ADR rédigé par render_adr.
        "skraft-architect-decide": record("decide", async (t) => {
          await put(root, ".skraft/us-12/design/contracts.md", n("decide") === 1 ? "`CapBolus` produit `BolusLimited`.\n" : "`CapBolus` produit `BolusCapped`.\n");
          await t.callTool("render_adr", ADR);
          await t.callTool("report_phase", { summary: "décisions", files: [] });
        }),
        // DISTILL : « 12 U » au lieu de « 12,5 U » au premier essai ; scénario 3 requalifié.
        "skraft-acceptance": record("acceptance", async (t) => {
          const criteria = [...t.prompt.matchAll(/^\s+(\d+)\. (.+)$/gm)].map((m) => ({ n: m[1]!, text: m[2]! }));
          const text = (c: { text: string }) => (n("acceptance") === 1 ? c.text.replace("12,5 U", "12 U") : c.text);
          await put(root, ".skraft/us-12/distill/features/plafond.feature", `Fonctionnalité: plafond\n\n${criteria.map((c) => `  @ac-${c.n}\n  Scénario: critère ${c.n}\n    Alors ${text(c)}\n`).join("\n")}`);
          await put(root, ".skraft/us-12/distill/test-plan.md", "# Plan de test\n- @ac-3 : role: regression — justification : le comportement « aucun plafond » existe déjà.\n");
          await put(root, ".skraft/us-12/distill/impl-plan.md", "1. @ac-1 : politique de plafond\n2. @ac-2 : alerte\n");
          await put(root, "Sources/Domain/BolusCap.swift", STUB);
          await put(root, "Tests/AcceptanceTests/BolusCapAcceptanceTests.swift", ACCEPTANCE);
          await t.callTool("report_phase", { summary: "scénarios", files: [] });
        }),
        "skraft-test": record("test", async (t) => {
          await put(root, "Tests/DomainTests/BolusCapPolicyTests.swift", UNIT_TEST);
          await t.callTool("run_tests", {});
          await t.callTool("report_phase", { summary: "test", files: [] });
        }),
        // DELIVER : tentative de modification du test (refusée, puis détectée) ; correction de revue.
        "skraft-dev": record("dev", async (t) => {
          if (t.prompt.includes("corrige les défauts de revue")) {
            await put(root, "Sources/Domain/BolusCap.swift", (await readFile(join(root, "Sources/Domain/BolusCap.swift"), "utf8")).replace("self.units = units", "self.units = Swift.max(0, units)"));
          } else {
            if (n("dev") === 1) {
              probes.push(await t.config.guard.check({ kind: "write", toolName: "edit", path: "Tests/DomainTests/BolusCapPolicyTests.swift" }));
              await put(root, "Tests/DomainTests/BolusCapPolicyTests.swift", UNIT_TEST.replace(/XCTAssertEqual\(.*\)/, "XCTAssertTrue(true)"));
            }
            await put(root, "Sources/Domain/BolusCapPolicy.swift", POLICY);
            await put(root, "Sources/Domain/BolusCap.swift", STUB.replace("CappedDose(units: 0, alert: nil) }", "BolusCapPolicy(max: max).apply(calcul) }"));
          }
          await t.callTool("run_tests", {});
          await t.callTool("report_phase", { summary: "code", files: [] });
        }),
        // Revue de DELIVER : défaut major au premier passage.
        "skraft-lens-cold-reader": record("cold-reader", async (t) => {
          const firstDeliver = t.prompt.startsWith("Revue de la phase DELIVER.") && !calls["cold-reader"]!.slice(0, -1).some((p) => p.startsWith("Revue de la phase DELIVER."));
          await t.callTool("submit_lens_verdict", {
            lens: "cold-reader",
            verdict: firstDeliver ? "CHANGES_REQUESTED" : "APPROVED",
            defects: firstDeliver ? [{ severity: "major", description: "`MaxBolus` accepte une valeur négative", file: "Sources/Domain/BolusCap.swift", line: 3 }] : [],
          });
        }),
        "skraft-lens-test-integrity": record("test-integrity", async (t) => void (await t.callTool("submit_lens_verdict", { lens: "test-integrity", verdict: "APPROVED", defects: [] }))),
      },
      { usage: true },
    );
    const swift = createSwiftAdapter({ toolchain: toolchain! });
    const mutation = { runs: 0 };
    const stack: StackAdapter = {
      ...swift,
      mutation: async () => {
        mutation.runs++;
        return { score: 100, files: ["Sources/Domain/BolusCapPolicy.swift", "Sources/Domain/BolusCap.swift"].map((file) => ({ file, score: 100, survived: [] })) };
      },
    };
    const app = await assemble(root, runtime, tasksDir, { stack });
    humans(app);
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;
    await until(async () => ["DONE", "ESCALATED", "ABORTED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 540_000);

    const s = stateOf(await app.engine.status(id))!;
    expect(s.lastRejection).toBeNull();
    expect(s.stage).toBe("DONE");
    expect(s.difficulty).toMatchObject({ level: "medium-hard", confirmedBy: "user" });
    expect(s.phasesCompleted).toEqual(["RESEARCH", "DESIGN", "DISTILL", "DELIVER"]);

    // Un rejet par porte, avec le motif précis transmis au réessai.
    expect(calls.researcher![1]).toContain("`Sources/Domain/BolusCalculator.swift:40-72` : plage hors du fichier, qui compte 4 lignes.");
    expect(calls.decide![1]).toContain("`BolusLimited` cité dans contracts.md n'existe pas dans event-model.md ni dans domain-model.md.");
    expect(calls.acceptance![1]).toContain("La valeur « 12,5 U » du critère 2 n'apparaît pas dans le scénario @ac-2");
    expect(s.openQuestions.find((q) => q.text.includes("par prise ou par jour"))?.answer).toBe("par prise");
    expect(s.adrs).toEqual([expect.objectContaining({ id: "ADR-001", status: "Accepted", decisionBy: "user" })]);
    expect(s.regressions).toEqual(["Tests/AcceptanceTests/BolusCapAcceptanceTests.swift > AcceptanceTests.BolusCapAcceptanceTests/testAc3AucunPlafond"]);

    // DELIVER : test protégé par la garde et par l'empreinte ; défaut major corrigé par une relance ciblée.
    expect(probes).toEqual([{ decision: "deny", reason: expect.any(String) }]);
    expect(calls.dev![1]).toContain("Les tests unitaires ont été modifiés pendant le pas de code");
    const fixPrompt = calls.dev!.find((p) => p.includes("corrige les défauts de revue"))!;
    expect(fixPrompt).toContain("[cold-reader, major] `MaxBolus` accepte une valeur négative (Sources/Domain/BolusCap.swift:3)");
    expect(s.reviews.DELIVER.map((r) => r.verdict)).toEqual(["CHANGES_REQUESTED", "APPROVED"]);
    expect(await readFile(join(root, "Sources/Domain/BolusCap.swift"), "utf8")).toContain("Swift.max(0, units)");
    expect(mutation.runs).toBe(2);

    // Lentilles : faits pour test-integrity, aucun contexte du producteur pour cold-reader.
    const lastIntegrity = calls["test-integrity"]!.at(-1)!;
    expect(lastIntegrity).toContain("Faits établis par le code (acquis : ne les revérifie pas) :");
    expect(lastIntegrity).toMatch(/Scénario ac-1 : test d'acceptance vert .*tests unitaires ajoutés, chacun rouge puis vert dans les preuves : Tests\/DomainTests\/BolusCapPolicyTests.swift/);
    expect(lastIntegrity).toContain("Règle de dépendance respectée");
    expect(calls["cold-reader"]!.at(-1)).not.toContain("Faits établis");
    expect(calls["cold-reader"]!.at(-1)).not.toContain("par prise");

    // Verdict reproductible depuis les JSON commités, y compris ceux d'une revue suivie d'un rollback.
    for (const [i, review] of s.reviews.DELIVER.entries()) {
      const json = git(root, "show", `HEAD:.skraft/us-12/reviews/deliver-review-${i + 1}.json`);
      const replay = replayReview("DELIVER", i + 1, json);
      expect(replay.verdict).toBe(review.verdict);
      expect(replay.markdown.trim()).toBe(git(root, "show", `HEAD:.skraft/us-12/reviews/deliver-review-${i + 1}.md`)); // git() rogne la fin de ligne
    }

    // Bilan : réessais par phase ; usage par état (D37).
    expect(s.retries).toEqual({ RESEARCH: 1, DESIGN: 1, DISTILL: 1, DELIVER: 2 });
    // Le compteur que le moteur lit pour tracer chaque rejet : la somme des réessais, toutes phases.
    expect(s.rejections).toBe(5);
    expect(app.posted.at(-1)).toContain("Réessais par phase : RESEARCH 1, DESIGN 1, DISTILL 1, DELIVER 2.");
    const usage = await app.usage.report(id);
    for (const phase of ["CLASSIFY", "RESEARCH", "DESIGN", "DISTILL", "DELIVER", "REVIEW"]) expect(usage.find((r) => r.phase === phase)?.requests, phase).toBeGreaterThan(0);
    const log = git(root, "log", "--format=%s", `${s.baseSha}..HEAD`).split("\n");
    expect(log).toEqual([
      "feat(us-12): livraison de la story",
      "fix(us-12): correction de revue",
      "feat(us-12): ac-1",
      "test(us-12): ac-1, Tests/DomainTests/BolusCapPolicyTests.swift",
      "docs(skraft): distill de us-12",
      "docs(skraft): design de us-12",
      "docs(skraft): research de us-12",
    ]);
  }, 600_000);
});

describe("skraft — mesures d'usage sur trois stories (§12)", () => {
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

  it("US-7 (simple), US-12 (assez difficile), US-15 (difficile) : requêtes et tokens par état, réessais, granularité", async () => {
    const measures: Record<string, { level: string; granularity: string; phases: Record<string, number>; retries: Record<string, number> }> = {};
    for (const story of ["us-7", "us-12", "us-15"]) {
      git(root, "checkout", "-q", "main");
      const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-test": unitTestWriter(root) }, { usage: true });
      const app = await assemble(root, runtime, tasksDir);
      humans(app);
      await app.registry.command("skraft")!.handler(`stories/${story}.md`);
      await until(async () => (await app.engine.list()).some((t) => stateOf(t)?.storyPath === `stories/${story}.md`));
      const id = (await app.engine.list()).find((t) => stateOf(t)?.storyPath === `stories/${story}.md`)!.id;
      await until(async () => ["DONE", "ESCALATED", "ABORTED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 60_000);
      const s = stateOf(await app.engine.status(id))!;
      expect(`${s.stage} ${JSON.stringify(s.escalation)} ${JSON.stringify(s.lastRejection)}`, story).toBe("DONE null null");
      const usage = await app.usage.report(id);
      measures[story] = {
        level: s.difficulty!.level,
        granularity: s.deliver!.granularity,
        phases: Object.fromEntries(usage.filter((r) => r.requests > 0).map((r) => [r.phase, r.requests])),
        retries: s.retries ?? {},
      };
      for (const r of usage.filter((x) => x.requests > 0)) expect(r.inputTokens, `${story} ${r.phase}`).toBeGreaterThan(0);
      await shutdownHosts();
      // Chaque story repart de main : on retire le code livré par la précédente.
      git(root, "checkout", "-q", "main");
      git(root, "clean", "-qfd");
    }
    expect(measures["us-7"]).toMatchObject({ level: "simple", granularity: "turn-per-scenario" });
    expect(measures["us-7"]!.phases.RESEARCH).toBeUndefined();
    expect(measures["us-12"]).toMatchObject({ level: "medium-hard", granularity: "turn-per-scenario" });
    expect(measures["us-15"]).toMatchObject({ level: "challenging", granularity: "session-per-step" });
    // Sessions séparées : plus de requêtes en DELIVER que le tour unique, pour un scénario moteur chacun.
    expect(measures["us-15"]!.phases.DELIVER!).toBeGreaterThan(measures["us-12"]!.phases.DELIVER!);
    expect(Object.keys(measures["us-12"]!.phases)).toEqual(expect.arrayContaining(["CLASSIFY", "RESEARCH", "DESIGN", "DISTILL", "DELIVER", "REVIEW"]));
  }, 180_000);
});

