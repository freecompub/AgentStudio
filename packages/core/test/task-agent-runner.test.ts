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
});
