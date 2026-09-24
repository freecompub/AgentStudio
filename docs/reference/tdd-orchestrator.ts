// ============================================================================
// Orchestrateur TDD — machine à états déterministe
// Les agents (LLM) PROPOSENT, ce code DÉCIDE des transitions.
// Architecture : reducer pur (state, event) -> { state, effects } + runner d'effets.
// ============================================================================

// ---------- Types ------------------------------------------------------------

export type Phase =
  | "IDLE"
  | "PLANNING"          // l'agent planificateur découpe la feature
  | "PLAN_REVIEW"       // validation humaine du plan (optionnelle)
  | "STEP_START"        // checkpoint git, sélection du comportement suivant
  | "RED"               // agent test écrit UN test
  | "RED_VERIFY"        // le code vérifie : échec pour la bonne raison
  | "GREEN"             // agent dev implémente le minimum
  | "GREEN_VERIFY"      // tout vert + tests inchangés + périmètre respecté
  | "REFACTOR"          // agent dev nettoie
  | "REFACTOR_VERIFY"   // tout vert + tests inchangés ; sinon rollback
  | "STEP_DONE"
  | "ESCALATED"         // décision humaine requise
  | "DONE"
  | "ABORTED";

export interface Step {
  id: string;
  behavior: string;                  // ex. "refuse un bolus > dose max"
  status: "pending" | "done" | "skipped";
}

export interface TddState {
  phase: Phase;
  feature: string;
  steps: Step[];
  current: number;                   // index de l'étape en cours
  attempts: number;                  // essais dans la phase courante
  maxAttempts: number;
  checkpoints: Partial<Record<"step" | "red" | "green", string>>; // SHA git
  baselineTests: string[];           // ids des tests avant RED
  newTestIds: string[];              // tests ajoutés pendant RED
  testsHash?: string;                // empreinte des fichiers de test après RED
  feedback?: string;                 // raison du dernier échec, renvoyée à l'agent
  escalation?: { from: Phase; reason: string };
  skipRefactor: boolean;
}

export type TddEvent =
  | { type: "START"; feature: string }
  | { type: "PLAN_SUBMITTED"; steps: Omit<Step, "status">[] }
  | { type: "PLAN_APPROVED" }
  | { type: "PLAN_REJECTED"; feedback: string }
  | { type: "CHECKPOINT_CREATED"; sha: string; baselineTests: string[] }
  | { type: "AGENT_DONE" }                       // l'agent a appelé report_phase
  | { type: "VERIFY_OK"; data?: { newTestIds?: string[]; testsHash?: string; sha?: string } }
  | { type: "VERIFY_FAIL"; reason: string }
  | { type: "HUMAN_DECISION"; action: "retry" | "skip" | "abort" }
  | { type: "ABORT" };

export type Effect =
  | { kind: "runPlanner"; feature: string; feedback?: string }
  | { kind: "askPlanReview"; steps: Step[] }
  | { kind: "createCheckpoint" }
  | { kind: "runTestAgent"; step: Step; feedback?: string }
  | { kind: "runDevAgent"; mode: "green" | "refactor"; step: Step; testIds: string[]; feedback?: string }
  | { kind: "verifyRed"; since: string; baseline: string[] }
  | { kind: "verifyGreen"; since: string; testsHash: string; message: string }
  | { kind: "rollback"; to: string }
  | { kind: "commit"; message: string }
  | { kind: "askHuman"; reason: string; from: Phase }
  | { kind: "emit"; state: TddState };

// ---------- État initial ------------------------------------------------------

export const initialState = (opts?: Partial<TddState>): TddState => ({
  phase: "IDLE", feature: "", steps: [], current: 0, attempts: 0,
  maxAttempts: 3, checkpoints: {}, baselineTests: [], newTestIds: [],
  skipRefactor: false, ...opts,
});

// ---------- Reducer pur (testable unitairement, sans I/O) ---------------------

