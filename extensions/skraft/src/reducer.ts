import type { TaskEvent } from "@agent-studio/task-engine";
import { commitMessage, PHASE_ORDER, REVIEWED_PHASES, specialistRole } from "./config.js";
import { DEFAULT_THRESHOLDS, gradeDifficulty, isDifficulty, lensesForPhase, levelEffects, shift, type Difficulty } from "./difficulty.js";
import type { AdrRecord, Phase, SkraftEffect, SkraftEvent, SkraftInput, SkraftState } from "./model.js";
import { actionableDefects, synthesize, type LensVerdict } from "./review.js";
import { bumpRetries, deliverTransition, escalateDeliver, resumeDeliver, retryDeliver, startReviewFix } from "./deliver-machine.js";

export type Ev = TaskEvent<SkraftEvent>;
type Out = { state: SkraftState; effects: SkraftEffect[] };

const emptyByPhase = <T>(): Record<Phase, T[]> => ({ RESEARCH: [], DESIGN: [], DISTILL: [], DELIVER: [] });

export function initialState(input: SkraftInput): SkraftState {
  return {
    schemaVersion: 1,
    slug: "",
    storyPath: input.storyPath,
    stage: "INIT",
    phase: null,
    phaseOrder: [...(input.phaseOrder ?? PHASE_ORDER)],
    skipPhases: [],
    phasesCompleted: [],
    difficulty: null,
    baseSha: "",
    branch: "",
    checkpoints: {},
    artifacts: emptyByPhase(),
    reviews: emptyByPhase(),
    attempts: 0,
    budget: { maxAttemptsPerPhase: 3, maxCyclesPerScenario: 20 },
    lastRejection: null,
    openQuestions: [],
    adrs: [],
    pendingInteraction: null,
    deliver: null,
    confirmDifficulty: input.confirmDifficulty ?? true,
    story: null,
    indicators: null,
    proposed: null,
    lenses: [],
    designStep: "model",
    blocker: null,
    escalation: null,
    answers: [],
    questionsAsked: [],
    acceptanceHash: null,
    regressions: [],
    granularitySetting: input.granularity ?? null,
    retries: {},
  };
}

export const initialEffects = (s: SkraftState): SkraftEffect[] => [{ kind: "init", storyPath: s.storyPath }];

export const isTerminal = (s: SkraftState): boolean => s.stage === "DONE" || s.stage === "ABORTED";

/** Nom d'état pour l'usage et la carte : la phase en cours, sinon le stage (§11, D37). */
export const phaseOf = (s: SkraftState): string =>
  ["REVIEW", "RATIFICATION", "BLOCKED", "ESCALATED", "DONE", "ABORTED", "CLASSIFY", "CONFIRM_DIFFICULTY", "INIT", "ROUTE"].includes(s.stage) || !s.phase ? s.stage : s.phase;

/**
 * Réducteur du pipeline (SPEC-skraft §5.2). PUR : aucune I/O. Le LLM ne choisit jamais la
 * transition suivante (D16) ; l'ordre des phases, le budget et la ratification sont imposés ici.
 */
