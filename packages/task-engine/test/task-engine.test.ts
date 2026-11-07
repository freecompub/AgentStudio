import { EnvFailureError, TurnTimeoutError, WorkDefectError, type TraceEntry } from "@agent-studio/core";
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

  it("les effets de clôture émis par l'annulation s'exécutent, et la tâche se termine", async () => {
    // Le signal annule le travail en cours ; le bilan qu'émet la transition ABORT doit encore
    // pouvoir tourner. Sans cela, l'effet reste en attente et la tâche demeure « running ».
    const def = counterTask(async () => ({ type: "WORKED" }));
    const avecBilan: typeof def = {
      ...def,
      transition(s, e) {
        if (e.type === "ABORT") return { state: { ...s, log: [...s.log, e.type], phase: "ABORTED" }, effects: [{ kind: "notify", text: "bilan" }] };
        return def.transition(s, e);
      },
    };
    const { engine, store, deps } = start(avecBilan);
    const id = await engine.start("compteur", { target: 5 });

    await engine.cancel(id);
    await engine.idle(id);

    expect(deps.calls.some((c) => c.kind === "notify")).toBe(true);
    const rec = await store.load(id);
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

  it("les effets émis avec l'état terminal (bilan) s'exécutent avant que la tâche soit terminée", async () => {
    const def = counterTask(async () => ({ type: "WORKED" }));
    const withReport: typeof def = {
      ...def,
      transition: (s, e) => {
        const r = def.transition(s, e) as { state: S; effects: F[] };
        return r.state.phase === "DONE" && s.phase !== "DONE" ? { ...r, effects: [{ kind: "notify", text: "bilan" }] } : r;
      },
    };
    const { engine, store, deps } = start(withReport);
    const id = await engine.start("compteur", { target: 1 });
    await engine.idle(id);
    expect(deps.calls.at(-1)).toEqual({ kind: "notify", text: "bilan" });
    expect((await store.load(id))?.status).toBe("finished");
  });

  it("notifie chaque mise à jour", async () => {
    const def = counterTask(async () => ({ type: "WORKED" }));
    const { engine, updates } = start(def);
    const id = await engine.start("compteur", { target: 1 });
    await engine.idle(id);
    expect(updates.at(-1)).toBe("finished:DONE");
  });
});