export function transition(s: TddState, e: TddEvent): { state: TddState; effects: Effect[] } {
  const out = (state: TddState, effects: Effect[] = []) =>
    ({ state, effects: [...effects, { kind: "emit", state } as Effect] });
  const step = s.steps[s.current];

  if (e.type === "ABORT") return out({ ...s, phase: "ABORTED" });

  switch (s.phase) {
    case "IDLE":
      if (e.type === "START") {
        const ns = { ...s, phase: "PLANNING" as Phase, feature: e.feature };
        return out(ns, [{ kind: "runPlanner", feature: e.feature }]);
      }
      break;

    case "PLANNING":
      if (e.type === "PLAN_SUBMITTED") {
        if (e.steps.length === 0) return out({ ...s, phase: "DONE" });
        const steps = e.steps.map(st => ({ ...st, status: "pending" as const }));
        return out({ ...s, phase: "PLAN_REVIEW", steps }, [{ kind: "askPlanReview", steps }]);
      }
      break;

    case "PLAN_REVIEW":
      if (e.type === "PLAN_APPROVED") return startStep({ ...s, current: 0 });
      if (e.type === "PLAN_REJECTED")
        return out({ ...s, phase: "PLANNING", steps: [] },
          [{ kind: "runPlanner", feature: s.feature, feedback: e.feedback }]);
      break;

    case "STEP_START":
      if (e.type === "CHECKPOINT_CREATED") {
        const ns: TddState = {
          ...s, phase: "RED", attempts: 0, feedback: undefined,
          checkpoints: { step: e.sha }, baselineTests: e.baselineTests,
          newTestIds: [], testsHash: undefined,
        };
        return out(ns, [{ kind: "runTestAgent", step }]);
      }
      break;

    case "RED":
      if (e.type === "AGENT_DONE")
        return out({ ...s, phase: "RED_VERIFY" },
          [{ kind: "verifyRed", since: s.checkpoints.step!, baseline: s.baselineTests }]);
      break;

    case "RED_VERIFY":
      if (e.type === "VERIFY_OK") {
        const ns: TddState = {
          ...s, phase: "GREEN", attempts: 0, feedback: undefined,
          newTestIds: e.data!.newTestIds!, testsHash: e.data!.testsHash!,
          checkpoints: { ...s.checkpoints, red: e.data!.sha! },
        };
        return out(ns, [{ kind: "runDevAgent", mode: "green", step, testIds: ns.newTestIds }]);
      }
      if (e.type === "VERIFY_FAIL")
        return retryOrEscalate(s, e.reason, "RED", s.checkpoints.step!,
          { kind: "runTestAgent", step, feedback: e.reason });
      break;

    case "GREEN":
      if (e.type === "AGENT_DONE")
        return out({ ...s, phase: "GREEN_VERIFY" },
          [{ kind: "verifyGreen", since: s.checkpoints.red!, testsHash: s.testsHash!, message: `feat: ${step.behavior}` }]);
      break;

    case "GREEN_VERIFY":
      if (e.type === "VERIFY_OK") {
        const ns = { ...s, attempts: 0, feedback: undefined,
          checkpoints: { ...s.checkpoints, green: e.data!.sha! } };
        if (s.skipRefactor) return finishStep(ns);
        return out({ ...ns, phase: "REFACTOR" },
          [{ kind: "runDevAgent", mode: "refactor", step, testIds: s.newTestIds }]);
      }
      if (e.type === "VERIFY_FAIL")
        return retryOrEscalate(s, e.reason, "GREEN", s.checkpoints.red!,
          { kind: "runDevAgent", mode: "green", step, testIds: s.newTestIds, feedback: e.reason });
      break;

    case "REFACTOR":
      if (e.type === "AGENT_DONE")
        return out({ ...s, phase: "REFACTOR_VERIFY" },
          [{ kind: "verifyGreen", since: s.checkpoints.green!, testsHash: s.testsHash!, message: `refactor: ${step.behavior}` }]);
      break;

    case "REFACTOR_VERIFY":
      if (e.type === "VERIFY_OK") return finishStep(s);
      if (e.type === "VERIFY_FAIL") {
        // Un refactor raté n'est pas bloquant : on jette le refactor, on garde le vert.
        const r = finishStep({ ...s, feedback: e.reason });
        return { state: r.state, effects: [{ kind: "rollback", to: s.checkpoints.green! }, ...r.effects] };
      }
      break;

    case "ESCALATED":
      if (e.type === "HUMAN_DECISION") {
        const from = s.escalation!.from;
        if (e.action === "abort") return out({ ...s, phase: "ABORTED" });
        if (e.action === "skip") {
          const steps = s.steps.map((st, i) => i === s.current ? { ...st, status: "skipped" as const } : st);
          const r = nextStep({ ...s, steps, escalation: undefined });
          return { state: r.state, effects: [{ kind: "rollback", to: s.checkpoints.step! }, ...r.effects] };
        }
        // retry : on repart de la phase fautive avec un compteur remis à zéro
        const ns = { ...s, phase: from, attempts: 0, escalation: undefined };
        const eff: Effect = from === "RED"
          ? { kind: "runTestAgent", step, feedback: s.feedback }
          : { kind: "runDevAgent", mode: "green", step, testIds: s.newTestIds, feedback: s.feedback };
        return out(ns, [eff]);
      }
      break;
  }

  // Événement inattendu dans cet état : on l'ignore (et on le journalise côté runner).
  return { state: s, effects: [] };

  // ---------- helpers internes ----------

  function startStep(ns: TddState) {
    return out({ ...ns, phase: "STEP_START" }, [{ kind: "createCheckpoint" }]);
  }

  function nextStep(ns: TddState) {
    const next = ns.steps.findIndex((st, i) => i > ns.current && st.status === "pending");
    if (next === -1) return out({ ...ns, phase: "DONE" });
    return startStep({ ...ns, current: next });
  }

  function finishStep(ns: TddState) {
    const steps = ns.steps.map((st, i) => i === ns.current ? { ...st, status: "done" as const } : st);
    return nextStep({ ...ns, steps, phase: "STEP_DONE" });
  }

  function retryOrEscalate(ns: TddState, reason: string, phase: Phase, rollbackTo: string, rerun: Effect) {
    const attempts = ns.attempts + 1;
    if (attempts >= ns.maxAttempts) {
      const st = { ...ns, phase: "ESCALATED" as Phase, attempts, feedback: reason,
        escalation: { from: phase, reason } };
      return out(st, [{ kind: "rollback", to: rollbackTo }, { kind: "askHuman", reason, from: phase }]);
    }
    return out({ ...ns, phase, attempts, feedback: reason },
      [{ kind: "rollback", to: rollbackTo }, rerun]);
  }
}

