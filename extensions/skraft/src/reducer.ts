import type { TaskEvent } from "@agent-studio/task-engine";
import { commitMessage, phaseRoles, PHASE_ORDER, REVIEWED_PHASES, specialistRole } from "./config.js";
import { DEFAULT_THRESHOLDS, gradeDifficulty, isDifficulty, lensesForPhase, levelEffects, shift, type Difficulty, type LensName } from "./difficulty.js";
import type { AdrRecord, Phase, SkraftEffect, SkraftEvent, SkraftInput, SkraftState } from "./model.js";
import { synthesize, type LensVerdict } from "./review.js";
import { agentFeedback, applyArbitration, applyResponses, isActive, lensesAfterThreads, minorThreads, reviewRound, type DefectThread } from "./review-thread.js";
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
          state: { ...s, stage: "CLASSIFY", slug: e.slug, story: e.story, baseSha: e.baseSha, branch: e.branch, indicators: e.indicators, openQuestions, ...(e.qualityCheckpoint ? { qualityCheckpoint: e.qualityCheckpoint } : {}) },
          effects: [{ kind: "classify", indicators: e.indicators, proposed }],
        };
      }
      if (e.type === "INIT_FAILED") return escalateFrom(s, "INIT", `Préparation skraft refusée : ${e.reasons.join(" ; ")}`, ["retry", "abort"]);
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
        return lancer(ns, []);
      }
      if (e.type === "AGENT_REPORTED") {
        // Réponses aux défauts de revue transmis (ADR 0046) : corrigé, ou contesté avec raison.
        const s1: SkraftState = e.responses?.length && s.reviewThreads ? { ...s, reviewThreads: applyResponses(s.reviewThreads, e.responses, () => true) } : s;
        if (p === "DESIGN" && s1.designStep === "model") {
          // Les deux sessions d'un réessai reçoivent le motif du dernier rejet.
          const ns: SkraftState = { ...s1, designStep: "decide" };
          return lancer(ns, s1.lastRejection?.reasons ?? []);
        }
        return { state: { ...s1, stage: "ARTIFACT_GATE" }, effects: [{ kind: "runGate", phase: p, attempt: s1.attempts + 1 }] };
      }
      if (e.type === "BLOCKER_REPORTED")
        return { state: { ...s, stage: "BLOCKED", blocker: { question: e.question, choices: e.choices } }, effects: [{ kind: "askBlocker", question: e.question, choices: e.choices }] };
      if (e.type === "TIMEOUT") return failure(s, "délai", tourInterrompu(e.reason));
      break;
    }

    case "BLOCKED":
      if (e.type === "HUMAN_DECISION" && s.blocker && s.phase) {
        const answer = e.comment ? `${e.decision} (${e.comment})` : e.decision;
        if (s.blocker.lens) return afterReviewQuestion(s, s.blocker.lens, s.blocker.question, answer);
        const ns: SkraftState = { ...s, stage: "SPECIALIST", blocker: null, answers: [...s.answers, { question: s.blocker.question, answer }] };
        // L'agent repart avec le retour qu'il avait avant sa question (D9 de docs/12).
        if (ns.phase === "DELIVER" && ns.deliver) return resumeDeliver(ns, ns.deliver.feedback);
        return lancer(ns, s.retour ?? []);
      }
      break;

    case "ARTIFACT_GATE": {
      const p = s.phase;
      if (!p) break;
      if (e.type === "GATE_OK") {
        // Seule la conception produit des ADR (§7.2). Les propositions de la phase sont celles que la
        // porte vient de lire sur le disque : une proposition d'un essai précédent, renommée ou
        // retirée depuis, ne survit pas (D2 de docs/12). Les ADR décidés et ceux d'avant la phase restent.
        const avant = new Set((s.adrsAvantPhase ?? []).map((a) => a.id));
        const gardes = s.adrs.filter((a) => a.status !== "Proposed" || avant.has(a.id));
        const known = new Set(gardes.map((a) => a.id));
        const ns: SkraftState = {
          ...s,
          artifacts: { ...s.artifacts, [p]: [...s.artifacts[p], ...e.artifacts] },
          adrs: p === "DESIGN" ? [...gardes, ...(e.adrs ?? []).filter((a) => !known.has(a.id))] : s.adrs,
          openQuestions: [...s.openQuestions, ...(e.openQuestions ?? []).map((text, i) => ({ id: `q${s.openQuestions.length + i + 1}`, text }))],
          lastRejection: null,
          // Mutation de fin de DELIVER (ADR 0049) : ses faits et notes vont aux lentilles.
          ...(p === "DELIVER" && s.deliver && (e.facts?.length || e.notes?.length)
            ? { deliver: { ...s.deliver, facts: [...new Set([...(s.deliver.facts ?? []), ...(e.facts ?? [])])], notes: [...new Set([...s.deliver.notes, ...(e.notes ?? [])])] } }
            : {}),
          // Empreinte de l'essai validé ; un refus de DISTILL l'invalide avant correction.
          ...(p === "DISTILL" && e.acceptanceHash ? { acceptanceHash: e.acceptanceHash, regressions: e.regressions ?? [] } : {}),
        };
        if (REVIEWED_PHASES.includes(p)) return { state: { ...ns, stage: "REVIEW" }, effects: [{ kind: "runReview", phase: p, lenses: lensesForPhase(ns.lenses, p), attempt: ns.attempts + 1 }] };
        return commit(ns);
      }
      // Porte de fin de DELIVER avec une cible (ADR 0049, D5 de docs/12) : les scénarios sont verts,
      // rejouer la phase ne ferait travailler personne. Chaque motif devient un défaut adressé à
      // l'agent concerné, par la correction de l'ADR 0046.
      if (e.type === "GATE_FAIL" && p === "DELIVER" && Object.hasOwn(CORRECTIONS_DE_FIN, e.gate) && s.deliver?.stepCheckpoint && s.attempts + 1 < s.budget.maxAttemptsPerPhase)
        return startReviewFix(s, [...(s.reviewThreads ?? []), ...endGateThreads(e.gate, e.reasons, s.attempts + 1)]);
      // Rien produit : personne à qui adresser le motif, l'humain décide sans qu'un essai soit consommé (D5).
      if (e.type === "GATE_FAIL" && p === "DELIVER" && e.gate === "livrables") return escalate(s, `${e.gate} : ${e.reasons.join(" ; ")}`);
      if (e.type === "GATE_FAIL") return failure(s, e.gate, e.reasons);
      if (e.type === "TIMEOUT") return failure(s, "délai", tourInterrompu(e.reason));
      break;
    }

    case "REVIEW": {
      const p = s.phase;
      if (!p) break;
      if (e.type === "LENSES_DONE") {
        // Fils de défauts (ADR 0046) : arbitrages des contestations, nouveaux défauts, et verdicts
        // où un défaut maintenu figure même si la lentille a omis de le relister.
        const round = s.reviews[p].length + 1;
        const r = reviewRound(s.reviewThreads ?? [], e.lenses, round);
        const ns: SkraftState = {
          ...s,
          ...(e.contractSymbols && s.deliver ? { deliver: { ...s.deliver, contractSymbols: e.contractSymbols } } : {}),
          reviewThreads: r.threads,
          reviews: { ...s.reviews, [p]: [...s.reviews[p], { attempt: s.attempts + 1, lenses: e.lenses, verdict: synthesize(r.lenses), reportPath: e.reportPath }] },
        };
        // Contesté deux fois, maintenu deux fois : ni l'agent ni la lentille ne trancheront seuls.
        if (r.persistent.length) return { state: { ...ns, stage: "ARBITRATION" }, effects: r.persistent.map((thread) => ({ kind: "askArbitration", thread })) };
        return resolveReview(ns, r.lenses, false);
      }
      if (e.type === "LENS_BLOCKED") {
        // D4 de docs/12 : une question n'est pas un échec du producteur ; elle part à l'humain.
        const n = (s.reviewQuestions ?? 0) + 1;
        if (n > MAX_QUESTIONS_DE_REVUE) return escalate(s, `Plus de ${MAX_QUESTIONS_DE_REVUE} questions de revue dans la phase ${p} : « ${e.question} » (${e.lens})`);
        return {
          state: { ...s, stage: "BLOCKED", reviewQuestions: n, blocker: { question: e.question, choices: e.choices, lens: e.lens } },
          effects: [{ kind: "askBlocker", question: e.question, choices: e.choices, lens: e.lens }],
        };
      }
      if (e.type === "TIMEOUT") return failure(s, "délai", tourInterrompu(e.reason));
      break;
    }

    case "RATIFICATION":
      if (e.type === "HUMAN_DECISION") {
        const [action, adrId] = e.decision.split(":");
        const adr = s.adrs.find((a) => a.id === adrId && a.status === "Proposed");
        if (!adr || !["accept", "reject", "amend"].includes(action ?? "")) break;
        if (action === "amend") {
          const ns: SkraftState = { ...s, stage: "SPECIALIST", designStep: "decide" };
          return lancer(ns, [`Amendement demandé sur ${adr.id} : ${e.comment ?? "(sans précision)"}`]);
        }
        const status = action === "accept" ? "Accepted" : "Rejected";
        const adrs = s.adrs.map((a): AdrRecord => (a.id === adr.id ? { ...a, status, decisionBy: "user" } : a));
        const ns: SkraftState = { ...s, adrs };
        // Statut écrit dans le fichier par le code dès la décision (D3 de docs/12) : pendant
        // l'amendement d'un autre ADR, celui-ci est déjà décidé, donc protégé.
        const apply: SkraftEffect = { kind: "applyAdrStatuses", adrs: [{ path: adr.path, status }] };
        if (adrs.some((a) => a.status === "Proposed")) return { state: ns, effects: [apply] };
        // Tous décidés : enregistrement de la phase (ou reprise de la route).
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
        return route({ ...s, phasesCompleted: [...s.phasesCompleted, s.phase], attempts: 0, lastRejection: null, designStep: "model", reviewThreads: [] });
      }
      break;

    case "ESCALATED":
      if (e.type === "HUMAN_DECISION" && s.escalation) return decide(s, e.decision);
      break;

    case "ARBITRATION": {
      const p = s.phase;
      if (e.type !== "HUMAN_DECISION" || !p) break;
      const threads = applyArbitration(s.reviewThreads ?? [], e.decision);
      const ns: SkraftState = { ...s, reviewThreads: threads };
      if (threads.some((t) => t.status === "recontested")) return { state: ns, effects: [] };
      // Tous les désaccords tranchés : la revue reprend son cours avec les décisions humaines. Un
      // défaut maintenu par l'humain a droit à sa correction, budget épuisé ou non.
      const last = ns.reviews[p].at(-1)?.lenses ?? [];
      return resolveReview(ns, lensesAfterThreads(last, threads), threads.some((t) => t.status === "humanMaintained"));
    }
  }
  return same;
}

