import { EnvFailureError, WorkDefectError, type Clock, type IdGenerator, type Logger, type TraceBody, type TraceStore, type UsageRecorder } from "@agent-studio/core";
import type { SystemEvent, TaskCheckpoints, TaskDefinition, TaskEvent, TaskRecord, TaskStore } from "./protocols.js";

export interface TaskEngineDeps {
  store: TaskStore;
  checkpoints: TaskCheckpoints;
  clock: Clock;
  ids: IdGenerator;
  logger?: Logger;
  /** Durée et nombre d'effets par état (D37). */
  usage?: UsageRecorder;
  /**
   * Trace d'exécution (ADR 0032) : chaque transition, et chaque rejet avec ses motifs. Sans elle,
   * le nombre de rejeux d'une phase et leurs causes ne se lisaient nulle part.
   */
  trace?: TraceStore;
}

/**
 * Champs que le moteur lit dans l'état **par convention**, comme `phase` (D37). Tous facultatifs :
 * une tâche qui ne les porte pas est tracée sans eux.
 *
 * Un rejet se repère au compteur `rejections`, pas à `lastRejection` : les motifs restent posés
 * pendant tout le réessai, et deux rejets identiques de suite sont bien deux rejets. Comparer des
 * références ne marcherait pas non plus — l'état d'une extension isolée revient sérialisé.
 */
interface TracedState {
  stage?: unknown;
  attempts?: unknown;
  rejections?: unknown;
  lastRejection?: { gate?: unknown; reasons?: unknown } | null;
  /** Arbitrages de défauts de porte, en ajout seul : chaque nouvel élément est tracé (ADR 0065). */
  arbitrages?: unknown;
}

const effectKind = (f: unknown): string => {
  const k = (f as { kind?: unknown; type?: unknown } | null)?.kind ?? (f as { type?: unknown } | null)?.type;
  return typeof k === "string" ? k : "?";
};

export interface TaskEngine {
  register<S, E extends { type: string }, F, D>(def: TaskDefinition<S, E, F, D>, deps: D): void;
  start(name: string, input: unknown): Promise<string>;
  /**
   * Injecte un événement (décision humaine…) : résout dès que la transition est persistée ;
   * les effets qui en découlent s'exécutent ensuite en arrière-plan (voir `idle`).
   */
  dispatch(taskId: string, event: TaskEvent<{ type: string }>): Promise<void>;
  cancel(taskId: string): Promise<void>;
  /** Au démarrage : reprend les tâches non terminées (§6.3). */
  resumeAll(): Promise<void>;
  /** Résout quand la tâche n'a plus d'effet en cours de traitement. */
  idle(taskId: string): Promise<void>;
  status(taskId: string): Promise<TaskRecord | null>;
  /** État courant d'une tâche active, pour attribuer l'usage (D37). */
  phaseOf(taskId: string): Promise<string | null>;
  list(): Promise<TaskRecord[]>;
  onUpdate(cb: (record: TaskRecord) => void): () => void;
}

// Définition « effacée » : le moteur manipule des états, événements et effets opaques.
type AnyDef = TaskDefinition<unknown, { type: string }, unknown, unknown>;

interface Live {
  def: AnyDef;
  deps: unknown;
  record: TaskRecord;
  chain: Promise<void>;
  abort: AbortController;
}

/**
 * Moteur de tâches (§6) : file d'événements par tâche, persistance après chaque transition,
 * checkpoint et marqueur avant chaque effet, reprise d'un effet interrompu depuis son
 * checkpoint (jamais « récupéré »), traduction des erreurs en événements système.
 */
