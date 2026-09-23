import { levelEffects } from "./difficulty.js";
import type { DeliverState, SkraftEffect, SkraftState } from "./model.js";
import type { Ev } from "./reducer.js";

type Out = { state: SkraftState; effects: SkraftEffect[] };
type AgentStep = "test" | "dev" | "green" | "refactor";

/**
 * Sous-machine DELIVER (SPEC-skraft §7.4). PURE. Pour chaque scénario : test unitaire rouge, puis
 * code (un tour, `turn-per-scenario`) ou vert puis nettoyage (sessions séparées, `session-per-step`),
 * jusqu'au vert du test d'acceptance ; puis porte de fin de scénario. Un scénario en échec en mode
 * tour repart de son début en sessions séparées (D22) ; en sessions séparées, le budget s'applique.
 */
export function deliverTransition(s: SkraftState, e: Ev): Out | null {
  if (e.type === "DELIVER_PLANNED") {
    const granularity = s.granularitySetting ?? levelEffects(s.difficulty?.level ?? "medium").granularity;
    const baseline = { all: e.all, passed: e.passed };
    return nextScenario(s, {
      scenarios: e.scenarios,
      current: 0,
      granularity,
      acceptanceHash: s.acceptanceHash ?? "",
      unitTestsHash: null,
      scenarioCheckpoint: null,
      step: "test",
      stepCheckpoint: null,
      baseline,
      scenarioBaseline: baseline,
      unitTests: [],
      newTest: null,
      acceptanceGreen: false,
      attempts: 0,
      scenarioFailures: 0,
      feedback: s.lastRejection?.reasons ?? [],
      notes: [],
    });
  }
  const d = s.deliver;
  if (!d) return null;
  const scenario = d.scenarios[d.current]!;

  switch (e.type) {
    case "SCENARIO_STARTED": {
      const nd: DeliverState = { ...d, scenarioCheckpoint: e.checkpointId, stepCheckpoint: e.checkpointId };
      // Déjà vert (un scénario précédent l'a fait passer) : directement la porte de fin de scénario.
      if (d.baseline.passed.includes(scenario.acceptanceTestId)) return scenarioGate(s, nd);
      return agent(s, { ...nd, step: "test" }, nd.feedback);
    }

    case "AGENT_REPORTED": {
      if (d.step === "scenario-gate" || !d.stepCheckpoint) return null;
      if (d.step === "test")
        return { state: s, effects: [{ kind: "verifyUnitRed", scenarioId: scenario.id, since: d.stepCheckpoint, baseline: d.baseline, pending: pending(d, true) }] };
      return {
        state: s,
        effects: [
          { kind: "verifyUnitGreen", mode: d.step, scenarioId: scenario.id, since: d.stepCheckpoint, newTest: d.newTest, unitTestsHash: d.unitTestsHash, pending: pending(d, true) },
        ],
      };
    }

    case "STEP_OK": {
      const base: DeliverState = { ...d, baseline: { all: e.all, passed: e.passed }, stepCheckpoint: e.checkpointId, attempts: 0, feedback: [] };
      if (d.step === "test") {
        const newTest = e.newTest ?? null;
        const nd: DeliverState = {
          ...base,
          newTest,
          unitTests: newTest ? [...d.unitTests, newTest] : d.unitTests,
          unitTestsHash: e.unitTestsHash ?? d.unitTestsHash,
          step: d.granularity === "turn-per-scenario" ? "dev" : "green",
        };
        return agent(s, nd, []);
      }
      if (d.step === "green") return agent(s, { ...base, newTest: null, acceptanceGreen: e.acceptanceGreen ?? false, step: "refactor" }, []);
      if (d.step === "dev" || d.step === "refactor") return afterCode(s, { ...base, newTest: null }, e.acceptanceGreen ?? d.acceptanceGreen);
      return null;
    }

    case "STEP_FAIL":
    case "TIMEOUT": {
      const reason = e.reason;
      if (d.step === "scenario-gate") return scenarioFailure(s, d, [reason]);
      // Nettoyage refusé : retour au vert, sans escalade (SPEC.md §8.3).
      if (d.step === "refactor") {
        const r = afterCode(s, { ...d, notes: [...d.notes, `Scénario ${scenario.id} : nettoyage annulé (${reason})`] }, d.acceptanceGreen);
        return { state: r.state, effects: [{ kind: "rollback", to: d.stepCheckpoint! }, ...r.effects] };
      }
      return stepFailure(s, d, [reason]);
    }

    case "SCENARIO_OK": {
      const scenarios = d.scenarios.map((x, i) => (i === d.current ? { ...x, status: "done" as const } : x));
      return nextScenario(s, { ...d, scenarios, notes: [...new Set([...d.notes, ...e.notes])], feedback: [] });
    }

    case "SCENARIO_FAIL":
      return scenarioFailure(s, d, e.reasons);
  }
  return null;
}

/** Tests d'acceptance encore autorisés à échouer : scénarios moteurs non terminés (dont le courant, ou non). */
function pending(d: DeliverState, includeCurrent: boolean): string[] {
  return d.scenarios.filter((x, i) => x.role === "driver" && x.status !== "done" && (includeCurrent || i !== d.current)).map((x) => x.acceptanceTestId);
}

function agent(s: SkraftState, d: DeliverState, feedback: string[]): Out {
  const step = d.step as AgentStep;
  return {
    state: { ...s, stage: "SPECIALIST", deliver: d },
    effects: [{ kind: "runDeliverAgent", step, scenarioId: d.scenarios[d.current]!.id, attempt: d.attempts + 1, feedback }],
  };
}

