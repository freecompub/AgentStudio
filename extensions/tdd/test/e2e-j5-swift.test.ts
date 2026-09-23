/**
 * Critères de sortie de J5 (§14) : `/tdd` sur un projet Swift, usage affiché par état.
 * Vraie chaîne SwiftPM + XCTest, agents scriptés. Sauté si aucune chaîne Swift n'est disponible.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { createSwiftAdapter, findLocalSwiftToolchain } from "@agent-studio/stack-adapters";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TddState } from "../src/index.js";
import { assemble, git, phaseOf, planner, put, ROLE, shutdownHosts, until } from "./support/harness.js";

const toolchain = findLocalSwiftToolchain();

const CAP_TEST = `import XCTest
@testable import Domain

final class CapTests: XCTestCase {
  func testCapsDoseAboveMax() { XCTAssertEqual(cap(12.5, max: 10), 10) }
}
`;
const CAP_SRC = "public func cap(_ dose: Double, max: Double) -> Double { Swift.min(dose, max) }\n";

async function createSwiftProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-studio-swift-tdd-"));
  await put(root, ".gitignore", ".build\n");
  await put(
    root,
    "Package.swift",
    `// swift-tools-version:5.9
import PackageDescription
let package = Package(name: "Bolus", targets: [.target(name: "Domain"), .testTarget(name: "DomainTests", dependencies: ["Domain"])])
`,
  );
  await put(root, "Sources/Domain/Bolus.swift", "public struct Bolus { public let units: Double; public init(units: Double) { self.units = units } }\n");
  await put(root, "Tests/DomainTests/BolusTests.swift", "import XCTest\n@testable import Domain\n\nfinal class BolusTests: XCTestCase {\n  func testUnits() { XCTAssertEqual(Bolus(units: 2).units, 2) }\n}\n");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-qm", "init"], { cwd: root });
  return root;
}

/** Binôme Swift : test, run_tests (rouge : symbole manquant), code, run_tests (vert). */
function swiftPair(root: string): ScriptedBehavior {
  return async (t) => {
    t.session.emit({ type: "usage", model: "gpt-5", inputTokens: 3000, outputTokens: 400, multiplier: 1 });
    await put(root, "Tests/DomainTests/CapTests.swift", CAP_TEST);
    await t.callTool("run_tests", {});
    await put(root, "Sources/Domain/Cap.swift", CAP_SRC);
    await t.callTool("run_tests", {});
    await t.callTool("report_phase", { summary: "plafonnement de la dose", files: ["Tests/DomainTests/CapTests.swift", "Sources/Domain/Cap.swift"] });
  };
}

describe.skipIf(!toolchain)("Extension tdd — critères de sortie de J5 (Swift)", () => {
  let root: string;
  let tasksDir: string;
  beforeEach(async () => {
    root = await createSwiftProject();
    tasksDir = await mkdtemp(join(tmpdir(), "agent-studio-tasks-"));
  });
  afterEach(async () => {
    await shutdownHosts();
    await rm(root, { recursive: true, force: true });
    await rm(tasksDir, { recursive: true, force: true });
  });

  it("/tdd déroule un cycle sur un projet Swift : rouge (symbole manquant) puis vert, preuves et usage par état", async () => {
    const runtime = new ScriptedRuntime()
      .behave(ROLE("tdd-planner"), async (t) => {
        t.session.emit({ type: "usage", model: "gpt-5", inputTokens: 900, outputTokens: 60, multiplier: 1 });
        await planner([{ id: "s1", behavior: "plafonne une dose au-dessus du maximum" }])(t);
      })
      .behave(ROLE("tdd-pair"), swiftPair(root));
    const app = await assemble(root, runtime, tasksDir, "in-process", { stack: createSwiftAdapter({ toolchain: toolchain! }) });

    await app.registry.command("tdd")!.handler("Plafonner la dose proposée");
    await until(async () => (await app.interactions.pending()).length === 1);
    const [review] = await app.interactions.pending();
    await app.interactions.respond(review!.id, "approve");
    const [task] = await app.engine.list();
    await app.engine.idle(task!.id);

    expect(phaseOf(await app.engine.status(task!.id))).toBe("DONE");
    const evidence = (await app.evidence.list(task!.id)).filter((e) => e.source === "run_tests");
    expect(evidence.map((e) => [e.counts.failed > 0, e.failing[0]?.failureKind ?? null])).toEqual([
      [true, "missing_symbol"],
      [false, null],
    ]);
    expect(evidence[0]?.failing[0]?.id).toBe("Tests/DomainTests/CapTests.swift");
    expect(git(root, "log", "--format=%s", "-2")).toBe(
      ["feat: plafonne une dose au-dessus du maximum", "test: plafonne une dose au-dessus du maximum"].join("\n"),
    );

    // Usage par état : requêtes et tokens des agents, durée des effets.
    const usage = await app.usage.report(task!.id);
    const row = (p: string) => usage.find((r) => r.phase === p);
    expect(row("PLANNING")).toMatchObject({ requests: 1, inputTokens: 900, outputTokens: 60 });
    expect(row("CYCLE")).toMatchObject({ requests: 1, inputTokens: 3000, outputTokens: 400 });
    expect(row("CYCLE")!.durationMs).toBeGreaterThan(0);
    expect(row("CYCLE_VERIFY")!.effects).toBe(1);
    expect((await app.engine.status(task!.id))!.state as TddState).toMatchObject({ retries: {} });
  }, 600_000);
});
