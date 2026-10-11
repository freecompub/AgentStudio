import { phaseRoles } from "./config.js";
import { levelEffects } from "./difficulty.js";
import type { ArbitrageRecord, DeliverState, Derogation, SkraftEffect, SkraftState } from "./model.js";
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

  if (d.step === "mutation-arbitration") return arbitrageEnCours(s, d, e);

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
        // Mutants contestés comme équivalents : arbitrés avant de poursuivre (ADR 0065).
        return arbitrerMutants(s, { ...base, newTest: null, pendingResponses: [], fixTargets: e.fixTargets ?? [], unitTestsHash: e.unitTestsHash ?? d.unitTestsHash });
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
    scenarioUnitTestsHash: d.unitTestsHash,
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

/**
 * Empreinte des tests unitaires au point de reprise : celle de l'essai effacé ferait refuser chaque
 * pas de code de la reprise pour des tests « modifiés » (D12 de docs/12). Absente d'un état
 * enregistré avant ce champ : inchangée.
 */
function repriseDeLEmpreinte(d: DeliverState): { unitTestsHash?: string | null } {
  return d.scenarioUnitTestsHash !== undefined ? { unitTestsHash: d.scenarioUnitTestsHash } : {};
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
    ...repriseDeLEmpreinte(d),
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
      effects: [...rembobinerScenario(d), { kind: "askEscalation", reason, options: ["retry", "skip", "abort"] }],
    };
  }
  const r = agent({ ...s, lastRejection }, restart, reasons);
  return { state: r.state, effects: [...rollback, ...r.effects] };
}

/**
 * Escalade de DELIVER : retour au point de reprise du scénario (ou de la correction) ET oubli des
 * sessions du testeur et du développeur, qui se souviendraient d'un code effacé (ADR 0050, D20 de
 * docs/12). Les reprises sans escalade, elles, gardent leur session : leur motif dit que le tour est annulé.
 */
function rembobinerScenario(d: DeliverState): SkraftEffect[] {
  if (!d.scenarioCheckpoint) return [];
  return [{ kind: "rollback", to: d.scenarioCheckpoint }, { kind: "forgetSessions", roles: phaseRoles("DELIVER") }];
}

/** Panne d'environnement pendant un scénario : retour au début du scénario, escalade immédiate (D25). */
export function escalateDeliver(s: SkraftState, reason: string): Out {
  const d = s.deliver!;
  const restart: DeliverState = { ...d, step: "test", unitTests: [], newTest: null, acceptanceGreen: false, attempts: 0, baseline: d.scenarioBaseline, ...repriseDeLEmpreinte(d), stepCheckpoint: d.scenarioCheckpoint };
  return {
    state: { ...s, stage: "ESCALATED", deliver: restart, escalation: { from: "PHASE", reason } },
    effects: [...rembobinerScenario(d), { kind: "askEscalation", reason, options: ["retry", "skip", "abort"] }],
  };
}

/** « Relancer » après une escalade dans DELIVER : le scénario reprend à son début, budget remis à zéro. */
/**
 * « Relancer » après une escalade pendant une correction (panne, D14 de docs/12, ou échecs
 * répétés) : la correction reprend depuis son entrée, avec ses défauts d'entrée. Le rollback de
 * l'escalade a déjà ramené le code à ce point ; rien de livré n'est rejoué, aucune revue refaite.
 */
export function retryFix(s: SkraftState): Out {
  const d = s.deliver!;
  const threads = d.threadsAtFixStart ?? s.reviewThreads ?? [];
  const step = threads.some((t) => isActive(t) && forTests(t)) ? "fix-test" : "fix";
  const reviewFeedback = { test: agentFeedback(threads, forTests), code: agentFeedback(threads, forDev) };
  const { mutationArbitration: _, ...reste } = d;
  const nd: DeliverState = {
    ...reste,
    step,
    attempts: 0,
    unitTests: [],
    newTest: null,
    fixTargets: [],
    pendingResponses: [],
    reviewFeedback,
    reviewDefects: step === "fix-test" ? reviewFeedback.test : reviewFeedback.code,
    baseline: d.scenarioBaseline,
    ...repriseDeLEmpreinte(d),
    stepCheckpoint: d.scenarioCheckpoint,
  };
  return agent({ ...s, stage: "SPECIALIST", escalation: null, reviewThreads: threads }, nd, s.lastRejection?.reasons ?? []);
}

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
    // Point de reprise de la correction : la référence et l'empreinte y sont prises aussi (D12, D23 de docs/12).
    scenarioBaseline: d.baseline,
    scenarioUnitTestsHash: d.unitTestsHash,
    unitTests: [],
    newTest: null,
    feedback: own,
  };
  const r = agent(s, nd, []);
  return { state: r.state, effects: [{ kind: "rollback", to: cp }, ...r.effects] };
}

