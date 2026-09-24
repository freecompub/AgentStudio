import type { TaskEvent } from "@agent-studio/task-engine";
import type { Step, TddEffect, TddEvent, TddInput, TddState } from "./model.js";

export type Ev = TaskEvent<TddEvent>;
type Out = { state: TddState; effects: TddEffect[] };
type AgentPhase = "RED" | "GREEN";

export function initialState(input: TddInput): TddState {
  return {
    phase: "PLANNING",
    feature: input.feature,
    steps: [],
    current: 0,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 3,
    skipRefactor: input.skipRefactor ?? false,
    autoApprovePlan: input.autoApprovePlan ?? false,
    granularity: input.granularity ?? "turn",
    stepStrict: false,
    checkpoints: {},
    baselineTests: [],
    newTestIds: [],
    reports: [],
    retries: {},
  };
}

const bump = (r: Record<string, number>, phase: string) => ({ ...r, [phase]: (r[phase] ?? 0) + 1 });

export function initialEffects(s: TddState): TddEffect[] {
  return [{ kind: "runPlanner", feature: s.feature }];
}

export const isTerminal = (s: TddState): boolean => s.phase === "DONE" || s.phase === "ABORTED";

const ESCALATION_OPTIONS = {
  PLANNING: ["retry", "abort"],
  RED: ["retry", "skip", "abort"],
  GREEN: ["retry", "skip", "abort"],
} as const;

/**
 * Machine à états TDD (§8.2). PURE : aucune I/O ; le LLM ne choisit jamais la transition (D16).
 * Budget de réessais appliqué ici (D24) ; TIMEOUT = rejet, ENV_FAILURE = escalade (D25).
 */
