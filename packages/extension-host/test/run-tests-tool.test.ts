import { createHookRegistry, createInteractionService, createRegistry, createTaskAgentRunner } from "@agent-studio/core";
import { fixedClock, MemoryEvidenceStore, MemoryInteractionStore, RecordingCheckpoints, ScriptedRuntime, sequentialIds } from "@agent-studio/core/testing";
import type { ExtensionContext, ExtensionManifest } from "@agent-studio/extension-api";
import type { StackAdapter, TestRun } from "@agent-studio/stack-adapters";
import { createTaskEngine, MemoryTaskStore } from "@agent-studio/task-engine";
import type { Workspace } from "@agent-studio/workspace";
import { describe, expect, it } from "vitest";
import { activateInProcess } from "../src/in-process-host.js";
import { summarizeRun } from "../src/test-runs.js";

const MANIFEST: ExtensionManifest = {
  id: "diabeo.demo",
  version: "0.1.0",
  publisher: "diabeo",
  engines: { appApi: "^0.1" },
  permissions: ["fs:read", "fs:write:src/**", "fs:write:tests/**", "copilot:sessions", "shell:test"],
  contributes: {
    agents: [{ name: "pair", title: "Binôme", role: "Tu fais tout le cycle.", output: "report_phase", write: ["src/**", "tests/**"], tools: ["run_tests"] }],
  },
};

const RED: TestRun = {
  results: [
    { id: "tests/a.test.ts > ok", file: "tests/a.test.ts", status: "passed" },
    { id: "tests/a.test.ts > nouveau", file: "tests/a.test.ts", status: "failed", failureKind: "assertion", message: "AssertionError: expected 1 to be 2\n  at x" },
  ],
  exitCode: 1,
  timedOut: false,
  output: "",
  durationMs: 5,
};
const GREEN: TestRun = { ...RED, results: RED.results.map((r) => ({ id: r.id, file: r.file, status: "passed" as const })), exitCode: 0 };

async function setup(runs: TestRun[], manifest = MANIFEST) {
  const runtime = new ScriptedRuntime();
  const evidence = new MemoryEvidenceStore();
  const queue = [...runs];
  const outputs: string[] = [];
  const stack: StackAdapter = {
    id: "typescript",
    detect: async () => true,
    isTestFile: (p) => p.startsWith("tests/"),
    testFilePattern: "^tests/",
    runTests: async (opts) => {
      opts.onOutput?.("ligne\n");
      outputs.push("run");
      return queue.shift() ?? GREEN;
    },
  };
  const workspace: Workspace = {
    root: "/projets/demo",
    files: { read: async () => "contenu", write: async () => {}, list: async () => ["tests/a.test.ts", "src/a.ts"] },
    checkpoints: { create: async (l) => ({ id: "cp", sha: "", head: "", label: l, createdAt: "" }), list: async () => [], diff: async () => ({ files: [], patch: "" }), rollback: async () => {} },
    repo: { head: async () => "abc123", commit: async () => null, sync: async () => ({ pulled: 0, pushed: 0 }), switchBranch: async () => {} },
  };
  const engine = createTaskEngine({ store: new MemoryTaskStore(), checkpoints: new RecordingCheckpoints(), clock: fixedClock(), ids: sequentialIds("t") });
  let ctx!: ExtensionContext;
  await activateInProcess(
    { manifest, module: { activate: (c) => void (ctx = c) } },
    {
      registry: createRegistry(),
      engine,
      agents: createTaskAgentRunner({ runtime, root: workspace.root, idleMs: 60_000 }),
      workspace,
      stack,
      interactions: createInteractionService({ store: new MemoryInteractionStore(), clock: fixedClock(), ids: sequentialIds("i"), deliver: async () => {} }),
      evidence,
      hooks: createHookRegistry(),
      chat: { post: () => {} },
      clock: fixedClock(),
      ids: sequentialIds("ev-"),
    },
  );
  return { ctx, runtime, evidence, outputs };
}