describe("Moteur de tâches — définition asynchrone (extension hors processus, J4)", () => {
  it("toutes les méthodes de la définition peuvent répondre de façon asynchrone", async () => {
    const sync = counterTask(async () => ({ type: "WORKED" }));
    const later = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 1));
    const async: typeof sync = {
      ...sync,
      initialState: (i) => later(sync.initialState(i) as S),
      initialEffects: (s) => later(sync.initialEffects(s) as F[]),
      transition: (s, e) => later(sync.transition(s, e) as { state: S; effects: F[] }),
      isTerminal: (s) => later(sync.isTerminal(s) as boolean),
      checkpointBefore: (f) => later(sync.checkpointBefore!(f) as boolean),
    };
    const { engine, store, checkpoints } = start(async);
    const id = await engine.start("compteur", { target: 2 });
    await engine.idle(id);
    expect((await store.load(id))?.status).toBe("finished");
    expect(checkpoints.created).toHaveLength(2);
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


/**
 * Trace des transitions et des rejets (ADR 0032). Le type les déclarait depuis l'origine, et rien
 * ne les écrivait : le nombre de rejeux d'une phase et leurs motifs n'étaient lisibles nulle part.
 */
describe("Moteur de tâches — trace", () => {
  interface R {
    phase: string;
    stage: string;
    attempts: number;
    rejections: number;
    lastRejection: { gate: string; reasons: string[] } | null;
    arbitrages?: unknown[];
  }
  type RE = { type: "FAIL"; gate: string; reasons: string[] } | { type: "PASS" } | { type: "ARBITRE"; a: unknown };
  const rejectingTask = (events: RE[]): TaskDefinition<R, RE, { kind: "work" }, unknown> => ({
    name: "rejets",
    initialState: () => ({ phase: "DESIGN", stage: "SPECIALIST", attempts: 0, rejections: 0, lastRejection: null }),
    initialEffects: () => [{ kind: "work" }],
    transition(s, e) {
      if (e.type === "FAIL") return { state: { ...s, attempts: s.attempts + 1, rejections: s.rejections + 1, lastRejection: { gate: e.gate, reasons: e.reasons } }, effects: [{ kind: "work" }] };
      if (e.type === "PASS") return { state: { ...s, phase: "DONE", stage: "DONE" }, effects: [] };
      if (e.type === "ARBITRE") return { state: { ...s, arbitrages: [...(s.arbitrages ?? []), e.a] }, effects: [{ kind: "work" }] };
      return { state: s, effects: [] };
    },
    runEffect: async () => events.shift(),
    isTerminal: (s) => s.phase === "DONE",
  });

  async function run(events: RE[]) {
    const entries: TraceEntry[] = [];
    const trace = { append: async (e: TraceEntry) => void entries.push(e), list: async () => entries, archive: async () => undefined };
    const engine = createTaskEngine({ store: new MemoryTaskStore(), checkpoints: new RecordingCheckpoints(), clock: fixedClock(), ids: sequentialIds("t"), trace });
    engine.register(rejectingTask(events), {});
    const id = await engine.start("rejets", {});
    await engine.idle(id);
    return entries;
  }

  it("trace chaque transition avec l'événement, la phase, le stade et les essais", async () => {
    const entries = await run([{ type: "FAIL", gate: "documents", reasons: ["model.md absent"] }, { type: "PASS" }]);
    const transitions = entries.filter((e) => e.kind === "transition");
    expect(transitions).toEqual([
      expect.objectContaining({ taskId: "t1", événement: "FAIL", phase: "DESIGN", stade: "SPECIALIST", essais: 1, effets: ["work"] }),
      expect.objectContaining({ événement: "PASS", phase: "DONE", stade: "DONE", effets: [] }),
    ]);
  });

  it("trace un rejet avec sa porte et ses motifs entiers, une fois par rejet", async () => {
    const entries = await run([
      { type: "FAIL", gate: "documents", reasons: ["model.md absent", "decisions.md vide"] },
      { type: "FAIL", gate: "documents", reasons: ["model.md absent", "decisions.md vide"] },
      { type: "PASS" },
    ]);
    // Deux rejets identiques restent deux rejets : c'est le nombre de rejeux qu'on veut compter.
    expect(entries.filter((e) => e.kind === "rejet")).toEqual([
      expect.objectContaining({ porte: "documents", motifs: ["model.md absent", "decisions.md vide"] }),
      expect.objectContaining({ porte: "documents", motifs: ["model.md absent", "decisions.md vide"] }),
    ]);
  });

  it("trace chaque effet avec sa durée et son issue, et la durée de chaque transition (docs/10 P2)", async () => {
    const entries = await run([{ type: "FAIL", gate: "documents", reasons: ["x"] }, { type: "PASS" }]);
    const effets = entries.filter((e) => e.kind === "effet");
    expect(effets).toEqual([
      expect.objectContaining({ effet: "work", phase: "DESIGN", issue: "ok", duréeMs: expect.any(Number) }),
      expect.objectContaining({ effet: "work", phase: "DESIGN", issue: "ok", duréeMs: expect.any(Number) }),
    ]);
    for (const t of entries.filter((e) => e.kind === "transition")) expect(t).toMatchObject({ duréeMs: expect.any(Number) });
  });

  it("un effet qui attend une réponse humaine, ou qui échoue, le dit dans son issue", async () => {
    const entries: TraceEntry[] = [];
    const trace = { append: async (e: TraceEntry) => void entries.push(e), list: async () => entries, archive: async () => undefined };
    const engine = createTaskEngine({ store: new MemoryTaskStore(), checkpoints: new RecordingCheckpoints(), clock: fixedClock(), ids: sequentialIds("t"), trace });
    let n = 0;
    engine.register(
      {
        name: "issues",
        initialState: () => ({ phase: "X" }),
        initialEffects: () => [{ kind: "casse" }, { kind: "attend" }],
        transition: (s) => ({ state: s, effects: [] }),
        runEffect: async (f: { kind: string }) => {
          n++;
          if (f.kind === "casse") throw new Error("boum");
        },
        isTerminal: () => false,
      },
      {},
    );
    const id = await engine.start("issues", {});
    await engine.idle(id);
    expect(n).toBe(2);
    expect(entries.filter((e) => e.kind === "effet").map((e) => [(e as { effet: string }).effet, (e as { issue: string }).issue])).toEqual([
      ["casse", "erreur"],
      ["attend", "attente"],
    ]);
  });

  it("trace chaque arbitrage ajouté à l'état, une fois (D22 de docs/12)", async () => {
    const a = { porte: "mutation", élément: "src/a.ts:3 (EqualityOperator)", contestation: "équivalent", décision: "dérogation", par: "agent", raison: "même valeur à dose == max" };
    const entries = await run([{ type: "ARBITRE", a }, { type: "FAIL", gate: "x", reasons: ["y"] }, { type: "PASS" }]);
    expect(entries.filter((e) => e.kind === "arbitrage")).toEqual([expect.objectContaining({ kind: "arbitrage", ...a })]);
  });

  it("un motif conservé d'un rejet précédent ne compte pas comme un nouveau rejet", async () => {
    // `lastRejection` reste posé pendant tout le réessai : seul le compteur dit qu'un rejet a eu lieu.
    const entries = await run([{ type: "FAIL", gate: "documents", reasons: ["x"] }, { type: "PASS" }]);
    expect(entries.filter((e) => e.kind === "rejet")).toHaveLength(1);
  });

  it("une trace qui échoue n'arrête pas la tâche", async () => {
    // La trace raconte, elle n'atteste rien (ADR 0032) : elle ne doit jamais faire échouer le travail.
    const trace = { append: async () => { throw new Error("disque plein"); }, list: async () => [], archive: async () => undefined };
    const store = new MemoryTaskStore();
    const engine = createTaskEngine({ store, checkpoints: new RecordingCheckpoints(), clock: fixedClock(), ids: sequentialIds("t"), trace });
    engine.register(rejectingTask([{ type: "PASS" }]), {});
    const id = await engine.start("rejets", {});
    await engine.idle(id);
    expect((await store.load(id))?.status).toBe("finished");
  });
});
