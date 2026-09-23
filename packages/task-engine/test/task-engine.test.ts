import { EnvFailureError, TurnTimeoutError, WorkDefectError } from "@agent-studio/core";
import { fixedClock, RecordingCheckpoints, sequentialIds } from "@agent-studio/core/testing";
import { describe, expect, it } from "vitest";
import { createTaskEngine } from "../src/task-engine.js";
import { MemoryTaskStore } from "../src/testing/memory-task-store.js";
import type { TaskDefinition, TaskEvent } from "../src/protocols.js";

/**
 * Tâche jouet : compte jusqu'à `target` en exécutant un effet `work` par pas.
 * Chaque effet de travail est décidé par le test (`script`), ce qui permet
 * de simuler timeouts, pannes, attentes et plantages.
 */
interface S {
  n: number;
  target: number;
  log: string[];
  phase: "WORKING" | "WAITING_HUMAN" | "DONE" | "ABORTED" | "ESCALATED";
}
type E = { type: "WORKED" } | { type: "NEEDS_HUMAN" };
type F = { kind: "work"; n: number } | { kind: "notify"; text: string };

type Script = (effect: F, signal: AbortSignal) => Promise<TaskEvent<E> | void>;

function counterTask(script: Script): TaskDefinition<S, E, F, { calls: F[] }> {
  return {
    name: "compteur",
    initialState: (input) => ({ n: 0, target: (input as { target: number }).target, log: [], phase: "WORKING" }),
    initialEffects: () => [{ kind: "work", n: 0 }],
    transition(s, e) {
      const log = [...s.log, e.type];
      switch (e.type) {
        case "ABORT":
          return { state: { ...s, log, phase: "ABORTED" }, effects: [] };
        case "RESUMED":
          return { state: { ...s, log }, effects: [] };
        case "TIMEOUT":
          return { state: { ...s, log }, effects: [{ kind: "work", n: s.n }] };
        case "ENV_FAILURE":
          return { state: { ...s, log, phase: "ESCALATED" }, effects: [] };
        case "NEEDS_HUMAN":
          return { state: { ...s, log, phase: "WAITING_HUMAN" }, effects: [{ kind: "notify", text: "à vous" }] };
        case "HUMAN_DECISION":
          return { state: { ...s, log, phase: "WORKING" }, effects: [{ kind: "work", n: s.n }] };
        case "WORKED": {
          const n = s.n + 1;
          if (n >= s.target) return { state: { ...s, n, log, phase: "DONE" }, effects: [] };
          return { state: { ...s, n, log }, effects: [{ kind: "work", n }] };
        }
      }
    },
    async runEffect(effect, deps, ctx) {
      deps.calls.push(effect);
      return script(effect, ctx.signal);
    },
    checkpointBefore: (f) => f.kind === "work",
    isTerminal: (s) => s.phase === "DONE" || s.phase === "ABORTED",
  };
}

function start(def: ReturnType<typeof counterTask>, store = new MemoryTaskStore()) {
  const checkpoints = new RecordingCheckpoints();
  const deps = { calls: [] as F[] };
  const updates: string[] = [];
  const engine = createTaskEngine({ store, checkpoints, clock: fixedClock(), ids: sequentialIds("t") });
  engine.register(def, deps);
  engine.onUpdate((r) => updates.push(`${r.status}:${(r.state as S).phase}`));
  return { engine, store, checkpoints, deps, updates };
}

const START_KICK = { kind: "work", n: 0 } as const;