export function transition(s: TddState, e: Ev): Out {
  const same: Out = { state: s, effects: [] };
  if (isTerminal(s)) return same;
  if (e.type === "ABORT") return { state: { ...s, phase: "ABORTED" }, effects: [] };
  if (e.type === "RESUMED") return same;

  const step = s.steps[s.current];

  switch (s.phase) {
    case "PLANNING":
      if (e.type === "PLAN_SUBMITTED") {
        if (e.steps.length === 0) return { state: { ...s, phase: "DONE" }, effects: [] };
        const ids = e.steps.map((st) => st.id);
        if (new Set(ids).size !== ids.length)
          return { state: s, effects: [{ kind: "runPlanner", feature: s.feature, feedback: "Chaque étape doit avoir un identifiant unique." }] };
        const steps: Step[] = e.steps.map((st) => ({ id: st.id, behavior: st.behavior, status: "pending" }));
        const planned: TddState = { ...s, steps, current: 0, attempts: 0 };
        if (s.autoApprovePlan) return startStep(planned);
        return { state: { ...planned, phase: "PLAN_REVIEW" }, effects: [{ kind: "askPlanReview", steps }] };
      }
      if (e.type === "TIMEOUT") return retryOrEscalate(s, e.reason, "PLANNING", null, { kind: "runPlanner", feature: s.feature });
      if (e.type === "ENV_FAILURE") return escalate(s, e.reason, "PLANNING", null);
      break;

    case "PLAN_REVIEW":
      if (e.type === "HUMAN_DECISION" && e.decision === "approve") return startStep({ ...s, current: 0 });
      if (e.type === "HUMAN_DECISION" && e.decision === "reject") {
        const feedback = e.comment ?? "Plan refusé par l'utilisateur.";
        return {
          state: { ...s, phase: "PLANNING", steps: [], feedback },
          effects: [{ kind: "runPlanner", feature: s.feature, feedback }],
        };
      }
      break;

    case "STEP_START":
      if (e.type === "CHECKPOINT_CREATED" && step) {
        const ns: TddState = withoutFeedback({
          ...s,
          phase: "RED",
          attempts: 0,
          checkpoints: { step: e.checkpointId },
          baselineTests: e.baselineTests,
          newTestIds: [],
        });
        delete ns.testsHash;
        if (s.granularity === "turn" && !s.stepStrict) return { state: { ...ns, phase: "CYCLE" }, effects: [{ kind: "runPairAgent", step }] };
        return { state: ns, effects: [{ kind: "runTestAgent", step }] };
      }
      if (e.type === "ENV_FAILURE") return escalate(s, e.reason, "RED", null);
      break;

    case "CYCLE":
      if (!step || !s.checkpoints.step) break;
      if (e.type === "AGENT_DONE")
        return {
          state: { ...s, phase: "CYCLE_VERIFY", reports: [...s.reports, report(step, "CYCLE", e)] },
          effects: [{ kind: "verifyCycle", since: s.checkpoints.step, baseline: s.baselineTests, step, ...(e.runId ? { runId: e.runId } : {}) }],
        };
      if (e.type === "TIMEOUT") return fallbackToStrict(s, e.reason);
      if (e.type === "ENV_FAILURE") return escalate(s, e.reason, "RED", s.checkpoints.step);
      break;

    case "CYCLE_VERIFY":
      if (!s.checkpoints.step) break;
      if (e.type === "VERIFY_OK" && e.newTestIds && e.testsHash)
        return finishStep({ ...withoutFeedback(s), newTestIds: e.newTestIds, testsHash: e.testsHash, checkpoints: { ...s.checkpoints, green: e.checkpointId } });
      if (e.type === "VERIFY_FAIL") return fallbackToStrict(s, e.reason);
      if (e.type === "ENV_FAILURE") return escalate(s, e.reason, "RED", s.checkpoints.step);
      break;

    case "RED":
      if (!step || !s.checkpoints.step) break;
      if (e.type === "AGENT_DONE")
        return {
          state: { ...s, phase: "RED_VERIFY", reports: [...s.reports, report(step, "RED", e)] },
          effects: [{ kind: "verifyRed", since: s.checkpoints.step, baseline: s.baselineTests, step }],
        };
      return agentFailure(s, e, "RED");

    case "RED_VERIFY":
      if (!step || !s.checkpoints.step) break;
      if (e.type === "VERIFY_OK" && e.newTestIds && e.testsHash) {
        const ns = withoutFeedback({
          ...s,
          phase: "GREEN",
          attempts: 0,
          newTestIds: e.newTestIds,
          testsHash: e.testsHash,
          checkpoints: { ...s.checkpoints, red: e.checkpointId },
        });
        return { state: ns, effects: [{ kind: "runDevAgent", mode: "green", step, testIds: ns.newTestIds }] };
      }
      if (e.type === "VERIFY_FAIL") return agentFailure(s, { type: "TIMEOUT", reason: e.reason }, "RED");
      if (e.type === "ENV_FAILURE") return escalate(s, e.reason, "RED", s.checkpoints.step);
      break;

    case "GREEN":
      if (!step || !s.checkpoints.red || !s.testsHash) break;
      if (e.type === "AGENT_DONE")
        return {
          state: { ...s, phase: "GREEN_VERIFY", reports: [...s.reports, report(step, "GREEN", e)] },
          effects: [{ kind: "verifyGreen", since: s.checkpoints.red, testsHash: s.testsHash, message: `feat: ${step.behavior}`, mode: "green" }],
        };
      return agentFailure(s, e, "GREEN");

    case "GREEN_VERIFY":
      if (!step || !s.checkpoints.red) break;
      if (e.type === "VERIFY_OK") {
        const ns = withoutFeedback({ ...s, attempts: 0, checkpoints: { ...s.checkpoints, green: e.checkpointId } });
        if (s.skipRefactor) return finishStep(ns);
        return { state: { ...ns, phase: "REFACTOR" }, effects: [{ kind: "runDevAgent", mode: "refactor", step, testIds: s.newTestIds }] };
      }
      if (e.type === "VERIFY_FAIL") return agentFailure(s, { type: "TIMEOUT", reason: e.reason }, "GREEN");
      if (e.type === "ENV_FAILURE") return escalate(s, e.reason, "GREEN", s.checkpoints.red);
      break;

    case "REFACTOR":
      if (!step || !s.checkpoints.green || !s.testsHash) break;
      if (e.type === "AGENT_DONE")
        return {
          state: { ...s, phase: "REFACTOR_VERIFY", reports: [...s.reports, report(step, "REFACTOR", e)] },
          effects: [{ kind: "verifyGreen", since: s.checkpoints.green, testsHash: s.testsHash, message: `refactor: ${step.behavior}`, mode: "refactor" }],
        };
      // Un nettoyage raté ou muet n'est jamais bloquant : on garde le vert (§8.3).
      if (e.type === "TIMEOUT" || e.type === "ENV_FAILURE") return discardRefactor(s, e.reason, s.checkpoints.green);
      break;

    case "REFACTOR_VERIFY":
      if (!s.checkpoints.green) break;
      if (e.type === "VERIFY_OK") return finishStep(s);
      if (e.type === "VERIFY_FAIL" || e.type === "ENV_FAILURE") return discardRefactor(s, e.reason, s.checkpoints.green);
      break;

    case "ESCALATED":
      if (e.type === "HUMAN_DECISION" && s.escalation) return decide(s, e.decision, s.escalation.from);
      break;
  }
  return same;
}

// ---------- aides internes ------------------------------------------------------

function report(step: Step, phase: "CYCLE" | "RED" | "GREEN" | "REFACTOR", e: { summary: string; files: string[] }) {
  return { stepId: step.id, phase, summary: e.summary, files: e.files };
}

function withoutFeedback(s: TddState): TddState {
  const { feedback: _f, escalation: _e, ...rest } = s;
  return rest;
}