export function createTaskEngine(deps: TaskEngineDeps): TaskEngine {
  const defs = new Map<string, { def: AnyDef; deps: unknown }>();
  const live = new Map<string, Live>();
  const listeners = new Set<(r: TaskRecord) => void>();
  const now = () => deps.clock.now().toISOString();

  async function persist(t: Live): Promise<void> {
    const r = t.record;
    // Les effets émis par la transition vers l'état terminal (bilan…) s'exécutent avant « terminée ».
    r.status = r.pending.length || r.inflight ? "running" : (await t.def.isTerminal(r.state)) ? "finished" : "waiting";
    r.phase = await phaseOfState(t);
    r.updatedAt = now();
    await deps.store.save(r);
    const snapshot = structuredClone(r);
    for (const l of [...listeners]) l(snapshot);
  }

  function enqueue(t: Live, work: () => Promise<void>): Promise<void> {
    const next = t.chain.then(work).catch((err: unknown) => {
      deps.logger?.error("moteur de tâches : erreur interne", { taskId: t.record.id, error: String(err) });
    });
    t.chain = next;
    return next;
  }

  async function apply(t: Live, event: TaskEvent<{ type: string }>): Promise<void> {
    const before = t.record.state as TracedState | null;
    const debutTransition = Date.now();
    const { state, effects } = await t.def.transition(t.record.state, event);
    const dureeTransition = Date.now() - debutTransition;
    t.record.state = state;
    if (event.type === "ABORT") t.record.pending = [];
    t.record.pending.push(...effects);
    deps.logger?.debug("transition", { taskId: t.record.id, event: event.type, effects: effects.length });
    await persist(t);
    await traceTransition(t, event, before, effects, dureeTransition);
  }

  /** La trace raconte, elle n'atteste rien : son échec ne doit jamais arrêter la tâche. */
  async function tracer(t: Live, b: TraceBody): Promise<void> {
    if (!deps.trace) return;
    await deps.trace.append({ taskId: t.record.id, at: now(), ...b } as Parameters<TraceStore["append"]>[0]).catch((err: unknown) => {
      deps.logger?.warn("trace : écriture impossible", { taskId: t.record.id, error: String(err) });
    });
  }

  async function traceTransition(t: Live, event: { type: string }, before: TracedState | null, effects: unknown[], dureeMs: number): Promise<void> {
    if (!deps.trace) return;
    const after = t.record.state as TracedState | null;
    const bodies: TraceBody[] = [
      {
        kind: "transition",
        événement: event.type,
        phase: t.record.phase ?? "?",
        ...(typeof after?.stage === "string" ? { stade: after.stage } : {}),
        ...(typeof after?.attempts === "number" ? { essais: after.attempts } : {}),
        effets: effects.map(effectKind),
        duréeMs: dureeMs,
      },
    ];
    const n = (s: TracedState | null) => (typeof s?.rejections === "number" ? s.rejections : 0);
    if (n(after) > n(before)) {
      const r = after?.lastRejection;
      bodies.push({
        kind: "rejet",
        porte: typeof r?.gate === "string" ? r.gate : "?",
        motifs: Array.isArray(r?.reasons) ? r.reasons.map(String) : [],
      });
    }
    const liste = (s: TracedState | null) => (Array.isArray(s?.arbitrages) ? (s.arbitrages as Record<string, unknown>[]) : []);
    for (const a of liste(after).slice(liste(before).length)) {
      const texte = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "?");
      bodies.push({
        kind: "arbitrage",
        porte: texte("porte"),
        élément: texte("élément"),
        contestation: texte("contestation"),
        // « obsolète » : un test existant que l'humain sort des portes (ADR 0066).
        décision: a.décision === "dérogation" || a.décision === "obsolète" ? a.décision : "à corriger",
        par: a.par === "humain" ? "humain" : "agent",
        raison: texte("raison"),
      });
    }
    for (const b of bodies) {
      // La trace raconte, elle n'atteste rien : son échec ne doit jamais arrêter la tâche.
      await deps.trace.append({ taskId: t.record.id, at: now(), ...b } as Parameters<TraceStore["append"]>[0]).catch((err: unknown) => {
        deps.logger?.warn("trace : écriture impossible", { taskId: t.record.id, error: String(err) });
      });
    }
  }

  function toSystemEvent(err: unknown): SystemEvent {
    if (err instanceof WorkDefectError) return { type: "TIMEOUT", reason: err.message };
    if (err instanceof EnvFailureError) return { type: "ENV_FAILURE", reason: err.message };
    // Erreur imprévue : jamais de réessai aveugle, escalade (D25).
    return { type: "ENV_FAILURE", reason: `Erreur inattendue : ${err instanceof Error ? err.message : String(err)}` };
  }

  /** Exécute les effets en attente jusqu'à épuisement (ou attente d'un événement externe). */
  async function drain(t: Live): Promise<void> {
    while (t.record.pending.length) {
      if (t.abort.signal.aborted) return; // annulée : plus aucun effet ne démarre
      const effect = t.record.pending[0];
      const wantsCheckpoint = (await t.def.checkpointBefore?.(effect)) ?? true;
      const checkpointId = wantsCheckpoint
        ? (await deps.checkpoints.create(`${t.record.name} ${t.record.id}`)).id
        : null;
      t.record.pending.shift();
      t.record.inflight = { effect, checkpointId, startedAt: now() };
      await persist(t);
      if (t.abort.signal.aborted) {
        t.record.inflight = null;
        return;
      }

      let next: TaskEvent<{ type: string }> | void;
      const phase = await phaseOfState(t);
      const effectStart = Date.now();
      let leve = false;
      try {
        next = await t.def.runEffect(effect, t.deps, {
          taskId: t.record.id,
          state: structuredClone(t.record.state),
          signal: t.abort.signal,
        });
      } catch (err) {
        leve = true;
        next = toSystemEvent(err);
        deps.logger?.warn("effet en échec", { taskId: t.record.id, event: next.type, reason: "reason" in next ? next.reason : "" });
      }
      t.record.inflight = null;
      const dureeEffet = Date.now() - effectStart;
      void deps.usage?.add(t.record.id, phase, { durationMs: dureeEffet, effects: 1 }).catch(() => undefined);
      const issue = leve || (next && t.def.estUnEchec?.(next)) ? "erreur" : next ? "ok" : "attente";
      await tracer(t, { kind: "effet", effet: effectKind(effect), phase, duréeMs: dureeEffet, issue });
      if (t.abort.signal.aborted) {
        t.record.pending = [];
        await persist(t);
        return; // l'événement ABORT est appliqué par `cancel`
      }
      if (next) await apply(t, next);
      else await persist(t);
    }
  }

  async function phaseOfState(t: Live): Promise<string> {
    if (t.def.phaseOf) return t.def.phaseOf(t.record.state);
    const p = (t.record.state as { phase?: unknown } | null)?.phase;
    return typeof p === "string" ? p : "?";
  }

  function getLive(taskId: string): Live {
    const t = live.get(taskId);
    if (!t) throw new Error(`Tâche inconnue : ${taskId}`);
    return t;
  }

  function attach(record: TaskRecord): Live {
    const entry = defs.get(record.name);
    if (!entry) throw new Error(`Tâche non enregistrée : ${record.name}`);
    const t: Live = { def: entry.def, deps: entry.deps, record, chain: Promise.resolve(), abort: new AbortController() };
    live.set(record.id, t);
    return t;
  }

  return {
    register(def, taskDeps) {
      defs.set(def.name, { def: def as unknown as AnyDef, deps: taskDeps });
    },

    async start(name, input) {
      const entry = defs.get(name);
      if (!entry) throw new Error(`Tâche non enregistrée : ${name}`);
      const state = await entry.def.initialState(input);
      const t = attach({
        id: deps.ids.next(),
        name,
        state,
        pending: await entry.def.initialEffects(state),
        inflight: null,
        status: "running",
        createdAt: now(),
        updatedAt: now(),
      });
      await persist(t);
      void enqueue(t, () => drain(t));
      return t.record.id;
    },

    async dispatch(taskId, event) {
      const t = getLive(taskId);
      if (t.record.status === "finished") throw new Error(`La tâche ${taskId} est terminée`);
      await enqueue(t, () => apply(t, event));
      void enqueue(t, () => drain(t));
    },

    async cancel(taskId) {
      const t = getLive(taskId);
      if (t.record.status === "finished") return;
      t.abort.abort();
      await enqueue(t, () => apply(t, { type: "ABORT" }));
      // Le signal a interrompu le travail en cours ; les effets de clôture émis par la
      // transition ABORT — bilan, nettoyage — doivent encore pouvoir s'exécuter. Sans ce
      // renouvellement et ce drainage, ils resteraient en attente et la tâche demeurerait
      // « running » indéfiniment.
      t.abort = new AbortController();
      await enqueue(t, () => drain(t));
    },

    async resumeAll() {
      for (const record of await deps.store.list()) {
        if (record.status === "finished" || live.has(record.id) || !defs.has(record.name)) continue;
        const t = attach(record);
        const inflight = record.inflight;
        if (!inflight) {
          if (record.pending.length) void enqueue(t, () => drain(t));
          continue;
        }
        void enqueue(t, async () => {
          if (inflight.checkpointId) await deps.checkpoints.rollback(inflight.checkpointId);
          t.record.inflight = null;
          t.record.pending.unshift(inflight.effect);
          deps.logger?.info("reprise d'un effet interrompu", { taskId: record.id, checkpointId: inflight.checkpointId });
          await apply(t, { type: "RESUMED" });
          await drain(t);
        });
      }
    },

    idle: (taskId) => getLive(taskId).chain,

    status: (taskId) => deps.store.load(taskId),

    async phaseOf(taskId) {
      const t = live.get(taskId);
      return t ? phaseOfState(t) : null;
    },

    list: () => deps.store.list(),

    onUpdate(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