describe("Moteur de tâches", () => {
  it("déroule la tâche jusqu'à l'état terminal et persiste après chaque transition", async () => {
    const def = counterTask(async () => ({ type: "WORKED" }));
    const { engine, store, deps, checkpoints } = start(def);
    const id = await engine.start("compteur", { target: 3 });
    await engine.idle(id);

    const rec = await store.load(id);
    expect(rec?.status).toBe("finished");
    expect((rec?.state as S).n).toBe(3);
    expect(deps.calls).toHaveLength(3);
    expect(checkpoints.created).toHaveLength(3); // un checkpoint avant chaque effet `work`
    expect(rec?.inflight).toBeNull();
    expect(store.saves).toBeGreaterThanOrEqual(6);
  });

  it("ne prend pas de checkpoint pour les effets qui n'en demandent pas", async () => {
    const def = counterTask(async (f) => (f.kind === "work" ? { type: "NEEDS_HUMAN" } : undefined));
    const { engine, checkpoints, deps } = start(def);
    const id = await engine.start("compteur", { target: 3 });
    await engine.idle(id);
    expect(deps.calls.map((c) => c.kind)).toEqual(["work", "notify"]);
    expect(checkpoints.created).toHaveLength(1);
  });

  it("attend un événement externe quand un effet ne renvoie rien, puis reprend sur HUMAN_DECISION", async () => {
    let asked = false;
    const def = counterTask(async (f) => {
      if (f.kind === "notify") return;
      if (!asked) {
        asked = true;
        return { type: "NEEDS_HUMAN" };
      }
      return { type: "WORKED" };
    });
    const { engine, store } = start(def);
    const id = await engine.start("compteur", { target: 1 });
    await engine.idle(id);
    expect((await store.load(id))?.status).toBe("waiting");

    await engine.dispatch(id, { type: "HUMAN_DECISION", decision: "retry" });
    await engine.idle(id);
    expect((await store.load(id))?.status).toBe("finished");
  });

  it("TurnTimeoutError devient TIMEOUT, EnvFailureError devient ENV_FAILURE", async () => {
    let first = true;
    const def = counterTask(async () => {
      if (first) {
        first = false;
        throw new TurnTimeoutError(1000);
      }
      throw new EnvFailureError("quota épuisé");
    });
    const { engine, store } = start(def);
    const id = await engine.start("compteur", { target: 5 });
    await engine.idle(id);
    const s = (await store.load(id))?.state as S;
    expect(s.log).toEqual(["TIMEOUT", "ENV_FAILURE"]);
    expect(s.phase).toBe("ESCALATED");
  });

  it("un défaut de travail (WorkDefectError) devient TIMEOUT : réessai, pas escalade", async () => {
    let first = true;
    const def = counterTask(async () => {
      if (first) {
        first = false;
        throw new WorkDefectError("outil de fin non appelé");
      }
      return { type: "WORKED" };
    });
    const { engine, store } = start(def);
    const id = await engine.start("compteur", { target: 1 });
    await engine.idle(id);
    expect(((await store.load(id))?.state as S).log).toEqual(["TIMEOUT", "WORKED"]);
  });

  it("l'effet reçoit une copie de l'état courant", async () => {
    const seen: unknown[] = [];
    const def = counterTask(async () => ({ type: "WORKED" }));
    const spy: typeof def = { ...def, runEffect: async (f, d, ctx) => (seen.push(ctx.state), def.runEffect(f, d, ctx)) };
    const { engine } = start(spy);
    const id = await engine.start("compteur", { target: 2 });
    await engine.idle(id);
    expect(seen).toEqual([expect.objectContaining({ n: 0 }), expect.objectContaining({ n: 1 })]);
  });

  it("une erreur inattendue d'un effet est traitée comme un défaut d'environnement (escalade, jamais de boucle)", async () => {
    const def = counterTask(async () => {
      throw new Error("bogue");
    });
    const { engine, store } = start(def);
    const id = await engine.start("compteur", { target: 5 });
    await engine.idle(id);
    expect(((await store.load(id))?.state as S).log).toEqual(["ENV_FAILURE"]);
  });

  it("annulation pendant un effet : le signal est déclenché et la tâche finit ABORTED", async () => {
    let release: () => void = () => {};
    let aborted = false;
    const def = counterTask(
      (_f, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve({ type: "WORKED" });
          });
          release = () => resolve({ type: "WORKED" });
        }),
    );
    const { engine, store, deps } = start(def);
    const id = await engine.start("compteur", { target: 5 });
    while (deps.calls.length === 0) await new Promise((r) => setTimeout(r, 0));
    await engine.cancel(id);
    await engine.idle(id);
    release();
    expect(aborted).toBe(true);
    const rec = await store.load(id);
    expect((rec?.state as S).phase).toBe("ABORTED");
    expect(rec?.pending).toEqual([]);
    expect(rec?.status).toBe("finished");
  });

  it("annulation avant le démarrage de l'effet : aucun effet n'est lancé", async () => {
    const def = counterTask(async () => ({ type: "WORKED" }));
    const { engine, store, deps } = start(def);
    const id = await engine.start("compteur", { target: 5 });
    await engine.cancel(id);
    await engine.idle(id);
    expect(deps.calls).toEqual([]);
    expect(((await store.load(id))?.state as S).phase).toBe("ABORTED");
  });

  it("dispatch rend la main dès la transition persistée, sans attendre les effets suivants", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const def = counterTask(async (f) => {
      if (f.kind === "notify") return;
      if (++calls === 1) return { type: "NEEDS_HUMAN" };
      await gate; // effet long déclenché par la décision
      return { type: "WORKED" };
    });
    const { engine, store } = start(def);
    const id = await engine.start("compteur", { target: 1 });
    await engine.idle(id);

    await engine.dispatch(id, { type: "HUMAN_DECISION", decision: "go" });
    expect(((await store.load(id))?.state as S).phase).toBe("WORKING");
    expect((await store.load(id))?.status).toBe("running");

    release();
    await engine.idle(id);
    expect((await store.load(id))?.status).toBe("finished");
  });

  it("refuse les événements pour une tâche terminée ou inconnue", async () => {
    const def = counterTask(async () => ({ type: "WORKED" }));
    const { engine } = start(def);
    const id = await engine.start("compteur", { target: 1 });
    await engine.idle(id);
    await expect(engine.dispatch(id, { type: "HUMAN_DECISION", decision: "x" })).rejects.toThrow(/terminée/);
    await expect(engine.dispatch("inconnue", { type: "ABORT" })).rejects.toThrow(/inconnue/);
    await expect(engine.start("absente", {})).rejects.toThrow(/Tâche non enregistrée/);
  });

  it("notifie chaque mise à jour", async () => {
    const def = counterTask(async () => ({ type: "WORKED" }));
    const { engine, updates } = start(def);
    const id = await engine.start("compteur", { target: 1 });
    await engine.idle(id);
    expect(updates.at(-1)).toBe("finished:DONE");
  });
});