/** Pas en cours relancé (réponse à un blocage, reprise après escalade). */
export function resumeDeliver(s: SkraftState, feedback: string[]): Out {
  const d = s.deliver!;
  if (d.step === "scenario-gate") return scenarioGate(s, d);
  return agent(s, d, feedback);
}

function scenarioGate(s: SkraftState, d: DeliverState): Out {
  const nd: DeliverState = { ...d, step: "scenario-gate" };
  const sc = nd.scenarios[nd.current]!;
  return {
    state: { ...s, stage: "SPECIALIST", deliver: nd },
    effects: [{ kind: "scenarioGate", scenarioId: sc.id, since: nd.scenarioCheckpoint!, unitTests: nd.unitTests, pending: pending(nd, false) }],
  };
}

function afterCode(s: SkraftState, d: DeliverState, acceptanceGreen: boolean): Out {
  if (acceptanceGreen) return scenarioGate(s, { ...d, acceptanceGreen });
  return agent(s, { ...d, acceptanceGreen: false, step: "test" }, []);
}

function nextScenario(s: SkraftState, d: DeliverState): Out {
  const i = d.scenarios.findIndex((x) => x.role === "driver" && x.status === "pending");
  if (i === -1) return { state: { ...s, stage: "ARTIFACT_GATE", deliver: d }, effects: [{ kind: "runGate", phase: "DELIVER", attempt: s.attempts + 1 }] };
  const scenarios = d.scenarios.map((x, j) => (j === i ? { ...x, status: "in_progress" as const } : x));
  const nd: DeliverState = {
    ...d,
    scenarios,
    current: i,
    step: "test",
    unitTests: [],
    newTest: null,
    acceptanceGreen: false,
    attempts: 0,
    scenarioFailures: 0,
    scenarioBaseline: d.baseline,
  };
  return { state: { ...s, stage: "SPECIALIST", deliver: nd }, effects: [{ kind: "startScenario", scenarioId: scenarios[i]!.id }] };
}

function stepFailure(s: SkraftState, d: DeliverState, reasons: string[]): Out {
  const attempts = d.attempts + 1;
  if (attempts >= s.budget.maxAttemptsPerPhase) return scenarioFailure(s, d, reasons);
  const r = agent({ ...s, lastRejection: { gate: "DELIVER", reasons } }, { ...d, attempts }, reasons);
  return { state: r.state, effects: [{ kind: "rollback", to: d.stepCheckpoint! }, ...r.effects] };
}

/** Scénario repris depuis son début : en sessions séparées après un premier échec, puis selon le budget. */
function scenarioFailure(s: SkraftState, d: DeliverState, reasons: string[]): Out {
  const sc = d.scenarios[d.current]!;
  const failures = d.scenarioFailures + 1;
  const restart: DeliverState = {
    ...d,
    step: "test",
    unitTests: [],
    newTest: null,
    acceptanceGreen: false,
    attempts: 0,
    scenarioFailures: failures,
    baseline: d.scenarioBaseline,
    stepCheckpoint: d.scenarioCheckpoint,
    feedback: reasons,
  };
  const rollback: SkraftEffect[] = d.scenarioCheckpoint ? [{ kind: "rollback", to: d.scenarioCheckpoint }] : [];
  const lastRejection = { gate: `scénario ${sc.id}`, reasons };
  if (d.granularity === "turn-per-scenario") {
    const nd: DeliverState = { ...restart, granularity: "session-per-step", notes: [...d.notes, `Scénario ${sc.id} : repris en sessions séparées après un échec.`] };
    const r = agent({ ...s, lastRejection }, nd, reasons);
    return { state: r.state, effects: [...rollback, ...r.effects] };
  }
  if (failures >= s.budget.maxAttemptsPerPhase) {
    const reason = `Scénario ${sc.id} : ${reasons.join(" ; ")}`;
    return {
      state: { ...s, stage: "ESCALATED", deliver: restart, lastRejection, escalation: { from: "PHASE", reason } },
      effects: [...rollback, { kind: "askEscalation", reason, options: ["retry", "skip", "abort"] }],
    };
  }
  const r = agent({ ...s, lastRejection }, restart, reasons);
  return { state: r.state, effects: [...rollback, ...r.effects] };
}

/** Panne d'environnement pendant un scénario : retour au début du scénario, escalade immédiate (D25). */
export function escalateDeliver(s: SkraftState, reason: string): Out {
  const d = s.deliver!;
  const restart: DeliverState = { ...d, step: "test", unitTests: [], newTest: null, acceptanceGreen: false, attempts: 0, baseline: d.scenarioBaseline, stepCheckpoint: d.scenarioCheckpoint };
  return {
    state: { ...s, stage: "ESCALATED", deliver: restart, escalation: { from: "PHASE", reason } },
    effects: [...(d.scenarioCheckpoint ? [{ kind: "rollback", to: d.scenarioCheckpoint } as SkraftEffect] : []), { kind: "askEscalation", reason, options: ["retry", "skip", "abort"] }],
  };
}

/** « Relancer » après une escalade dans DELIVER : le scénario reprend à son début, budget remis à zéro. */
export function retryDeliver(s: SkraftState): Out {
  const d = s.deliver!;
  if (!d.scenarioCheckpoint) return { state: { ...s, stage: "SPECIALIST", escalation: null }, effects: [{ kind: "startScenario", scenarioId: d.scenarios[d.current]!.id }] };
  return agent({ ...s, escalation: null }, { ...d, step: "test", attempts: 0, scenarioFailures: 0 }, s.lastRejection?.reasons ?? []);
}