/** D22 : un échec du tour unique fait passer l'étape en mode strict, sans consommer le budget. */
function fallbackToStrict(s: TddState, reason: string): Out {
  const step = s.steps[s.current]!;
  const feedback = `Le tour unique a été rejeté (${reason}) : reprise pas à pas.`;
  return {
    state: { ...s, phase: "RED", stepStrict: true, attempts: 0, feedback, retries: bump(s.retries, "CYCLE") },
    effects: [
      { kind: "rollback", to: s.checkpoints.step! },
      { kind: "runTestAgent", step, feedback },
    ],
  };
}

function startStep(s: TddState): Out {
  const step = s.steps[s.current];
  if (!step) return { state: { ...s, phase: "DONE" }, effects: [] };
  return { state: { ...s, phase: "STEP_START", stepStrict: false }, effects: [{ kind: "createCheckpoint", label: `Avant l'étape ${step.id}` }] };
}

function nextStep(s: TddState): Out {
  const next = s.steps.findIndex((st, i) => i > s.current && st.status === "pending");
  if (next === -1) return { state: { ...s, phase: "DONE" }, effects: [] };
  return startStep({ ...s, current: next });
}

function finishStep(s: TddState): Out {
  const steps = s.steps.map((st, i) => (i === s.current ? { ...st, status: "done" as const } : st));
  return nextStep({ ...s, steps });
}

function discardRefactor(s: TddState, reason: string, green: string): Out {
  const r = finishStep({ ...s, feedback: reason });
  return { state: r.state, effects: [{ kind: "rollback", to: green }, ...r.effects] };
}

function rerunEffect(s: TddState, phase: AgentPhase, feedback: string): TddEffect {
  const step = s.steps[s.current]!;
  return phase === "RED"
    ? { kind: "runTestAgent", step, feedback }
    : { kind: "runDevAgent", mode: "green", step, testIds: s.newTestIds, feedback };
}

/** Point de retour d'une phase d'agent : début d'étape pour RED, point rouge pour GREEN. */
function phaseStart(s: TddState, phase: AgentPhase): string | null {
  return (phase === "RED" ? s.checkpoints.step : s.checkpoints.red) ?? null;
}

function agentFailure(s: TddState, e: Ev, phase: AgentPhase): Out {
  if (e.type === "TIMEOUT") return retryOrEscalate(s, e.reason, phase, phaseStart(s, phase), rerunEffect(s, phase, e.reason));
  if (e.type === "ENV_FAILURE") return escalate(s, e.reason, phase, phaseStart(s, phase));
  return { state: s, effects: [] };
}

function retryOrEscalate(
  s: TddState,
  reason: string,
  phase: "PLANNING" | AgentPhase,
  rollbackTo: string | null,
  rerun: TddEffect,
): Out {
  const attempts = s.attempts + 1;
  if (attempts >= s.maxAttempts) return escalate({ ...s, attempts }, reason, phase, rollbackTo);
  const rollback: TddEffect[] = rollbackTo ? [{ kind: "rollback", to: rollbackTo }] : [];
  return { state: { ...s, phase, attempts, feedback: reason, retries: bump(s.retries, phase) }, effects: [...rollback, rerun] };
}

function escalate(s: TddState, reason: string, from: "PLANNING" | AgentPhase, rollbackTo: string | null): Out {
  const rollback: TddEffect[] = rollbackTo ? [{ kind: "rollback", to: rollbackTo }] : [];
  return {
    state: { ...s, phase: "ESCALATED", feedback: reason, escalation: { from, reason } },
    effects: [...rollback, { kind: "askHuman", reason, from, options: [...ESCALATION_OPTIONS[from]] }],
  };
}

function decide(s: TddState, decision: string, from: "PLANNING" | AgentPhase): Out {
  const { escalation: _e, ...rest } = s;
  const base: TddState = rest;
  if (decision === "abort") return { state: { ...base, phase: "ABORTED" }, effects: [] };
  if (decision === "retry") {
    if (from !== "PLANNING" && !s.checkpoints.step) return startStep({ ...base, attempts: 0 });
    if (from === "PLANNING")
      return { state: { ...base, phase: "PLANNING", attempts: 0 }, effects: [{ kind: "runPlanner", feature: s.feature }] };
    return { state: { ...base, phase: from, attempts: 0 }, effects: [rerunEffect(s, from, s.feedback ?? "")] };
  }
  if (decision === "skip" && from !== "PLANNING" && s.checkpoints.step) {
    const steps = s.steps.map((st, i) => (i === s.current ? { ...st, status: "skipped" as const } : st));
    const r = nextStep({ ...base, steps });
    return { state: r.state, effects: [{ kind: "rollback", to: s.checkpoints.step }, ...r.effects] };
  }
  return { state: s, effects: [] };
}