describe("Moteur de tâches — reprise après plantage (D23)", () => {
  it("un effet commencé non terminé est rejoué depuis son checkpoint, après RESUMED", async () => {
    const store = new MemoryTaskStore();
    // Premier « processus » : l'effet ne se termine jamais (plantage simulé).
    const hung = counterTask(() => new Promise(() => {}));
    const first = start(hung, store);
    const id = await first.engine.start("compteur", { target: 2 });
    await new Promise((r) => setTimeout(r, 0));
    const crashed = await store.load(id);
    expect(crashed?.inflight?.effect).toEqual(START_KICK);
    expect(crashed?.inflight?.checkpointId).toBe("cp-1");

    // Redémarrage : nouveau moteur sur le même stockage.
    const healthy = counterTask(async () => ({ type: "WORKED" }));
    const second = start(healthy, store);
    await second.engine.resumeAll();
    await second.engine.idle(id);

    expect(second.checkpoints.rolledBack).toEqual(["cp-1"]);
    const rec = await store.load(id);
    expect((rec?.state as S).log).toEqual(["RESUMED", "WORKED", "WORKED"]);
    expect(rec?.status).toBe("finished");
    expect(second.deps.calls[0]).toEqual(START_KICK);
  });

  it("une tâche en attente reste en attente au redémarrage ; une tâche terminée n'est pas relancée", async () => {
    const store = new MemoryTaskStore();
    const def = counterTask(async (f) => (f.kind === "work" ? { type: "NEEDS_HUMAN" } : undefined));
    const first = start(def, store);
    const waiting = await first.engine.start("compteur", { target: 1 });
    await first.engine.idle(waiting);

    const second = start(counterTask(async () => ({ type: "WORKED" })), store);
    await second.engine.resumeAll();
    expect(second.deps.calls).toEqual([]);
    expect((await store.load(waiting))?.status).toBe("waiting");
    expect(await second.engine.list()).toHaveLength(1);
  });

  it("les effets en attente sans effet en cours reprennent sans rollback", async () => {
    const store = new MemoryTaskStore();
    await store.save({
      id: "t9",
      name: "compteur",
      state: { n: 0, target: 1, log: [], phase: "WORKING" },
      pending: [START_KICK],
      inflight: null,
      status: "running",
      createdAt: "",
      updatedAt: "",
    });
    const { engine, checkpoints } = start(counterTask(async () => ({ type: "WORKED" })), store);
    await engine.resumeAll();
    await engine.idle("t9");
    expect(checkpoints.rolledBack).toEqual([]);
    expect((await store.load("t9"))?.status).toBe("finished");
  });
});