// ---------- aides -------------------------------------------------------------------

/** Au-delà, une question de revue escalade : le budget ne borne plus ces rejeux (D4 de docs/12). */
const MAX_QUESTIONS_DE_REVUE = 2;

/**
 * Réponse à la question d'une lentille (D4 de docs/12) : une information nouvelle, pas un échec.
 * La phase est rejouée avec la question et la réponse, sans consommer d'essai ; en DELIVER, où tout
 * est déjà vert, seule la revue est relancée. La réponse rejoint celles de la story.
 */
function afterReviewQuestion(s: SkraftState, lens: LensName, question: string, answer: string): Out {
  const p = s.phase!;
  const motif = `Question de la revue (${lens}) : ${question} — Réponse de l'utilisateur : ${answer}`;
  const ns: SkraftState = {
    ...s,
    blocker: null,
    answers: [...s.answers, { question, answer }],
    rejections: (s.rejections ?? 0) + 1,
    lastRejection: { gate: "question de revue", reasons: [motif] },
  };
  if (p === "DELIVER") return { state: { ...ns, stage: "REVIEW" }, effects: [{ kind: "runReview", phase: p, lenses: lensesForPhase(ns.lenses, p), attempt: ns.attempts + 1 }] };
  const replay: SkraftState = { ...ns, stage: "SPECIALIST", designStep: "model" };
  return lancer(replay, [motif]);
}

