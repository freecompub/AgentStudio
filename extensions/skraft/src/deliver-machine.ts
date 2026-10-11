import { levelEffects } from "./difficulty.js";
import type { DeliverState, SkraftEffect, SkraftState } from "./model.js";
import type { Ev } from "./reducer.js";
import { agentFeedback, allDisputed, applyResponses, endTurn, isActive, type DefectThread } from "./review-thread.js";

type Out = { state: SkraftState; effects: SkraftEffect[] };
type AgentStep = "test" | "dev" | "green" | "refactor" | "fix-test" | "fix";

/** Un défaut de revue revient à l'agent des tests (`test`) ou au développeur (`code`, `deliverable`). */
const forTests = (t: DefectThread) => t.target === "test";
const forDev = (t: DefectThread) => t.target !== "test";
/** « Hors de mon périmètre » : le défaut passe à l'autre agent (ADR 0047). */
const otherAgent = (t: DefectThread) => (t.target === "test" ? "code" : "test");

/**
 * Réessais par phase, pour les mesures d'usage (§12). Tout rejet passe par ici, ce qui en fait
 * aussi le seul endroit où compter `rejections`, que le moteur lit pour tracer chaque rejet.
 */
export function bumpRetries(s: SkraftState, key: string): SkraftState {
  const retries = s.retries ?? {};
  return { ...s, retries: { ...retries, [key]: (retries[key] ?? 0) + 1 }, rejections: (s.rejections ?? 0) + 1 };
}

/**
 * Sous-machine DELIVER (SPEC-skraft §7.4). PURE. Pour chaque scénario : test unitaire rouge, puis
 * code (un tour, `turn-per-scenario`) ou vert puis nettoyage (sessions séparées, `session-per-step`),
 * jusqu'au vert du test d'acceptance ; puis porte de fin de scénario. Un scénario en échec en mode
 * tour repart de son début en sessions séparées (D22) ; en sessions séparées, le budget s'applique.
 */
export function deliverTransition(s0: SkraftState, e: Ev): Out | null {
  let s = s0;
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
      cycles: 0,
      feedback: s.lastRejection?.reasons ?? [],
      notes: [],
      facts: [],
      fixing: false,
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
      // Correction de revue : les réponses de l'agent (ADR 0046) attendent que sa porte valide le pas.
      if (d.step === "fix-test" || d.step === "fix") s = { ...s, deliver: { ...d, pendingResponses: e.responses ?? [] } };
      if (d.step === "fix-test")
        return { state: s, effects: [{ kind: "verifyFixTests", scenarioId: scenario.id, since: d.stepCheckpoint, baseline: d.baseline, ...editable(s) }] };
      if (d.step === "test")
        return {
          state: s,
          effects: [
            {
              kind: "verifyUnitRed",
              scenarioId: scenario.id,
              since: d.stepCheckpoint,
              baseline: d.baseline,
              pending: pending(d, true),
              ...(e.coveredBy ? { coveredBy: e.coveredBy } : {}),
            },
          ],
        };
      if (d.step === "fix")
        return {
          state: s,
          effects: [
            {
              kind: "verifyUnitGreen",
              mode: "fix",
              scenarioId: scenario.id,
              since: d.stepCheckpoint,
              newTest: null,
              unitTestsHash: d.unitTestsHash,
              pending: [],
              ...(d.fixTargets?.length ? { targets: d.fixTargets } : {}),
              ...(d.contractSymbols?.length ? { contractSymbols: d.contractSymbols } : {}),
              // Tout contesté ou renvoyé, sans test rouge à faire passer : rien à modifier (D7 de docs/12).
              ...(!d.fixTargets?.length && allDisputed(s.reviewThreads ?? [], e.responses ?? [], forDev) ? { nothingToChange: true as const } : {}),
            },
          ],
        };
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
          // Couvert par l'acceptance (ADR 0045) : le test d'acceptance est la cible du pas de code,
          // mais ce n'est pas un test unitaire du scénario — la séquence rouge puis vert des tests
          // unitaires ne le concerne pas.
          unitTests: newTest && !e.viaAcceptance ? [...d.unitTests, newTest] : d.unitTests,
          unitTestsHash: e.unitTestsHash ?? d.unitTestsHash,
          step: d.granularity === "turn-per-scenario" ? "dev" : "green",
        };
        return agent(s, nd, []);
      }
      if (d.step === "green") return agent(s, { ...base, newTest: null, acceptanceGreen: e.acceptanceGreen ?? false, step: "refactor" }, []);
      if (d.step === "dev" || d.step === "refactor") return afterCode(s, { ...base, newTest: null }, e.acceptanceGreen ?? d.acceptanceGreen);
      // Correction côté tests validée (ADR 0046) : au développeur s'il a des défauts ou des tests
      // rouges à faire passer ; sinon, directement la porte de fin de scénario.
      if (d.step === "fix-test") {
        s = closeTurn(s, d, forTests);
        const nd: DeliverState = { ...base, newTest: null, pendingResponses: [], fixTargets: e.fixTargets ?? [], unitTestsHash: e.unitTestsHash ?? d.unitTestsHash };
        const devWork = (s.reviewThreads ?? []).some((t) => isActive(t) && forDev(t));
        // Retour du développeur recalculé : un défaut renvoyé par le testeur a pu s'y ajouter.
        if (devWork || nd.fixTargets!.length) return agent(s, { ...nd, step: "fix", reviewFeedback: { test: d.reviewFeedback?.test ?? [], code: agentFeedback(s.reviewThreads ?? [], forDev) } }, []);
        return scenarioGate(s, { ...nd, unitTests: [] });
      }
      // Correction de revue validée : la porte de fin de scénario revérifie le code corrigé, et la
      // séquence rouge puis vert des tests rouges ajoutés par la correction côté tests.
      if (d.step === "fix") {
        s = closeTurn(s, d, forDev);
        // Un défaut renvoyé par le développeur au testeur (« hors de mon périmètre ») : au testeur
        // maintenant, avec le retour recalculé, plutôt que de le laisser sans personne. Un défaut ne
        // se renvoie qu'une fois et chaque tour clôt ceux de son agent : la correction se termine.
        const forTester = (s.reviewThreads ?? []).filter((t) => isActive(t) && forTests(t));
        if (forTester.length) {
          const test = agentFeedback(s.reviewThreads ?? [], forTests);
          return agent(s, { ...base, newTest: null, pendingResponses: [], step: "fix-test", reviewFeedback: { test, code: d.reviewFeedback?.code ?? [] }, reviewDefects: test }, []);
        }
        return scenarioGate(s, { ...base, newTest: null, pendingResponses: [], unitTests: d.fixTargets ?? [] });
      }
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
      const scenarios = d.scenarios.map((x, i) => (i === d.current ? { ...x, status: "done" as const, unitTests: d.fixing ? (x.unitTests ?? []) : d.unitTests } : x));
      const facts = [...new Set([...(d.facts ?? []), ...(e.facts ?? [])])];
      return nextScenario(s, { ...d, scenarios, notes: [...new Set([...d.notes, ...e.notes])], facts, feedback: [], fixing: false, reviewDefects: [] });
    }

    case "SCENARIO_FAIL":
      return scenarioFailure(s, d, e.reasons);
  }
  return null;
}