export function transition(s0: SkraftState, e: Ev): Out {
  if (isTerminal(s0)) return { state: s0, effects: [] };
  // Chaque chargement de skill facultative est tracé dans l'état, quelle que soit la suite (D26).
  const s: SkraftState =
    e.type === "AGENT_REPORTED" && e.skills?.length ? { ...s0, skillsLoaded: [...(s0.skillsLoaded ?? []), { phase: s0.phase, role: e.role, skills: [...e.skills] }] } : s0;
  const same: Out = { state: s, effects: [] };
  if (e.type === "ABORT") return { state: { ...s, stage: "ABORTED" }, effects: [] };
  if (e.type === "RESUMED") return same;
  if (e.type === "ENV_FAILURE") return escalate(s, e.reason);

  switch (s.stage) {
    case "INIT":
      if (e.type === "INITIALIZED") {
        const proposed = gradeDifficulty(e.indicators, DEFAULT_THRESHOLDS);
        const openQuestions = e.story.openQuestions.map((text, i) => ({ id: `q${i + 1}`, text }));
        return {
          state: { ...s, stage: "CLASSIFY", slug: e.slug, story: e.story, baseSha: e.baseSha, branch: e.branch, indicators: e.indicators, openQuestions },
          effects: [{ kind: "classify", indicators: e.indicators, proposed }],
        };
      }
      if (e.type === "INIT_FAILED") return escalateFrom(s, "INIT", `Story invalide : ${e.reasons.join(" ; ")}`, ["retry", "abort"]);
      break;

    case "CLASSIFY":
      if (e.type === "DIFFICULTY_PROPOSED" && s.indicators) {
        if (!isDifficulty(e.level)) return relancerClassifieur(s, `Niveau de difficulté inconnu : ${e.level}`);
        const proposed = { level: e.level, justification: e.justification };
        if (!s.confirmDifficulty) return applyDifficulty({ ...s, proposed }, e.level, "auto");
        return {
          state: { ...s, stage: "CONFIRM_DIFFICULTY", proposed },
          effects: [{ kind: "askDifficulty", proposed: e.level, justification: e.justification, options: uniq([e.level, shift(e.level, 1), shift(e.level, -1)]) }],
        };
      }
      if (e.type === "TIMEOUT" && s.indicators) return relancerClassifieur(s, `Délai dépassé : ${e.reason}`);
      break;

    case "CONFIRM_DIFFICULTY":
      if (e.type === "HUMAN_DECISION" && isDifficulty(e.decision)) return applyDifficulty(s, e.decision, "user");
      break;

    case "SPECIALIST": {
      const p = s.phase;
      if (!p) break;
      if (p === "DELIVER") {
        const r = deliverTransition(s, e);
        if (r) return r;
      }
      if (e.type === "PHASE_CHECKPOINTED" && e.phase === p) {
        const ns = { ...s, checkpoints: { ...s.checkpoints, [p]: e.checkpointId } };
        return { state: ns, effects: [specialist(ns, [])] };
      }
      if (e.type === "AGENT_REPORTED") {
        if (p === "DESIGN" && s.designStep === "model") {
          // Les deux sessions d'un réessai reçoivent le motif du dernier rejet.
          const ns: SkraftState = { ...s, designStep: "decide" };
          return { state: ns, effects: [specialist(ns, s.lastRejection?.reasons ?? [])] };
        }
        return { state: { ...s, stage: "ARTIFACT_GATE" }, effects: [{ kind: "runGate", phase: p, attempt: s.attempts + 1 }] };
      }
      if (e.type === "BLOCKER_REPORTED")
        return { state: { ...s, stage: "BLOCKED", blocker: { question: e.question, choices: e.choices } }, effects: [{ kind: "askBlocker", question: e.question, choices: e.choices }] };
      if (e.type === "TIMEOUT") return failure(s, "délai", [e.reason]);
      break;
    }

    case "BLOCKED":
      if (e.type === "HUMAN_DECISION" && s.blocker && s.phase) {
        const answer = e.comment ? `${e.decision} (${e.comment})` : e.decision;
        const ns: SkraftState = { ...s, stage: "SPECIALIST", blocker: null, answers: [...s.answers, { question: s.blocker.question, answer }] };
        if (ns.phase === "DELIVER" && ns.deliver) return resumeDeliver(ns, []);
        return { state: ns, effects: [specialist(ns, [])] };
      }
      break;

    case "ARTIFACT_GATE": {
      const p = s.phase;
      if (!p) break;
      if (e.type === "GATE_OK") {
        const known = new Set(s.adrs.map((a) => a.id));
        const ns: SkraftState = {
          ...s,
          artifacts: { ...s.artifacts, [p]: [...s.artifacts[p], ...e.artifacts] },
          // Seule la conception produit des ADR (§7.2).
          adrs: p === "DESIGN" ? [...s.adrs, ...(e.adrs ?? []).filter((a) => !known.has(a.id))] : s.adrs,
          openQuestions: [...s.openQuestions, ...(e.openQuestions ?? []).map((text, i) => ({ id: `q${s.openQuestions.length + i + 1}`, text }))],
          lastRejection: null,
          // Gel des tests d'acceptance à la sortie de DISTILL (écrit une seule fois).
          ...(p === "DISTILL" && e.acceptanceHash && !s.acceptanceHash ? { acceptanceHash: e.acceptanceHash, regressions: e.regressions ?? [] } : {}),
        };
        if (REVIEWED_PHASES.includes(p)) return { state: { ...ns, stage: "REVIEW" }, effects: [{ kind: "runReview", phase: p, lenses: lensesForPhase(ns.lenses, p), attempt: ns.attempts + 1 }] };
        return commit(ns);
      }
      if (e.type === "GATE_FAIL") return failure(s, e.gate, e.reasons);
      if (e.type === "TIMEOUT") return failure(s, "délai", [e.reason]);
      break;
    }

    case "REVIEW": {
      const p = s.phase;
      if (!p) break;
      if (e.type === "LENSES_DONE") {
        const verdict = synthesize(e.lenses);
        const ns: SkraftState = { ...s, reviews: { ...s.reviews, [p]: [...s.reviews[p], { attempt: s.attempts + 1, lenses: e.lenses, verdict, reportPath: e.reportPath }] } };
        if (verdict === "APPROVED") {
          const proposed = ns.adrs.filter((a) => a.status === "Proposed");
          if (p === "DESIGN" && proposed.length) return { state: { ...ns, stage: "RATIFICATION" }, effects: proposed.map((adr) => ({ kind: "askRatification", adr })) };
          return commit(ns);
        }
        if (verdict === "REJECTED") return escalate({ ...ns }, "Revue : verdict REJECTED");
        // DELIVER : correction ciblée depuis le dernier vert, avec les seuls défauts blocker et major (§9.3).
        const defects = actionableDefects(e.lenses);
        if (p === "DELIVER" && defects.length && ns.deliver?.stepCheckpoint && ns.attempts + 1 < ns.budget.maxAttemptsPerPhase) return startReviewFix(ns, defects);
        // Sans défaut blocker ni major, rien à corriger de façon ciblée : réessai de la phase avec les verdicts.
        return failure(ns, "revue", defects.length ? defects : [unactionableReview(e.lenses)]);
      }
      if (e.type === "TIMEOUT") return failure(s, "délai", [e.reason]);
      break;
    }

    case "RATIFICATION":
      if (e.type === "HUMAN_DECISION") {
        const [action, adrId] = e.decision.split(":");
        const adr = s.adrs.find((a) => a.id === adrId && a.status === "Proposed");
        if (!adr || !["accept", "reject", "amend"].includes(action ?? "")) break;
        if (action === "amend") {
          const ns: SkraftState = { ...s, stage: "SPECIALIST", designStep: "decide" };
          return { state: ns, effects: [specialist(ns, [`Amendement demandé sur ${adr.id} : ${e.comment ?? "(sans précision)"}`])] };
        }
        const status = action === "accept" ? "Accepted" : "Rejected";
        const adrs = s.adrs.map((a): AdrRecord => (a.id === adr.id ? { ...a, status, decisionBy: "user" } : a));
        const ns: SkraftState = { ...s, adrs };
        if (adrs.some((a) => a.status === "Proposed")) return { state: ns, effects: [] };
        // Statuts basculés dans les fichiers par le code, puis enregistrement de la phase (ou reprise de la route).
        const apply: SkraftEffect = {
          kind: "applyAdrStatuses",
          adrs: adrs.filter((a) => a.status !== "Proposed").map((a) => ({ path: a.path, status: a.status as "Accepted" | "Rejected" })),
        };
        const next = ns.phase && !ns.phasesCompleted.includes(ns.phase) ? commit(ns) : route(ns);
        return { state: next.state, effects: [apply, ...next.effects] };
      }
      break;

    case "ROUTE":
      // Attente des réponses aux questions ouvertes (§7.1, §11) : réponse libre ou report explicite.
      if (e.type === "HUMAN_DECISION") {
        const [action, id] = e.decision.split(":");
        const q = s.openQuestions.find((x) => x.id === id && x.answer === undefined);
        if (!q || (action !== "answer" && action !== "defer")) break;
        const answer = action === "defer" ? "(question reportée par l'utilisateur)" : (e.comment ?? "").trim() || "(réponse vide)";
        return route({ ...s, openQuestions: s.openQuestions.map((x) => (x.id === q.id ? { ...x, answer } : x)) });
      }
      break;

    case "COMMIT":
      if (e.type === "COMMITTED" && s.phase) {
        return route({ ...s, phasesCompleted: [...s.phasesCompleted, s.phase], attempts: 0, lastRejection: null, designStep: "model" });
      }
      break;

    case "ESCALATED":
      if (e.type === "HUMAN_DECISION" && s.escalation) return decide(s, e.decision);
      break;
  }
  return same;
}