/**
 * Portes de fin de DELIVER qui désignent leur correcteur : un test trop faible (mutation, lignes
 * modifiées non couvertes) va au testeur, un test existant cassé au développeur.
 */
const CORRECTIONS_DE_FIN: Record<string, { id: string; target: "test" | "code"; consigne: string }> = {
  mutation: {
    id: "mutation",
    target: "test",
    consigne:
      "Ajoute le test qui tue ce mutant : il doit passer sur le code actuel et échouer sur le mutant. " +
      "Si la ligne mutée ne sert à aucun comportement observable (code superflu), déclare ce défaut `outOfScope` : il ira au développeur.",
  },
  "couverture du diff": {
    id: "couverture",
    target: "test",
    consigne:
      "Ajoute le test qui exerce ces lignes par un comportement observable. " +
      "Si une ligne ne sert à aucun comportement (code superflu), déclare ce défaut `outOfScope` : il ira au développeur.",
  },
  "suite finale": {
    id: "suite finale",
    target: "code",
    consigne: "Corrige le code pour que ce test repasse ; ne modifie pas ce test.",
  },
};

/** Motifs d'une porte de fin de DELIVER → défauts adressés à son correcteur. */
function endGateThreads(gate: string, reasons: string[], round: number): DefectThread[] {
  const c = CORRECTIONS_DE_FIN[gate]!;
  return reasons.map((description, i) => ({
    id: `${c.id}#${round}.${i + 1}`,
    lens: c.id,
    severity: "major" as const,
    description: `${description} ${c.consigne}`,
    target: c.target,
    status: "open" as const,
    round,
  }));
}