describe("Outil run_tests et preuves (D20)", () => {
  it("l'agent qui déclare run_tests reçoit l'outil ; chaque exécution est une preuve produite par le code", async () => {
    const { ctx, runtime, evidence } = await setup([RED, GREEN]);
    const replies: unknown[] = [];
    runtime.behave("diabeo.demo/pair", async (t) => {
      replies.push(await t.callTool("run_tests", {}));
      replies.push(await t.callTool("run_tests", {}));
      await t.callTool("report_phase", { summary: "cycle fait", files: [] });
    });
    await ctx.agents.run("pair", "Comportement", { evidence: { taskId: "t1", stepId: "s1", phase: "CYCLE" } });

    expect(replies[0]).toContain("1 réussi(s), 1 en échec");
    expect(replies[0]).toContain("tests/a.test.ts > nouveau [assertion] AssertionError: expected 1 to be 2");
    const list = await evidence.list("t1");
    expect(list.map((e) => [e.source, e.stepId, e.phase, e.counts.failed])).toEqual([
      ["run_tests", "s1", "CYCLE", 1],
      ["run_tests", "s1", "CYCLE", 0],
    ]);
    expect(list[0]).toMatchObject({ head: "abc123", testIds: ["tests/a.test.ts > ok", "tests/a.test.ts > nouveau"], at: "2026-09-23T10:00:00.000Z" });
    expect(list[0]?.testsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await ctx.evidence.list("t1")).toHaveLength(2);
  });

  it("les exécutions des portes sont aussi des preuves (source « gate ») ; sans étiquette, aucune preuve", async () => {
    const { ctx, evidence } = await setup([RED, GREEN]);
    await ctx.stack.runTests({ evidence: { taskId: "t1", stepId: "s1", phase: "RED" } });
    await ctx.stack.runTests();
    expect((await evidence.list("t1")).map((e) => [e.source, e.phase])).toEqual([["gate", "RED"]]);
  });

  it("gel pendant le tour : après une exécution rouge, écrire un test est refusé, le code reste permis", async () => {
    const { ctx, runtime } = await setup([RED]);
    const decisions: unknown[] = [];
    runtime.behave("diabeo.demo/pair", async (t) => {
      decisions.push(await t.config.guard.check({ kind: "write", toolName: "edit", path: "tests/a.test.ts" }));
      await t.callTool("run_tests", {});
      decisions.push(await t.config.guard.check({ kind: "write", toolName: "edit", path: "/projets/demo/tests/a.test.ts" }));
      decisions.push(await t.config.guard.check({ kind: "write", toolName: "edit", path: "src/a.ts" }));
      await t.callTool("report_phase", { summary: "ok", files: [] });
    });
    await ctx.agents.run("pair", "x", { freezeTestsAfterRed: true });
    expect(decisions).toEqual([
      { decision: "allow" },
      { decision: "deny", reason: expect.stringMatching(/gelés/) },
      { decision: "allow" },
    ]);
  });

  it("sans gel demandé, les tests restent modifiables", async () => {
    const { ctx, runtime } = await setup([RED]);
    let after: unknown;
    runtime.behave("diabeo.demo/pair", async (t) => {
      await t.callTool("run_tests", {});
      after = await t.config.guard.check({ kind: "write", toolName: "edit", path: "tests/a.test.ts" });
      await t.callTool("report_phase", { summary: "ok", files: [] });
    });
    await ctx.agents.run("pair", "x");
    expect(after).toEqual({ decision: "allow" });
  });

  it("un agent sans run_tests déclaré n'a pas l'outil ; run_tests sans shell:test fait échouer l'activation", async () => {
    const noTool: ExtensionManifest = { ...MANIFEST, contributes: { agents: [{ ...MANIFEST.contributes.agents![0]!, tools: [] }] } };
    const { ctx, runtime } = await setup([], noTool);
    runtime.behave("diabeo.demo/pair", async (t) => void (await t.callTool("report_phase", { summary: "ok", files: [] })));
    await ctx.agents.run("pair", "x");
    expect(runtime.configs.get("fake-1")?.tools.map((t) => t.name)).toEqual(["report_phase"]);

    const noPerm: ExtensionManifest = { ...MANIFEST, permissions: MANIFEST.permissions.filter((p) => p !== "shell:test") };
    await expect(setup([], noPerm)).rejects.toThrow(/shell:test/);
  });

  it("résumé d'un dépassement de délai", () => {
    expect(summarizeRun({ ...RED, timedOut: true })).toMatch(/délai/);
  });
});
