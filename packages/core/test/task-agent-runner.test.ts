import { afterEach, describe, expect, it, vi } from "vitest";
import { createTaskAgentRunner, type TaskAgentSpec } from "../src/agents/task-agent-runner.js";
import { ScriptedRuntime } from "../src/testing/scripted-runtime.js";
import { EnvFailureError, TurnBudgetError, TurnCostError, TurnTimeoutError, WorkDefectError } from "../src/turns/run-turn.js";

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

/**
 * Reprise d'une session après un tour interrompu (ADR 0030).
 *
 * Le 28/09, le modèle a cessé de répondre après 1 h 55 de travail. Le réducteur a relancé, et la
 * relance a ouvert une **session neuve** : tout le contexte accumulé — dépôt lu, fichiers analysés —
 * était à repayer. `resumeSession` existait pourtant déjà sur le port, utilisée par la seule
 * conversation humaine.
 *
 * La reprise ne vaut pas pour toutes les causes, et c'est le cœur de la règle :
 *   - le modèle n'a pas répondu, ou l'agent s'est tu → le contexte va bien, on reprend ;
 *   - c'est NOUS qui avons coupé pour cause de durée ou de coût → le contexte EST le problème.
 *     Reprendre renverrait le même contexte énorme et retaperait le plafond dans la seconde.
 */
describe("Reprise de session après interruption", () => {
  const CLE = { resumeKey: "t1/tdd-test" };
  const finir: Parameters<ScriptedRuntime["behave"]>[1] = async (t) => {
    await t.callTool("report_phase", { summary: "fini", files: [] });
  };

  it("le modèle ne répond plus : le tour suivant reprend la même session, pas une neuve", async () => {
    const { runtime, runner } = setup();
    runtime.behave("tdd-test", async () => {
      throw new Error("Failed to get response from the AI model");
    });
    await expect(runner.run(TEST_AGENT, "x", CLE)).rejects.toBeInstanceOf(EnvFailureError);
    const interrompue = runtime.history.at(-1)!.id;

    runtime.behave("tdd-test", finir);
    await runner.run(TEST_AGENT, "reprends", CLE);
    expect(runtime.history.at(-1)!.id).toBe(interrompue);
  });

  it("une session reprise n'est pas supprimée entre les deux tours : sinon il n'y aurait rien à reprendre", async () => {
    const { runtime, runner } = setup();
    runtime.behave("tdd-test", async () => {
      throw new Error("Failed to get response from the AI model");
    });
    await expect(runner.run(TEST_AGENT, "x", CLE)).rejects.toBeInstanceOf(EnvFailureError);
    expect(runtime.deleted).toEqual([]);
  });

  it("silence de l'agent : même règle, le contexte n'est pas en cause", async () => {
    vi.useFakeTimers();
    const { runtime, runner } = setup();
    runtime.behave("tdd-test", (t) => t.hang()); // l'agent ne rend jamais la main
    const echec = runner.run(TEST_AGENT, "x", CLE).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await echec).toBeInstanceOf(TurnTimeoutError);
    const interrompue = runtime.history.at(-1)!.id;

    vi.useRealTimers();
    runtime.behave("tdd-test", finir);
    await runner.run(TEST_AGENT, "reprends", CLE);
    expect(runtime.history.at(-1)!.id).toBe(interrompue);
  });

  it("plafond de coût atteint : session NEUVE — reprendre renverrait le contexte qui a causé la coupure", async () => {
    const runtime = new ScriptedRuntime();
    const runner = createTaskAgentRunner({ runtime, root: "/projets/demo", idleMs: 60_000, maxInputTokens: 1_000 });
    runtime.behave("tdd-test", (t) => {
      t.session.emit({ type: "usage", inputTokens: 5_000 });
      t.hang();
    });
    await expect(runner.run(TEST_AGENT, "x", CLE)).rejects.toBeInstanceOf(TurnCostError);
    const coupee = runtime.history.at(-1)!.id;
    expect(runtime.deleted).toContain(coupee);

    runtime.behave("tdd-test", finir);
    await runner.run(TEST_AGENT, "encore", CLE);
    expect(runtime.history.at(-1)!.id).not.toBe(coupee);
  });

  it("plafond de durée atteint : session neuve également", async () => {
    vi.useFakeTimers();
    const runtime = new ScriptedRuntime();
    const runner = createTaskAgentRunner({ runtime, root: "/projets/demo", idleMs: 60_000, maxMs: 2_000 });
    // Seuil d'inactivité très haut : seul le plafond de durée peut couper ce tour.
    runtime.behave("tdd-test", (t) => t.hang());
    const echec = runner.run(TEST_AGENT, "x", CLE).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(await echec).toBeInstanceOf(TurnBudgetError);
    const coupee = runtime.history.at(-1)!.id;
    vi.useRealTimers();

    runtime.behave("tdd-test", finir);
    await runner.run(TEST_AGENT, "encore", CLE);
    expect(runtime.history.at(-1)!.id).not.toBe(coupee);
  });

  it("session disparue côté runtime : on repart sur une neuve au lieu d'échouer", async () => {
    const { runtime, runner } = setup();
    runtime.behave("tdd-test", async () => {
      throw new Error("Failed to get response from the AI model");
    });
    await expect(runner.run(TEST_AGENT, "x", CLE)).rejects.toBeInstanceOf(EnvFailureError);
    runtime.unresumable.add(runtime.history.at(-1)!.id);

    runtime.behave("tdd-test", finir);
    const r = await runner.run(TEST_AGENT, "reprends", CLE);
    expect(r.output).toEqual({ summary: "fini", files: [] });
  });

  it("un tour réussi ne laisse rien à reprendre : la session est supprimée comme avant", async () => {
    const { runtime, runner } = setup();
    runtime.behave("tdd-test", finir);
    await runner.run(TEST_AGENT, "x", CLE);
    const premiere = runtime.history.at(-1)!.id;
    expect(runtime.deleted).toContain(premiere);
    await runner.run(TEST_AGENT, "x", CLE);
    expect(runtime.history.at(-1)!.id).not.toBe(premiere);
  });

  it("sans clé de reprise, rien n'est mémorisé : deux rôles homonymes de tâches différentes ne se mélangent pas", async () => {
    const { runtime, runner } = setup();
    runtime.behave("tdd-test", async () => {
      throw new Error("Failed to get response from the AI model");
    });
    await expect(runner.run(TEST_AGENT, "x")).rejects.toBeInstanceOf(EnvFailureError);
    const interrompue = runtime.history.at(-1)!.id;
    runtime.behave("tdd-test", finir);
    await runner.run(TEST_AGENT, "x");
    expect(runtime.history.at(-1)!.id).not.toBe(interrompue);
  });

  it("la clé sépare les tâches : une interruption sur t1 ne se reprend pas sur t2", async () => {
    const { runtime, runner } = setup();
    runtime.behave("tdd-test", async () => {
      throw new Error("Failed to get response from the AI model");
    });
    await expect(runner.run(TEST_AGENT, "x", { resumeKey: "t1/tdd-test" })).rejects.toBeInstanceOf(EnvFailureError);
    const interrompue = runtime.history.at(-1)!.id;
    runtime.behave("tdd-test", finir);
    await runner.run(TEST_AGENT, "x", { resumeKey: "t2/tdd-test" });
    expect(runtime.history.at(-1)!.id).not.toBe(interrompue);
  });
});