/**
 * Suite d'une revue, une fois les fils à jour : approbation, rejet, correction ciblée (DELIVER) ou
 * réessai de la phase. `decidedByHuman` : un arbitrage humain a maintenu un défaut — il a droit à
 * sa correction même si le budget de la phase est épuisé.
 */
function resolveReview(ns: SkraftState, lenses: LensVerdict[], decidedByHuman: boolean): Out {
  const p = ns.phase!;
  const verdict = synthesize(lenses);
  if (verdict === "APPROVED") {
    const proposed = ns.adrs.filter((a) => a.status === "Proposed");
    if (p === "DESIGN" && proposed.length) return { state: { ...ns, stage: "RATIFICATION" }, effects: proposed.map((adr) => ({ kind: "askRatification", adr })) };
    return commit(ns);
  }
  if (verdict === "REJECTED") {
    // Tracé comme tout rejet (D11 de docs/12) : sinon la cause n'existe que dans le texte de l'escalade.
    const motifs = lenses.filter((l) => l.verdict === "REJECTED").map((l) => `${l.lens} : REJECTED${l.defects.length ? ` — ${l.defects.map((d) => d.description).join(" ; ")}` : ""}`);
    return escalate({ ...ns, rejections: (ns.rejections ?? 0) + 1, lastRejection: { gate: "revue", reasons: motifs } }, `Revue : verdict REJECTED (${motifs.join(" ; ")})`);
  }
  const threads = ns.reviewThreads ?? [];
  const active = threads.filter(isActive);
  // DELIVER : correction ciblée depuis le dernier vert, routée vers l'agent concerné (§9.3, ADR 0046).
  if (p === "DELIVER" && active.length && ns.deliver?.stepCheckpoint && (ns.attempts + 1 < ns.budget.maxAttemptsPerPhase || decidedByHuman)) return startReviewFix(ns, threads);
  // DELIVER sans défaut bloquant ni majeur (D5 de docs/12) : tout est vert, rejouer la phase ne ferait
  // travailler personne. Les mineurs sont corrigés comme des majeurs ; sans aucun défaut, personne à
  // qui adresser la revue : l'humain décide, sans qu'un essai soit consommé.
  if (p === "DELIVER" && !active.length && ns.deliver?.stepCheckpoint) {
    const mineurs = minorThreads(lenses, ns.reviews[p].length);
    if (!mineurs.length) return escalate(ns, `Revue sans défaut à corriger : ${unactionableReview(lenses)}`);
    if (ns.attempts + 1 < ns.budget.maxAttemptsPerPhase || ns.reviews[p].length === 1 || decidedByHuman) return startReviewFix(ns, [...threads, ...mineurs]);
  }
  // Sans défaut blocker ni major, rien à corriger de façon ciblée : réessai de la phase avec les verdicts.
  // La PREMIÈRE revue d'une phase a droit à un essai même si les portes de forme ont tout
  // consommé (ADR 0042) : sans cela ses défauts, précis et corrigeables, tombent en escalade
  // sans que personne n'ait eu l'occasion d'y répondre.
  return failure(ns, "revue", active.length ? agentFeedback(threads, () => true) : [unactionableReview(lenses)], ns.reviews[p].length === 1 || decidedByHuman);
}