// ---------- arbitrage des mutants contestés (ADR 0065) ------------------------------

/** Au-delà, l'arbitre ne peut plus exempter de mutant : l'humain tranche (ADR 0065). */
export const MAX_DEROGATIONS_PAR_ARBITRE = 2;

const elementDe = (m: { file: string; line: number; operator: string }) => `${m.file}:${m.line} (${m.operator})`;
const memeMutant = (a: { file: string; line: number; operator: string }, b: { file: string; line: number; operator: string }) =>
  a.file === b.file && a.line === b.line && a.operator === b.operator;
const conteste = (t: DefectThread) => t.mutant !== undefined && (t.status === "contested" || t.status === "recontested");
const avecStatut = (s: SkraftState, id: string, status: DefectThread["status"]): SkraftState => ({
  ...s,
  reviewThreads: (s.reviewThreads ?? []).map((t) => (t.id === id ? { ...t, status } : t)),
});
const tracer = (s: SkraftState, t: DefectThread, décision: ArbitrageRecord["décision"], par: ArbitrageRecord["par"], raison: string): SkraftState => ({
  ...s,
  arbitrages: [...(s.arbitrages ?? []), { porte: "mutation", élément: elementDe(t.mutant!), contestation: t.contestation ?? "", décision, par, raison }],
});

/** Dérogation : tracée, et le mutant exempté de la porte de mutation (une seule fois). */
function accorder(s: SkraftState, t: DefectThread, par: Derogation["par"], raison: string): SkraftState {
  const m = t.mutant!;
  const derogations = s.derogations ?? [];
  const ns = tracer(s, t, "dérogation", par, raison);
  if (derogations.some((x) => memeMutant(x, m))) return ns;
  return { ...ns, derogations: [...derogations, { file: m.file, line: m.line, operator: m.operator, par, raison, contestation: t.contestation ?? "", defaut: t.id }] };
}

/**
 * Après le tour du testeur : les mutants qu'il conteste comme équivalents vont à l'arbitre de
 * mutation, puis à l'humain s'il refuse ou si le plafond de ses dérogations est atteint.
 */
function arbitrerMutants(s0: SkraftState, d: DeliverState): Out {
  let s = s0;
  const aJuger: DefectThread[] = [];
  for (const t of (s.reviewThreads ?? []).filter(conteste))
    // Déjà exempté (correction reprise après un échec) : rien à rejuger.
    if ((s.derogations ?? []).some((x) => memeMutant(x, t.mutant!))) s = avecStatut(s, t.id, "accepted");
    else aJuger.push(t);
  if (!aJuger.length) return apresCorrectionTests(s, d);
  const nd: DeliverState = { ...d, step: "mutation-arbitration", mutationArbitration: { human: [] } };
  if (restantes(s) > 0) return { state: { ...s, stage: "ARBITRATION", deliver: nd }, effects: [{ kind: "arbitrateMutants", threads: aJuger }] };
  const avis = `L'arbitre n'a pas été consulté : plafond de ${MAX_DEROGATIONS_PAR_ARBITRE} dérogations par l'arbitre atteint.`;
  return demanderHumain(s, { ...nd, mutationArbitration: { human: aJuger.map((t) => ({ id: t.id, avis })) } });
}

const restantes = (s: SkraftState) => MAX_DEROGATIONS_PAR_ARBITRE - (s.derogations ?? []).filter((x) => x.par === "agent").length;

