import { afterEach, describe, expect, it, vi } from "vitest";
import { createTaskAgentRunner, type TaskAgentSpec } from "../src/agents/task-agent-runner.js";
import { ScriptedRuntime } from "../src/testing/scripted-runtime.js";
import { EnvFailureError, TurnTimeoutError, WorkDefectError } from "../src/turns/run-turn.js";

const TEST_AGENT: TaskAgentSpec = { role: "tdd-test", systemPrompt: "Tu écris un test.", writable: ["tests/**"], output: "report_phase" };
const PLANNER: TaskAgentSpec = { role: "tdd-planner", systemPrompt: "Tu planifies.", writable: [], output: "submit_plan" };

function setup(idleMs = 1_000) {
  const runtime = new ScriptedRuntime();
  const runner = createTaskAgentRunner({ runtime, root: "/projets/demo", idleMs });
  return { runtime, runner };
}

describe("Exécuteur d'agent de tâche", () => {
  afterEach(() => vi.useRealTimers());

  it("session neuve configurée pour le rôle ; la sortie de l'outil terminal est renvoyée, validée", async () => {
    const { runtime, runner } = setup();
    runtime.behave("tdd-test", async (t) => {
      await t.callTool("report_phase", { summary: "test écrit", files: ["tests/a.test.ts"] });
    });
    const r = await runner.run(TEST_AGENT, "Comportement : x");

    expect(r.output).toEqual({ summary: "test écrit", files: ["tests/a.test.ts"] });
    const cfg = runtime.configs.get("fake-1")!;
    expect(cfg.role).toBe("tdd-test");
    expect(cfg.systemPrompt).toContain("Tu écris un test.");
    expect(cfg.workingDirectory).toBe("/projets/demo");
    expect(cfg.tools.map((t) => [t.name, t.terminal])).toEqual([["report_phase", true]]);
    expect(await cfg.guard.check({ kind: "write", toolName: "edit", path: "src/a.ts" })).toMatchObject({ decision: "deny" });
    expect(runtime.last.sent).toEqual(["Comportement : x"]);
  });

  it("la session est fermée puis supprimée (éphémère), même en cas d'échec", async () => {
    const { runtime, runner } = setup();
    runtime.behave("tdd-test", async () => {
      throw new Error("quota épuisé");
    });
    await expect(runner.run(TEST_AGENT, "x")).rejects.toBeInstanceOf(EnvFailureError);
    expect(runtime.deleted).toEqual(["fake-1"]);
  });

  it("outil terminal oublié : une seule relance ciblée, puis WorkDefectError", async () => {
    const { runtime, runner } = setup();
    let turns = 0;
    runtime.behave("tdd-test", () => void turns++);
    await expect(runner.run(TEST_AGENT, "x")).rejects.toBeInstanceOf(WorkDefectError);
    expect(turns).toBe(2);
    expect(runtime.last.sent[1]).toMatch(/report_phase/);
  });

  it("outil terminal appelé à la relance : succès", async () => {
    const { runtime, runner } = setup();
    let turn = 0;
    runtime.behave("tdd-planner", async (t) => {
      if (++turn === 2) await t.callTool("submit_plan", { steps: [{ id: "s1", behavior: "b" }] });
    });
    expect((await runner.run(PLANNER, "F")).output).toEqual({ steps: [{ id: "s1", behavior: "b" }] });
  });

  it("arguments invalides : le handler refuse (le modèle peut corriger) et rien n'est retenu", async () => {
    const { runtime, runner } = setup();
    const errors: string[] = [];
    runtime.behave("tdd-planner", async (t) => {
      await t.callTool("submit_plan", { steps: "pas une liste" }).catch((e: Error) => errors.push(e.message));
      await t.callTool("submit_plan", { steps: [{ id: "s1", behavior: "ok" }] });
    });
    expect((await runner.run(PLANNER, "F")).output).toEqual({ steps: [{ id: "s1", behavior: "ok" }] });
    expect(errors[0]).toMatch(/invalides/);
  });

  it("agent muet : TurnTimeoutError après abort", async () => {
    vi.useFakeTimers();
    const { runtime, runner } = setup(1_000);
    runtime.behave("tdd-test", (t) => t.hang());
    const p = runner.run(TEST_AGENT, "x").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await p).toBeInstanceOf(TurnTimeoutError);
  });

  it("annulation : la session est interrompue", async () => {
    const { runtime, runner } = setup(60_000);
    runtime.behave("tdd-test", (t) => t.hang());
    const ac = new AbortController();
    const p = runner.run(TEST_AGENT, "x", { signal: ac.signal }).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 0));
    ac.abort();
    expect(await p).toBeInstanceOf(Error);
    expect(runtime.sessions.size).toBe(0);
  });

  it("outils supplémentaires : exposés à l'agent, leur battement réarme le watchdog", async () => {
    vi.useFakeTimers();
    const { runtime, runner } = setup(1_000);
    runtime.behave("tdd-test", async (t) => {
      await t.callTool("run_tests", {});
      await t.callTool("report_phase", { summary: "ok", files: [] });
    });
    const p = runner.run(TEST_AGENT, "x", {
      tools: (beat) => [
        {
          name: "run_tests",
          description: "Lance les tests",
          parameters: { type: "object", properties: {} },
          handler: async () => {
            for (let i = 0; i < 5; i++) {
              await new Promise((r) => setTimeout(r, 900));
              beat();
            }
            return "vert";
          },
        },
      ],
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await p).output).toEqual({ summary: "ok", files: [] });
    expect(runtime.configs.get("fake-1")?.tools.map((t) => t.name)).toEqual(["report_phase", "run_tests"]);
  });

  it("gardes supplémentaires : appliquées après la garde du rôle, le premier refus l'emporte", async () => {
    const { runtime, runner } = setup();
    runtime.behave("tdd-test", async (t) => void (await t.callTool("report_phase", { summary: "ok", files: [] })));
    await runner.run(TEST_AGENT, "x", { guards: [{ check: async () => ({ decision: "deny", reason: "tests gelés" }) }] });
    const guard = runtime.configs.get("fake-1")!.guard;
    expect(await guard.check({ kind: "write", toolName: "edit", path: "tests/a.ts" })).toEqual({ decision: "deny", reason: "tests gelés" });
    expect(await guard.check({ kind: "write", toolName: "edit", path: "src/a.ts" })).toMatchObject({ decision: "deny", reason: expect.stringMatching(/périmètre/) });
  });

  it("usage : une requête par tour (× multiplicateur), tokens cumulés, relance comprise", async () => {
    const { runtime, runner } = setup();
    let turn = 0;
    runtime.behave("tdd-planner", async (t) => {
      t.session.emit({ type: "usage", model: "m", inputTokens: 100, outputTokens: 10, multiplier: 2 });
      t.session.emit({ type: "usage", model: "m", inputTokens: 50, outputTokens: 5, multiplier: 2 });
      if (++turn === 2) await t.callTool("submit_plan", { steps: [] });
    });
    const usage: unknown[] = [];
    await runner.run(PLANNER, "F", { onUsage: (u) => usage.push(u) });
    expect(usage).toEqual([
      { requests: 2, inputTokens: 150, outputTokens: 15 },
      { requests: 2, inputTokens: 150, outputTokens: 15 },
    ]);
  });

  it("report_blocker : le rôle qui le déclare peut suspendre sa tâche avec une question", async () => {
    const { runtime, runner } = setup();
    runtime.behave("tdd-test", async (t) => void (await t.callTool("report_blocker", { question: "Plafond par prise ou par jour ?", choices: ["par prise", "par jour"] })));
    const r = await runner.run({ ...TEST_AGENT, blocker: true }, "x");
    expect(r).toEqual({ blocker: { question: "Plafond par prise ou par jour ?", choices: ["par prise", "par jour"] } });
    expect(runtime.configs.get("fake-1")?.tools.map((t) => t.name)).toEqual(["report_phase", "report_blocker"]);
  });

  it("verdict de lentille : enum unique, défauts à schéma", async () => {
    const { runtime, runner } = setup();
    const errors: string[] = [];
    runtime.behave("lens", async (t) => {
      await t.callTool("submit_lens_verdict", { lens: "cold-reader", verdict: "NEEDS_REWORK", defects: [] }).catch((e: Error) => errors.push(e.message));
      await t.callTool("submit_lens_verdict", { lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [{ severity: "major", description: "MaxBolus accepte une valeur négative", file: "Sources/Domain/MaxBolus.swift", line: 4 }] });
    });
    const r = await runner.run({ role: "lens", systemPrompt: "Relis.", writable: [], output: "submit_lens_verdict" }, "x");
    expect(errors[0]).toMatch(/invalides/);
    expect(r.output).toEqual({ lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [{ severity: "major", description: "MaxBolus accepte une valeur négative", file: "Sources/Domain/MaxBolus.swift", line: 4 }] });
  });
});