/** Motif d'une revue « changements demandés » sans défaut blocker ni major (mineurs seuls, lentille rejetant, aucune lentille). */
function unactionableReview(lenses: LensVerdict[]): string {
  const verdicts = lenses.map((l) => `${l.lens} : ${l.verdict}${l.defects.length ? ` (${l.defects.map((d) => d.description).join(" ; ")})` : ""}`);
  return `Revue « changements demandés » sans défaut bloquant ni majeur à corriger. Verdicts : ${verdicts.join(" ; ") || "aucune lentille"}.`;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/**
 * Motif rendu au tour suivant après une interruption. La seconde phrase compte autant que la
 * première : sans elle, l'agent relit des fichiers à moitié écrits en les croyant finis.
 */
const tourInterrompu = (raison: string): string[] => [
  `Le tour précédent a été interrompu (${raison}) : aucune porte n'a jugé ton travail.`,
  "Ce que tu avais écrit est resté sur le disque, possiblement incomplet. Reprends-le et termine-le ; ne recommence pas de zéro, et ne considère aucun fichier comme fini sans l'avoir relu.",
];

/**
 * Lance le spécialiste de la phase. Son retour (motif de rejet, amendement, question de revue) est
 * gardé dans l'état : une question bloquante ne le lui fait pas perdre (D9 de docs/12).
 */
function lancer(ns: SkraftState, feedback: string[], avant: SkraftEffect[] = []): Out {
  return { state: { ...ns, retour: feedback }, effects: [...avant, specialist(ns, feedback)] };
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
  return { state: { ...s, stage: "SPECIALIST", phase: next, attempts: 0, designStep: "model", escalation: null, reviewQuestions: 0, adrsAvantPhase: s.adrs }, effects: [{ kind: "checkpointPhase", phase: next }] };
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

/**
 * Échec d'une phase : relance ciblée tant que le budget le permet, escalade ensuite.
 *
 * **Un réessai n'annule rien** (ADR 0029, amendée par 0040). L'agent garde sa session (ADR 0039) :
 * il croit avoir écrit ses fichiers, et il les a écrits. Les effacer sous lui lui ferait corriger
 * de mémoire un dépôt qui ne contient plus rien — on lui demande de *corriger*, pas de retaper.
 * ADR 0029 avait déjà retiré le rollback du tour interrompu ; la raison vaut pour le rejet de
 * porte, où elle est même plus forte : la porte a lu des fichiers précis et dit ce qui cloche.
 *
 * La sécurité ne repose pas sur ce rollback : la porte de fin de phase juge l'**état final**, quel
 * qu'ait été le chemin. Un essai qui laisse un fichier bancal sera recalé par elle.
 *
 * L'escalade, elle, annule toujours — quand la main repasse à l'humain, le dépôt doit être propre.
 *
 * `essaiGaranti` force un essai de plus malgré un budget épuisé. Un seul appelant s'en sert : la
 * première revue d'une phase (ADR 0042). Le budget est commun aux portes de forme et à la revue,
 * alors que les rejets n'y sont pas du même ordre — recopier une valeur dans un Gherkin et
 * rebrancher un calcul de facture ne demandent pas le même travail. Le 29/09, DISTILL a dépensé
 * ses trois essais sur la porte des valeurs, puis la revue a rendu deux défauts majeurs et justes
 * qui sont partis en escalade sans qu'aucun tour ne puisse y répondre.
 */
/**
 * Rembobiner le dépôt et faire oublier les conversations qui le décrivent (ADR 0050).
 *
 * Les deux sont indissociables : un agent relancé sur un dépôt rembobiné, avec dans sa mémoire les
 * appels d'outils qui ont créé les fichiers effacés, corrige de mémoire un dépôt vide. C'est
 * l'incohérence que l'ADR 0040 a levée pour le réessai, restée sur le chemin d'escalade.
 */
function rembobiner(s: SkraftState): SkraftEffect[] {
  const cp = s.phase ? s.checkpoints[s.phase] : undefined;
  if (!cp) return [];
  return [{ kind: "rollback", to: cp }, ...(s.phase ? [{ kind: "forgetSessions", roles: phaseRoles(s.phase) } as SkraftEffect] : [])];
}

/**
 * Le rembobinage efface les fichiers de la phase. La mémoire suit : la liste des ADR revient à
 * celle du début de la phase (D2 de docs/12) — sans cela, la ratification portait sur un ADR effacé,
 * et une phase sautée passait quand même en RATIFICATION —, et ses livrables sont oubliés (D6).
 */
function oublierLaPhase(s: SkraftState): SkraftState {
  // Livrables du run effacé : leurs essais ne seront pas renumérotés, ils fausseraient les faits
  // donnés aux lentilles (D6 de docs/12).
  // Ajout seul (invariant 4, §5.3) : on n'efface pas, on marque où commence le run suivant.
  // Rapports de revue du run effacé : pas réécrits au commit de la phase (D8 de docs/12).
  const sansLivrables = s.phase
    ? { ...s, debutDuRun: { ...s.debutDuRun, [s.phase]: s.artifacts[s.phase].length }, debutDesRevues: { ...s.debutDesRevues, [s.phase]: s.reviews[s.phase].length } }
    : s;
  return s.adrsAvantPhase ? { ...sansLivrables, adrs: s.adrsAvantPhase } : sansLivrables;
}

function leverGelDistill(s: SkraftState): SkraftState {
  return s.phase === "DISTILL" && !s.phasesCompleted.includes("DISTILL")
    ? { ...s, acceptanceHash: null, regressions: [] }
    : s;
}

function failure(etat: SkraftState, gate: string, reasons: string[], essaiGaranti = false): Out {
  const s0 = leverGelDistill(etat);
  const s = s0.phase ? bumpRetries(s0, s0.phase) : s0;
  const attempts = s.attempts + 1;
  const epuise = attempts >= s.budget.maxAttemptsPerPhase && !essaiGaranti;
  const rollback: SkraftEffect[] = epuise ? rembobiner(s) : [];
  const lastRejection = { gate, reasons };
  if (epuise) {
    return {
      state: { ...oublierLaPhase(s), stage: "ESCALATED", attempts, lastRejection, escalation: { from: "PHASE", reason: `${gate} : ${reasons.join(" ; ")}` } },
      effects: [...rollback, { kind: "askEscalation", reason: `${gate} : ${reasons.join(" ; ")}`, options: ["retry", "skip", "abort"] }],
    };
  }
  const ns: SkraftState = { ...s, stage: "SPECIALIST", attempts, lastRejection, designStep: "model" };
  return lancer(ns, reasons, rollback);
}

/** Panne d'environnement : escalade immédiate, sans consommer le budget (D25). */
function escalate(etat: SkraftState, reason: string): Out {
  const s = leverGelDistill(etat);
  if (s.stage === "INIT") return escalateFrom(s, "INIT", reason, ["retry", "abort"]);
  if (s.stage === "CLASSIFY" || s.stage === "CONFIRM_DIFFICULTY") return escalateFrom(s, "CLASSIFY", reason, ["retry", "abort"]);
  if (s.stage === "SPECIALIST" && s.phase === "DELIVER" && s.deliver) return escalateDeliver(s, reason);
  return {
    state: { ...oublierLaPhase(s), stage: "ESCALATED", escalation: { from: "PHASE", reason } },
    effects: [...rembobiner(s), { kind: "askEscalation", reason, options: ["retry", "skip", "abort"] }],
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
    return lancer(ns, s.lastRejection?.reasons ?? []);
  }
  if (decision === "skip" && from === "PHASE" && s.phase) {
    const efface = rembobiner(s);
    const r = route({ ...oublierLaPhase(s), skipPhases: uniq([...s.skipPhases, s.phase]), escalation: null });
    return { state: r.state, effects: [...efface, ...r.effects] };
  }
  return { state: s, effects: [] };
}
