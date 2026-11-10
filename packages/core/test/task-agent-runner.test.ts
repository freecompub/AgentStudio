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

  it("transmet l'effort et le palier de contexte du rôle au runtime", async () => {
    const { runtime, runner } = setup();
    runtime.behave("architect", async (t) => {
      await t.callTool("report_phase", { summary: "conçu", files: [] });
    });

    await runner.run(
      { role: "architect", systemPrompt: "Conçois.", writable: [], output: "report_phase", reasoningEffort: "high", contextTier: "long_context" },
      "Conçois le modèle.",
    );

    expect(runtime.configs.get("fake-1")).toMatchObject({ reasoningEffort: "high", contextTier: "long_context" });
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
      // ADR 0046 : un défaut sans cible est refusé — c'est elle qui dit quel agent corrige.
      await t.callTool("submit_lens_verdict", { lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [{ severity: "major", severityReason: "raison d’essai", description: "sans cible" }] }).catch((e: Error) => errors.push(e.message));
      await t.callTool("submit_lens_verdict", { lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [{ severity: "major", severityReason: "raison d’essai", target: "code", description: "MaxBolus accepte une valeur négative", file: "Sources/Domain/MaxBolus.swift", line: 4 }] });
    });
    const r = await runner.run({ role: "lens", systemPrompt: "Relis.", writable: [], output: "submit_lens_verdict" }, "x");
    expect(errors[0]).toMatch(/invalides/);
    expect(errors[1]).toMatch(/invalides.*target/);
    expect(r.output).toEqual({ lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [{ severity: "major", severityReason: "raison d’essai", target: "code", description: "MaxBolus accepte une valeur négative", file: "Sources/Domain/MaxBolus.swift", line: 4 }] });
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

  it("un tour réussi garde sa session : l'essai suivant de la même phase la reprend (ADR 0039)", async () => {
    // Cette attente disait le contraire. D17 dit « une session neuve par phase/rôle », et deux
    // essais du même rôle dans la même phase n'en font pas deux. Corriger un identifiant mal nommé
    // ne doit pas obliger l'agent à relire tout le dépôt.
    const { runtime, runner } = setup();
    runtime.behave("tdd-test", finir);
    await runner.run(TEST_AGENT, "x", CLE);
    const premiere = runtime.history.at(-1)!.id;
    expect(runtime.deleted).toEqual([]);
    await runner.run(TEST_AGENT, "la porte refuse : …", CLE);
    expect(runtime.history.at(-1)!.id).toBe(premiere);
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

/**
 * Reprise après une question de l'agent (ADR 0030, amendée).
 *
 * `report_blocker` n'est pas une erreur : c'est un outil terminal, et le tour se termine
 * normalement. La mémorisation de session, écrite dans le `catch`, ne le voyait donc jamais — et le
 * `finally` supprimait la session. L'agent perdait tout ce qu'il avait lu, à chaque question.
 *
 * C'est pourtant le cas le plus évidemment reprenable des quatre : **rien n'a échoué**. L'agent a
 * fait exactement ce qu'on lui demande — s'arrêter plutôt qu'inventer — et c'est le seul cas qu'on
 * punissait en lui effaçant la mémoire. Mesuré : sept questions en DESIGN sur un run réel, chacune
 * faisant repayer l'exploration complète du dépôt.
 */
describe("Reprise de session après une question de l'agent", () => {
  const CLE = { resumeKey: "t1/tdd-test" };
  const QUESTIONNEUR: TaskAgentSpec = { ...TEST_AGENT, blocker: true };

  const demande: Parameters<ScriptedRuntime["behave"]>[1] = async (t) => {
    await t.callTool("report_blocker", { question: "Quelle règle d'arrondi ?", choices: ["au centime", "au plus proche"] });
  };
  const finir: Parameters<ScriptedRuntime["behave"]>[1] = async (t) => {
    await t.callTool("report_phase", { summary: "fini", files: [] });
  };

  it("le tour suivant reprend la session : l'agent garde ce qu'il avait lu", async () => {
    const { runtime, runner } = setup();
    runtime.behave("tdd-test", demande);
    const r = await runner.run(QUESTIONNEUR, "x", CLE);
    expect(r.blocker).toBeDefined();
    const questionneuse = runtime.history.at(-1)!.id;

    runtime.behave("tdd-test", finir);
    await runner.run(QUESTIONNEUR, "réponse : au centime", CLE);
    expect(runtime.history.at(-1)!.id).toBe(questionneuse);
  });

  it("la session n'est pas supprimée entre la question et la réponse", async () => {
    const { runtime, runner } = setup();
    runtime.behave("tdd-test", demande);
    await runner.run(QUESTIONNEUR, "x", CLE);
    expect(runtime.deleted).toEqual([]);
  });

  it("deux questions d'affilée reprennent la même session, pas une par question", async () => {
    // C'est le cas mesuré : six questions en 105 secondes, six sessions neuves.
    const { runtime, runner } = setup();
    runtime.behave("tdd-test", demande);
    await runner.run(QUESTIONNEUR, "x", CLE);
    const premiere = runtime.history.at(-1)!.id;
    await runner.run(QUESTIONNEUR, "réponse 1", CLE);
    await runner.run(QUESTIONNEUR, "réponse 2", CLE);
    expect(runtime.history.at(-1)!.id).toBe(premiere);
    expect(runtime.deleted).toEqual([]);
  });

  it("sans clé de continuité, rien ne change : session neuve comme avant", async () => {
    const { runtime, runner } = setup();
    runtime.behave("tdd-test", demande);
    await runner.run(QUESTIONNEUR, "x");
    const questionneuse = runtime.history.at(-1)!.id;
    expect(runtime.deleted).toContain(questionneuse);
    runtime.behave("tdd-test", finir);
    await runner.run(QUESTIONNEUR, "réponse", {});
    expect(runtime.history.at(-1)!.id).not.toBe(questionneuse);
  });

  it("la phase close garde elle aussi sa session : un rejet de porte peut la rouvrir (ADR 0039)", async () => {
    const { runtime, runner } = setup();
    runtime.behave("tdd-test", demande);
    await runner.run(QUESTIONNEUR, "x", CLE);
    runtime.behave("tdd-test", finir);
    await runner.run(QUESTIONNEUR, "réponse", CLE);
    expect(runtime.deleted).toEqual([]);
  });
});

/**
 * Reprise entre deux essais d'une même phase (ADR 0039).
 *
 * D17 dit « une session neuve **par phase/rôle** ». Notre implémentation était plus stricte que la
 * décision : une session neuve par **essai**. Or trois essais de DESIGN par `skraft-architect-model`
 * sont la même phase et le même rôle — c'est le raisonnement qui a déjà validé la reprise après une
 * question (ADR 0030).
 *
 * Le rejet observé le 29/09 rend l'écart visible :
 *
 *   `CalculeRemise` cité dans contracts.md n'existe pas dans event-model.md ni dans domain-model.md.
 *
 * Une incohérence de nommage. Pour la corriger, on faisait relire tout le dépôt à l'architecte,
 * reconstruire son modèle mental et réécrire quinze documents.
 */
describe("Reprise entre deux essais d'une même phase", () => {
  const CLE = { resumeKey: "t1/skraft/architect" };
  const finir: Parameters<ScriptedRuntime["behave"]>[1] = async (t) => {
    await t.callTool("report_phase", { summary: "fini", files: [] });
  };

  it("après un tour clos normalement, le tour suivant reprend la même session", async () => {
    const { runtime, runner } = setup();
    runtime.behave("tdd-test", finir);
    await runner.run(TEST_AGENT, "écris la conception", CLE);
    const premiere = runtime.history.at(-1)!.id;
    await runner.run(TEST_AGENT, "la porte refuse : `CalculeRemise` n'existe pas dans le modèle", CLE);
    expect(runtime.history.at(-1)!.id).toBe(premiere);
  });

  it("la session n'est pas supprimée entre les deux : sinon il n'y aurait rien à reprendre", async () => {
    const { runtime, runner } = setup();
    runtime.behave("tdd-test", finir);
    await runner.run(TEST_AGENT, "x", CLE);
    expect(runtime.deleted).toEqual([]);
  });

  it("un rôle différent ouvre bien une session neuve : la clé sépare les rôles", async () => {
    const { runtime, runner } = setup();
    runtime.behave("tdd-test", finir);
    runtime.behave("tdd-planner", async (t) => void (await t.callTool("submit_plan", { steps: [{ id: "s1", behavior: "un comportement" }] })));
    await runner.run(TEST_AGENT, "x", { resumeKey: "t1/skraft/model" });
    const model = runtime.history.at(-1)!.id;
    await runner.run(PLANNER, "x", { resumeKey: "t1/skraft/decide" });
    expect(runtime.history.at(-1)!.id).not.toBe(model);
  });

  it("un tour coupé par un plafond reste non reprenable : son contexte EST le problème", async () => {
    // La règle de l'ADR 0030 tient : ce n'est pas parce qu'on garde la session entre deux essais
    // qu'on la garde quand c'est nous qui avons coupé pour cause de contexte.
    const runtime = new ScriptedRuntime();
    const runner = createTaskAgentRunner({ runtime, root: "/projets/demo", idleMs: 60_000, maxInputTokens: 1_000 });
    runtime.behave("tdd-test", (t) => {
      t.session.emit({ type: "usage", inputTokens: 5_000 });
      t.hang();
    });
    await expect(runner.run(TEST_AGENT, "x", CLE)).rejects.toBeInstanceOf(TurnCostError);
    const coupee = runtime.history.at(-1)!.id;
    expect(runtime.deleted).toContain(coupee);
  });
});

/**
 * Libérer les sessions d'une phase rembobinée (ADR 0050).
 *
 * `releaseTask` clôt la tâche entière. Ici la tâche continue, mais une escalade a rembobiné le
 * dépôt : les conversations qui décrivent le travail effacé doivent partir avec lui, et celles des
 * autres rôles rester. Sans ce point, l'agent relancé corrige de mémoire un dépôt vide.
 */
describe("Libération des sessions d'une phase rembobinée", () => {
  const finir: Parameters<ScriptedRuntime["behave"]>[1] = async (t) => {
    await t.callTool("report_phase", { summary: "fini", files: [] });
  };
  const ouvrir = async (runner: ReturnType<typeof createTaskAgentRunner>, runtime: ScriptedRuntime, cle: string) => {
    runtime.behave("tdd-test", finir);
    await runner.run(TEST_AGENT, "x", { resumeKey: cle });
    return runtime.history.at(-1)!.id;
  };

  it("supprime la session du rôle nommé, et lui seul", async () => {
    const { runtime, runner } = setup();
    const modele = await ouvrir(runner, runtime, "t1/skraft/skraft-architect-model");
    const decide = await ouvrir(runner, runtime, "t1/skraft/skraft-architect-decide");

    await runner.releaseRoles("t1", ["skraft/skraft-architect-model"]);
    expect(runtime.deleted).toEqual([modele]);

    // Celle qu'on n'a pas nommée est intacte : le tour suivant la reprend.
    await runner.run(TEST_AGENT, "x", { resumeKey: "t1/skraft/skraft-architect-decide" });
    expect(runtime.history.at(-1)!.id).toBe(decide);
  });

  it("le rôle libéré repart d'une session NEUVE au tour suivant", async () => {
    const { runtime, runner } = setup();
    const avant = await ouvrir(runner, runtime, "t1/skraft/skraft-researcher");
    await runner.releaseRoles("t1", ["skraft/skraft-researcher"]);
    await runner.run(TEST_AGENT, "x", { resumeKey: "t1/skraft/skraft-researcher" });
    expect(runtime.history.at(-1)!.id).not.toBe(avant);
  });

  it("ne touche pas aux autres tâches : le même rôle ailleurs est préservé", async () => {
    const { runtime, runner } = setup();
    await ouvrir(runner, runtime, "t1/skraft/skraft-researcher");
    const autre = await ouvrir(runner, runtime, "t2/skraft/skraft-researcher");
    await runner.releaseRoles("t1", ["skraft/skraft-researcher"]);
    await runner.run(TEST_AGENT, "x", { resumeKey: "t2/skraft/skraft-researcher" });
    expect(runtime.history.at(-1)!.id).toBe(autre);
  });

  it("un rôle sans session mémorisée : rien ne casse", async () => {
    const { runtime, runner } = setup();
    await expect(runner.releaseRoles("t1", ["skraft/jamais-lancé"])).resolves.toBeUndefined();
    expect(runtime.deleted).toEqual([]);
  });
});

describe("Exécuteur d'agent de tâche — trace de l'usage", () => {
  it("le coût en dollars d'un runtime qui le rend (Claude, ADR 0070) est tracé avec l'usage", async () => {
    const runtime = new ScriptedRuntime();
    const entrees: { kind: string }[] = [];
    const trace = { append: async (e: { kind: string }) => void entrees.push(e), list: async () => [], archive: async () => {} };
    const runner = createTaskAgentRunner({ runtime, root: "/projets/demo", idleMs: 1_000, trace: trace as never });
    runtime.behave("tdd-test", async (t) => {
      t.session.emit({ type: "usage", model: "claude-sonnet-5", inputTokens: 100, outputTokens: 10 });
      t.session.emit({ type: "usage", model: "claude-sonnet-5", costUsd: 0.25 });
      await t.callTool("report_phase", { summary: "ok", files: [] });
    });
    await runner.run(TEST_AGENT, "x", { trace: { taskId: "t1", phase: "DELIVER" } });
    expect(entrees.filter((e) => e.kind === "usage")).toEqual([
      expect.objectContaining({ modèle: "claude-sonnet-5", entrée: 100, sortie: 10 }),
      expect.objectContaining({ modèle: "claude-sonnet-5", coûtUsd: 0.25 }),
    ]);
  });
});