/** Pas de correction validé : réponses de l'agent appliquées, puis ses défauts restés actifs clos (`endTurn`). */
function closeTurn(s: SkraftState, d: DeliverState, concerns: (t: DefectThread) => boolean): SkraftState {
  if (!s.reviewThreads) return s;
  return { ...s, reviewThreads: endTurn(applyResponses(s.reviewThreads, d.pendingResponses ?? [], concerns, otherAgent), concerns) };
}

/** Tests d'acceptance encore autorisés à échouer : scénarios moteurs non terminés (dont le courant, ou non). */
function pending(d: DeliverState, includeCurrent: boolean): string[] {
  return d.scenarios.filter((x, i) => x.role === "driver" && x.status !== "done" && (includeCurrent || i !== d.current)).map((x) => x.acceptanceTestId);
}

/** Fichiers de tests cités par un défaut actif adressé au testeur : il peut les renforcer (D10 de docs/12). */
function editable(s: SkraftState): { editable?: string[] } {
  const files = [...new Set((s.reviewThreads ?? []).filter((t) => isActive(t) && forTests(t) && t.file).map((t) => t.file!))];
  return files.length ? { editable: files } : {};
}

function agent(s: SkraftState, d: DeliverState, feedback: string[]): Out {
  const step = d.step as AgentStep;
  // Correction de revue : chaque agent reçoit les défauts qui le concernent (ADR 0046), et ils
  // restent visibles à chaque relance (rejet de porte, blocage, reprise).
  const routed =
    step === "fix-test"
      ? (d.reviewFeedback?.test ?? [])
      : step === "fix"
        ? [
            ...(d.reviewFeedback?.code ?? d.reviewDefects ?? []),
            ...(d.fixTargets?.length ? [`Tests ajoutés par la correction côté tests, rouges : fais-les passer. ${d.fixTargets.join(", ")}`] : []),
          ]
        : [];
  const fb = step === "fix" || step === "fix-test" ? [...new Set([...routed, ...feedback])] : feedback;
  return {
    // Retour gardé jusqu'à la porte du pas : une question bloquante ne le fait pas perdre (D9 de docs/12).
    state: { ...s, stage: "SPECIALIST", deliver: { ...d, feedback } },
    effects: [{ kind: "runDeliverAgent", step, scenarioId: d.scenarios[d.current]!.id, attempt: d.attempts + 1, feedback: fb }],
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
  // Chaque cycle ajoute un test unitaire et un checkpoint : sans plafond, un scénario dont
  // l'acceptance ne verdit jamais tournerait sans fin, une requête par tour (D24).
  const cycles = d.cycles + 1;
  if (cycles >= s.budget.maxCyclesPerScenario)
    return scenarioFailure(s, { ...d, cycles }, [
      `Le test d'acceptance du scénario reste rouge après ${cycles} cycles test puis code.`,
    ]);
  return agent(s, { ...d, acceptanceGreen: false, step: "test", cycles }, []);
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

function stepFailure(s0: SkraftState, d: DeliverState, reasons: string[]): Out {
  const s = bumpRetries(s0, "DELIVER");
  const attempts = d.attempts + 1;
  if (attempts >= s.budget.maxAttemptsPerPhase) return scenarioFailure(s, d, reasons);
  const r = agent({ ...s, lastRejection: { gate: "DELIVER", reasons } }, { ...d, attempts }, reasons);
  return { state: r.state, effects: [{ kind: "rollback", to: d.stepCheckpoint! }, ...r.effects] };
}

/** Scénario repris depuis son début : en sessions séparées après un premier échec, puis selon le budget. */
function scenarioFailure(s0: SkraftState, d: DeliverState, reasons: string[]): Out {
  const s = d.step === "scenario-gate" ? bumpRetries(s0, "DELIVER") : s0;
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
    cycles: 0,
    baseline: d.scenarioBaseline,
    stepCheckpoint: d.scenarioCheckpoint,
    feedback: reasons,
  };
  const rollback: SkraftEffect[] = d.scenarioCheckpoint ? [{ kind: "rollback", to: d.scenarioCheckpoint }] : [];
  const lastRejection = { gate: `scénario ${sc.id}`, reasons };
  // Correction de revue : relancée depuis son point de départ, dans la limite du budget.
  if (d.fixing && failures < s.budget.maxAttemptsPerPhase) {
    // Le rollback ramène le code à l'entrée en correction : les fils y reviennent aussi, et le
    // premier pas dépend des défauts actifs — pas des lignes de rappel du retour.
    const threads = d.threadsAtFixStart ?? s.reviewThreads ?? [];
    const step = threads.some((t) => isActive(t) && forTests(t)) ? "fix-test" : "fix";
    const reviewFeedback = { test: agentFeedback(threads, forTests), code: agentFeedback(threads, forDev) };
    const nd: DeliverState = { ...restart, step, unitTests: [], fixTargets: [], pendingResponses: [], reviewFeedback, reviewDefects: step === "fix-test" ? reviewFeedback.test : reviewFeedback.code };
    const r = agent({ ...s, reviewThreads: threads, lastRejection }, nd, reasons);
    return { state: r.state, effects: [...rollback, ...r.effects] };
  }
  if (d.granularity === "turn-per-scenario" && !d.fixing) {
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

/**
 * Revue de DELIVER « changements demandés » (§9.3) : retour au dernier vert, relance de `skraft-dev`
 * avec les seuls défauts blocker et major ; la porte de fin de scénario revérifie le code corrigé.
 */
export function startReviewFix(s0: SkraftState, threads: DefectThread[]): Out {
  // Routage (ADR 0046) : les défauts de test d'abord, à l'agent des tests ; puis ceux du code, au
  // développeur. Chacun ne reçoit que ce qui le concerne.
  const feedback = { test: agentFeedback(threads, forTests), code: agentFeedback(threads, forDev) };
  const defects = [...feedback.test, ...feedback.code];
  const s = bumpRetries({ ...s0, attempts: s0.attempts + 1, lastRejection: { gate: "revue", reasons: defects } }, "DELIVER");
  const d = s.deliver!;
  const cp = d.stepCheckpoint!;
  const step = threads.some((t) => isActive(t) && forTests(t)) ? "fix-test" : "fix";
  const own = step === "fix-test" ? feedback.test : feedback.code;
  const nd: DeliverState = {
    ...d,
    step,
    fixing: true,
    threadsAtFixStart: threads,
    pendingResponses: [],
    reviewDefects: own,
    reviewFeedback: feedback,
    fixTargets: [],
    attempts: 0,
    scenarioFailures: 0,
    scenarioCheckpoint: cp,
    unitTests: [],
    newTest: null,
    feedback: own,
  };
  const r = agent(s, nd, []);
  return { state: r.state, effects: [{ kind: "rollback", to: cp }, ...r.effects] };
}