// ---------- Dépendances injectées (ton harnais / l'API ctx de l'extension) ----

export interface TestResult {
  id: string;
  status: "passed" | "failed" | "skipped";
  failureKind?: "assertion" | "missing_symbol" | "other_error";
}

export interface Deps {
  planner: { plan(feature: string, feedback?: string): Promise<Omit<Step, "status">[]> };
  testAgent: { run(step: Step, feedback?: string): Promise<void> };   // session SDK, périmètre tests/**
  devAgent: { run(mode: "green" | "refactor", step: Step, testIds: string[], feedback?: string): Promise<void> };
  tests: { run(): Promise<TestResult[]>; hashTestFiles(): Promise<string> };
  git: {
    head(): Promise<string>;
    changedFiles(since: string): Promise<string[]>;
    commit(message: string): Promise<string>;
    resetHard(sha: string): Promise<void>;
  };
  human: { reviewPlan(steps: Step[]): Promise<{ ok: true } | { ok: false; feedback: string }>;
           decide(reason: string, from: Phase): Promise<"retry" | "skip" | "abort"> };
  onState(s: TddState): void;                                          // UI, panneau, chat
  persist(s: TddState): Promise<void>;                                 // reprise après crash
  paths: { tests: RegExp; src: RegExp };
}

// ---------- Portes de vérification (exécutées par le CODE, jamais par un agent)