// ---------- aides -------------------------------------------------------------------

/** Motif d'une revue « changements demandés » sans défaut blocker ni major (mineurs seuls, lentille rejetant, aucune lentille). */
function unactionableReview(lenses: LensVerdict[]): string {
  const verdicts = lenses.map((l) => `${l.lens} : ${l.verdict}${l.defects.length ? ` (${l.defects.map((d) => d.description).join(" ; ")})` : ""}`);
  return `Revue « changements demandés » sans défaut bloquant ni majeur à corriger. Verdicts : ${verdicts.join(" ; ") || "aucune lentille"}.`;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function specialist(s: SkraftState, feedback: string[]): SkraftEffect {
  const p = s.phase!;
  // DELIVER : sous-machine par scénario, à partir du plan d'implémentation (§7.4).
  if (p === "DELIVER") return { kind: "planDeliver" };
  return { kind: "runSpecialist", phase: p, role: specialistRole(p, s.designStep), attempt: s.attempts + 1, feedback };
}

function applyDifficulty(s: SkraftState, level: Difficulty, confirmedBy: "user" | "auto"): Out {
  if (s.difficulty || !s.indicators) return { state: s, effects: [] }; // invariant 5 : écrite une seule fois
  const fx = levelEffects(level);
  return route({
    ...s,
    difficulty: { level, indicators: s.indicators, confirmedBy },
    skipPhases: fx.skipResearch ? ["RESEARCH"] : [],
    lenses: fx.lenses,
    budget: { maxAttemptsPerPhase: fx.maxAttempts, maxCyclesPerScenario: s.budget.maxCyclesPerScenario },
  });
}

/** Invariant 2 : prochaine phase de `phaseOrder` hors phases faites et sautées ; invariant 7 : pas de DISTILL avec un ADR proposé. */
function route(s: SkraftState): Out {
  const pendingAdrs = s.adrs.filter((a) => a.status === "Proposed");
  if (pendingAdrs.length) return { state: { ...s, stage: "RATIFICATION" }, effects: pendingAdrs.map((adr) => ({ kind: "askRatification", adr })) };
  const next = s.phaseOrder.find((p) => !s.phasesCompleted.includes(p) && !s.skipPhases.includes(p));
  if (!next) return { state: { ...s, stage: "DONE", phase: null }, effects: [{ kind: "finalReport" }] };
  // Les questions ouvertes (story, recherche) sont tranchées avant toute phase autre que RESEARCH.
  const unanswered = next === "RESEARCH" ? [] : s.openQuestions.filter((q) => q.answer === undefined);
  if (unanswered.length) {
    const toAsk = unanswered.filter((q) => !s.questionsAsked.includes(q.id));
    return {
      state: { ...s, stage: "ROUTE", phase: null, questionsAsked: [...s.questionsAsked, ...toAsk.map((q) => q.id)] },
      effects: toAsk.map((q) => ({ kind: "askQuestion", id: q.id, text: q.text })),
    };
  }
  return { state: { ...s, stage: "SPECIALIST", phase: next, attempts: 0, designStep: "model", escalation: null }, effects: [{ kind: "checkpointPhase", phase: next }] };
}

function commit(s: SkraftState): Out {
  const p = s.phase!;
  return { state: { ...s, stage: "COMMIT" }, effects: [{ kind: "commitPhase", phase: p, message: commitMessage(p, s.slug) }] };
}

/**
 * Relance du classifieur après un défaut de travail (niveau inconnu, silence). CLASSIFY précède
 * toute phase, donc `failure()` ne s'applique pas : le budget est compté ici, faute de quoi un
 * agent qui répond toujours de travers rebouclerait sans fin, une requête par tour (D24).
 */
function relancerClassifieur(s: SkraftState, reason: string): Out {
  const attempts = s.attempts + 1;
  if (attempts >= s.budget.maxAttemptsPerPhase) return escalateFrom({ ...s, attempts }, "CLASSIFY", reason, ["retry", "abort"]);
  return {
    state: { ...s, attempts },
    effects: [{ kind: "classify", indicators: s.indicators!, proposed: gradeDifficulty(s.indicators!, DEFAULT_THRESHOLDS) }],
  };
}

/** Rejet de porte, de revue ou délai : réessai ciblé après rollback, ou escalade à budget épuisé (D24). */
function failure(s0: SkraftState, gate: string, reasons: string[]): Out {
  const s = s0.phase ? bumpRetries(s0, s0.phase) : s0;
  const attempts = s.attempts + 1;
  const cp = s.phase ? s.checkpoints[s.phase] : undefined;
  const rollback: SkraftEffect[] = cp ? [{ kind: "rollback", to: cp }] : [];
  const lastRejection = { gate, reasons };
  if (attempts >= s.budget.maxAttemptsPerPhase) {
    return {
      state: { ...s, stage: "ESCALATED", attempts, lastRejection, escalation: { from: "PHASE", reason: `${gate} : ${reasons.join(" ; ")}` } },
      effects: [...rollback, { kind: "askEscalation", reason: `${gate} : ${reasons.join(" ; ")}`, options: ["retry", "skip", "abort"] }],
    };
  }
  const ns: SkraftState = { ...s, stage: "SPECIALIST", attempts, lastRejection, designStep: "model" };
  return { state: ns, effects: [...rollback, specialist(ns, reasons)] };
}

/** Panne d'environnement : escalade immédiate, sans consommer le budget (D25). */
function escalate(s: SkraftState, reason: string): Out {
  if (s.stage === "INIT") return escalateFrom(s, "INIT", reason, ["retry", "abort"]);
  if (s.stage === "CLASSIFY" || s.stage === "CONFIRM_DIFFICULTY") return escalateFrom(s, "CLASSIFY", reason, ["retry", "abort"]);
  if (s.stage === "SPECIALIST" && s.phase === "DELIVER" && s.deliver) return escalateDeliver(s, reason);
  const cp = s.phase ? s.checkpoints[s.phase] : undefined;
  return {
    state: { ...s, stage: "ESCALATED", escalation: { from: "PHASE", reason } },
    effects: [...(cp ? [{ kind: "rollback", to: cp } as SkraftEffect] : []), { kind: "askEscalation", reason, options: ["retry", "skip", "abort"] }],
  };
}

function escalateFrom(s: SkraftState, from: "INIT" | "CLASSIFY", reason: string, options: ("retry" | "skip" | "abort")[]): Out {
  return { state: { ...s, stage: "ESCALATED", escalation: { from, reason } }, effects: [{ kind: "askEscalation", reason, options }] };
}

function decide(s: SkraftState, decision: string): Out {
  const from = s.escalation!.from;
  if (decision === "abort") return { state: { ...s, stage: "ABORTED" }, effects: [] };
  if (decision === "retry") {
    if (from === "INIT") return { state: { ...s, stage: "INIT", escalation: null }, effects: [{ kind: "init", storyPath: s.storyPath }] };
    if (from === "CLASSIFY" && s.indicators)
      // Budget rendu : sans cela, le tour suivant escaladerait aussitôt.
      return { state: { ...s, stage: "CLASSIFY", escalation: null, attempts: 0 }, effects: [{ kind: "classify", indicators: s.indicators, proposed: gradeDifficulty(s.indicators, DEFAULT_THRESHOLDS) }] };
    if (!s.phase) return { state: s, effects: [] };
    if (s.phase === "DELIVER" && s.deliver && !s.phasesCompleted.includes("DELIVER") && s.deliver.scenarios.some((x) => x.status !== "done")) return retryDeliver(s);
    const ns: SkraftState = { ...s, stage: "SPECIALIST", attempts: 0, escalation: null, designStep: "model" };
    if (!ns.checkpoints[ns.phase!]) return { state: ns, effects: [{ kind: "checkpointPhase", phase: ns.phase! }] };
    return { state: ns, effects: [specialist(ns, s.lastRejection?.reasons ?? [])] };
  }
  if (decision === "skip" && from === "PHASE" && s.phase) {
    const cp = s.checkpoints[s.phase];
    const r = route({ ...s, skipPhases: uniq([...s.skipPhases, s.phase]), escalation: null });
    return { state: r.state, effects: [...(cp ? [{ kind: "rollback", to: cp } as SkraftEffect] : []), ...r.effects] };
  }
  return { state: s, effects: [] };
}