function arbitrageEnCours(s0: SkraftState, d: DeliverState, e: Ev): Out | null {
  let s = s0;
  const fil = (id: string) => (s.reviewThreads ?? []).find((t) => t.id === id);
  if (e.type === "MUTANTS_JUDGED") {
    const human: { id: string; avis: string }[] = [];
    let accordes = 0;
    const plafond = restantes(s);
    for (const t of (s.reviewThreads ?? []).filter(conteste)) {
      const j = e.rulings.find((r) => r.defect === t.id);
      if (j?.decision === "accepted" && accordes < plafond) {
        accordes++;
        s = avecStatut(accorder(s, t, "agent", j.reason ?? ""), t.id, "accepted");
        continue;
      }
      if (j?.decision === "maintained") s = tracer(s, t, "à corriger", "agent", j.reason ?? "");
      const avis = !j
        ? "L'arbitre n'a rien rendu pour ce mutant."
        : j.decision === "accepted"
          ? `L'arbitre le juge équivalent (${j.reason ?? "sans raison"}), mais le plafond de ${MAX_DEROGATIONS_PAR_ARBITRE} dérogations par l'arbitre est atteint.`
          : `L'arbitre le juge non équivalent : ${j.reason ?? "sans raison"}.`;
      human.push({ id: t.id, avis });
    }
    return demanderHumain(s, { ...d, mutationArbitration: { human } });
  }
  if (e.type === "HUMAN_DECISION") {
    const attendu = d.mutationArbitration?.human[0];
    const i = e.decision.indexOf(":");
    const [choix, id] = [e.decision.slice(0, i), e.decision.slice(i + 1)];
    const t = attendu && id === attendu.id ? fil(id) : undefined;
    if (!t || (choix !== "derogation" && choix !== "corriger")) return { state: s, effects: [] };
    s =
      choix === "derogation"
        ? avecStatut(accorder(s, t, "humain", e.comment ?? "(sans justification)"), t.id, "humanAccepted")
        : avecStatut(tracer(s, t, "à corriger", "humain", e.comment ?? ""), t.id, "humanMaintained");
    return demanderHumain(s, { ...d, mutationArbitration: { human: d.mutationArbitration!.human.slice(1) } });
  }
  return null;
}

/** Prochain mutant à soumettre à l'humain ; quand il n'y en a plus, la correction reprend. */
function demanderHumain(s: SkraftState, d: DeliverState): Out {
  const suivant = d.mutationArbitration?.human[0];
  if (!suivant) {
    const { mutationArbitration: _, ...reste } = d;
    return apresCorrectionTests(s, { ...reste, step: "fix-test" });
  }
  const thread = (s.reviewThreads ?? []).find((t) => t.id === suivant.id)!;
  return { state: { ...s, stage: "ARBITRATION", deliver: d }, effects: [{ kind: "askMutationArbitration", thread, avis: suivant.avis }] };
}

/**
 * Correction côté tests validée (ADR 0046) : au testeur de nouveau s'il lui reste un défaut (un
 * mutant que l'humain exige de tuer), au développeur s'il a des défauts ou des tests rouges à faire
 * passer ; sinon, directement la porte de fin de scénario.
 */
function apresCorrectionTests(s: SkraftState, nd: DeliverState): Out {
  const threads = s.reviewThreads ?? [];
  if (threads.some((t) => isActive(t) && forTests(t))) {
    const test = agentFeedback(threads, forTests);
    return agent(s, { ...nd, step: "fix-test", reviewFeedback: { test, code: nd.reviewFeedback?.code ?? [] }, reviewDefects: test }, []);
  }
  const devWork = threads.some((t) => isActive(t) && forDev(t));
  // Retour du développeur recalculé : un défaut renvoyé par le testeur a pu s'y ajouter.
  if (devWork || nd.fixTargets?.length) return agent(s, { ...nd, step: "fix", reviewFeedback: { test: nd.reviewFeedback?.test ?? [], code: agentFeedback(threads, forDev) } }, []);
  return scenarioGate(s, { ...nd, unitTests: [] });
}