async function verifyRed(d: Deps, since: string, baseline: string[]): Promise<TddEvent> {
  const changed = await d.git.changedFiles(since);
  const outside = changed.filter(f => !d.paths.tests.test(f));
  if (outside.length) return fail(`Fichiers hors tests modifiés : ${outside.join(", ")}`);

  const results = await d.tests.run();
  const fresh = results.filter(r => !baseline.includes(r.id));
  if (fresh.length === 0) return fail("Aucun nouveau test détecté.");
  if (fresh.length > 1) return fail("Un seul test par étape RED.");
  const [t] = fresh;
  if (t.status === "passed") return fail("Le nouveau test passe déjà : comportement existant ou test trop faible.");
  if (t.status === "skipped") return fail("Le nouveau test est ignoré (.skip).");
  if (t.failureKind === "other_error") return fail("Le test échoue pour une mauvaise raison (syntaxe, crash du setup).");

  const regressions = results.filter(r => baseline.includes(r.id) && r.status !== "passed");
  if (regressions.length) return fail(`Régressions : ${regressions.map(r => r.id).join(", ")}`);

  const testsHash = await d.tests.hashTestFiles();
  const sha = await d.git.commit(`test: ${t.id}`);
  return { type: "VERIFY_OK", data: { newTestIds: [t.id], testsHash, sha } };
}

async function verifyGreen(d: Deps, since: string, testsHash: string, message: string): Promise<TddEvent> {
  if ((await d.tests.hashTestFiles()) !== testsHash)
    return fail("Les fichiers de test ont été modifiés : interdit pour l'agent dev.");

  const changed = await d.git.changedFiles(since);
  const outside = changed.filter(f => !d.paths.src.test(f));
  if (outside.length) return fail(`Fichiers hors src modifiés : ${outside.join(", ")}`);

  const results = await d.tests.run();
  const bad = results.filter(r => r.status !== "passed");
  if (bad.length) return fail(`Tests en échec ou ignorés : ${bad.map(r => r.id).join(", ")}`);

  const sha = await d.git.commit(message);
  return { type: "VERIFY_OK", data: { sha } };
}

const fail = (reason: string): TddEvent => ({ type: "VERIFY_FAIL", reason });

// ---------- Runner : exécute les effets et réinjecte les événements -----------

export class TddOrchestrator {
  private state: TddState;
  private queue: TddEvent[] = [];

  constructor(private d: Deps, state = initialState()) { this.state = state; }

  async start(feature: string) { await this.dispatch({ type: "START", feature }); }
  async abort() { await this.dispatch({ type: "ABORT" }); }
  get snapshot() { return this.state; }

  private async dispatch(first: TddEvent) {
    this.queue.push(first);
    while (this.queue.length) {
      const ev = this.queue.shift()!;
      const { state, effects } = transition(this.state, ev);
      this.state = state;
      await this.d.persist(state);
      for (const eff of effects) {
        const next = await this.run(eff);
        if (next) this.queue.push(next);
      }
    }
  }

  private async run(eff: Effect): Promise<TddEvent | void> {
    const d = this.d;
    switch (eff.kind) {
      case "emit": d.onState(eff.state); return;
      case "runPlanner":
        return { type: "PLAN_SUBMITTED", steps: await d.planner.plan(eff.feature, eff.feedback) };
      case "askPlanReview": {
        const r = await d.human.reviewPlan(eff.steps);
        return r.ok ? { type: "PLAN_APPROVED" } : { type: "PLAN_REJECTED", feedback: r.feedback };
      }
      case "createCheckpoint": {
        const sha = await d.git.head();
        const baselineTests = (await d.tests.run()).map(r => r.id);
        return { type: "CHECKPOINT_CREATED", sha, baselineTests };
      }
      case "runTestAgent": await d.testAgent.run(eff.step, eff.feedback); return { type: "AGENT_DONE" };
      case "runDevAgent":
        await d.devAgent.run(eff.mode, eff.step, eff.testIds, eff.feedback); return { type: "AGENT_DONE" };
      case "verifyRed": return verifyRed(d, eff.since, eff.baseline);
      case "verifyGreen": return verifyGreen(d, eff.since, eff.testsHash, eff.message);
      case "rollback": await d.git.resetHard(eff.to); return;
      case "commit": await d.git.commit(eff.message); return;
      case "askHuman":
        return { type: "HUMAN_DECISION", action: await d.human.decide(eff.reason, eff.from) };
    }
  }
}
