import { describe, expect, it } from "vitest";
import { PHASE_ORDER } from "../src/config.js";
import type { SkraftEffect, SkraftState } from "../src/model.js";
import { validateState } from "../src/model.js";
import { initialEffects, initialState, transition, type Ev } from "../src/reducer.js";
import type { LensVerdict } from "../src/review.js";
import { RESPONSE_INSTRUCTION } from "../src/review-thread.js";
import { parseStory } from "../src/story.js";
import { US12 } from "./story.test.js";

const story = (() => {
  const r = parseStory(US12);
  if (!r.ok) throw new Error();
  return r.story;
})();

const INITIALIZED: Ev = {
  type: "INITIALIZED",
  slug: "us-12",
  story,
  baseSha: "base",
  branch: "skraft/us-12",
  indicators: { acceptanceCriteria: 3, modulesTouched: 2, newExternalIntegration: false, openBusinessQuestions: 1 },
};
const PROPOSED = (level = "medium-hard"): Ev => ({ type: "DIFFICULTY_PROPOSED", level, justification: "question ouverte" });
const DECIDE = (decision: string, comment?: string): Ev => ({ type: "HUMAN_DECISION", decision, ...(comment ? { comment } : {}) });
const CP = (phase: SkraftState["phase"]): Ev => ({ type: "PHASE_CHECKPOINTED", phase: phase!, checkpointId: `cp-${phase}` });
const REPORTED: Ev = { type: "AGENT_REPORTED", role: "skraft-researcher", summary: "fait", files: [] };
const GATE_OK: Ev = { type: "GATE_OK", artifacts: [{ path: "a.md", sha256: "h", producedBy: "x", attempt: 1 }] };
const GATE_FAIL: Ev = { type: "GATE_FAIL", gate: "citations", reasons: ["fichier de 55 lignes"] };
const COMMITTED: Ev = { type: "COMMITTED", sha: "sha" };
const TIMEOUT = (reason: string): Ev => ({ type: "TIMEOUT", reason });
const lens = (verdict: LensVerdict["verdict"], severities: ("blocker" | "major" | "minor")[] = []): LensVerdict => ({
  lens: "cold-reader",
  verdict,
  defects: severities.map((severity) => ({ severity, description: `défaut ${severity}`, file: "Sources/A.swift", line: 3 })),
});
/**
 * Ces tests portent sur les transitions du réducteur, pas sur la couverture des questions de
 * revue. Les lentilles non citées sont donc ajoutées sans défaut : sans elles, une question
 * resterait sans réponse et la synthèse refuserait d'approuver quoi qu'il arrive — ce qui est
 * vérifié à part, dans `review-synthesis.test.ts`.
 */
const LENSES = (...l: LensVerdict[]): Ev => {
  const citees = new Set(l.map((x) => x.lens));
  const completees = (["cold-reader", "test-integrity", "architecture", "quality-gates"] as const)
    .filter((n) => !citees.has(n))
    .map((n): LensVerdict => ({ lens: n, verdict: "APPROVED", defects: [] }));
  return { type: "LENSES_DONE", lenses: [...l, ...completees], reportPath: ".skraft/us-12/reviews/x.md" };
};

function play(events: Ev[], input = { storyPath: "stories/us-12.md" }) {
  let state = initialState(input);
  let effects: SkraftEffect[] = initialEffects(state);
  for (const e of events) ({ state, effects } = transition(state, e));
  return { state, effects };
}
const kinds = (e: SkraftEffect[]) => e.map((x) => x.kind);

/** Jusqu'au début de la première phase exécutée, difficulté confirmée par l'utilisateur. */
const toFirstPhase = (level = "medium-hard") => [INITIALIZED, PROPOSED(level), DECIDE(level)];
/** Déroule une phase sans reviewer (RESEARCH) jusqu'au commit. */
const researchPhase = [CP("RESEARCH"), REPORTED, GATE_OK, COMMITTED];
/** Réponse à la question ouverte de US-12 (posée avant DESIGN). */
const ANSWER = DECIDE("answer:q1", "par prise");
/** Déroule DESIGN (deux sessions) jusqu'au commit, sans ADR. */
const designPhase = [ANSWER, CP("DESIGN"), REPORTED, REPORTED, GATE_OK, LENSES(lens("APPROVED")), COMMITTED];
const reviewedPhase = (p: "DISTILL" | "DELIVER") => [CP(p), REPORTED, GATE_OK, LENSES(lens("APPROVED")), COMMITTED];

describe("Réducteur skraft — INIT, CLASSIFY, CONFIRM_DIFFICULTY (§5.2)", () => {
  it("état initial : INIT, ordre des phases lu de la configuration unique, effet d'initialisation", () => {
    const s = initialState({ storyPath: "stories/us-12.md" });
    expect(s.stage).toBe("INIT");
    expect(s.phaseOrder).toEqual(PHASE_ORDER);
    expect(s.phase).toBeNull();
    expect(initialEffects(s)).toEqual([{ kind: "init", storyPath: "stories/us-12.md" }]);
    expect(validateState(s)).toEqual({ ok: true });
  });

  it("INIT + story valide → CLASSIFY : branche, SHA de départ, indicateurs, niveau proposé par la grille", () => {
    const { state, effects } = play([INITIALIZED]);
    expect(state).toMatchObject({ stage: "CLASSIFY", slug: "us-12", baseSha: "base", branch: "skraft/us-12" });
    expect(effects).toEqual([{ kind: "classify", indicators: INITIALIZED.type === "INITIALIZED" ? INITIALIZED.indicators : null, proposed: "medium-hard" }]);
  });

  it("INIT + story invalide → escalade avec les raisons", () => {
    const { state, effects } = play([{ type: "INIT_FAILED", reasons: ["aucun critère"] }]);
    expect(state.stage).toBe("ESCALATED");
    expect(effects).toEqual([{ kind: "askEscalation", reason: "Préparation skraft refusée : aucun critère", options: ["retry", "abort"] }]);
    const retry = play([{ type: "INIT_FAILED", reasons: ["x"] }, DECIDE("retry")]);
    expect(retry.effects).toEqual([{ kind: "init", storyPath: "stories/us-12.md" }]);
  });

  it("CLASSIFY + niveau proposé → confirmation par l'utilisateur, avec un cran au-dessus et au-dessous", () => {
    const { state, effects } = play([INITIALIZED, PROPOSED("medium-hard")]);
    expect(state.stage).toBe("CONFIRM_DIFFICULTY");
    expect(effects).toEqual([{ kind: "askDifficulty", proposed: "medium-hard", justification: "question ouverte", options: ["medium-hard", "challenging", "medium"] }]);
  });

  it("CLASSIFY + niveau hors de l'enum : relance du classifieur (défaut de travail)", () => {
    const { state, effects } = play([INITIALIZED, PROPOSED("énorme")]);
    expect(state.stage).toBe("CLASSIFY");
    expect(kinds(effects)).toEqual(["classify"]);
  });

  it("CLASSIFY : les relances du classifieur consomment le budget puis escaladent", () => {
    // Sans budget, un classifieur qui répond toujours de travers reboucle sans fin, en
    // consommant une requête à chaque tour.
    const { state, effects } = play([INITIALIZED, PROPOSED("énorme"), PROPOSED("énorme"), PROPOSED("énorme")]);
    expect(state.stage).toBe("ESCALATED");
    expect(state.escalation).toMatchObject({ from: "CLASSIFY" });
    expect(kinds(effects)).toEqual(["askEscalation"]);
  });

  it("CLASSIFY + délai dépassé : relance, puis escalade à budget épuisé", () => {
    const timeout: Ev = { type: "TIMEOUT", reason: "silence de l'agent" };
    const deux = play([INITIALIZED, timeout, timeout]);
    expect(deux.state.stage).toBe("CLASSIFY");
    expect(kinds(deux.effects)).toEqual(["classify"]);

    const trois = play([INITIALIZED, timeout, timeout, timeout]);
    expect(trois.state.stage).toBe("ESCALATED");
    expect(trois.state.escalation).toMatchObject({ from: "CLASSIFY" });
    expect(kinds(trois.effects)).toEqual(["askEscalation"]);
  });

  it("après escalade de CLASSIFY, « réessayer » rend son budget au classifieur", () => {
    const timeout: Ev = { type: "TIMEOUT", reason: "silence" };
    const apres = play([INITIALIZED, timeout, timeout, timeout, { type: "HUMAN_DECISION", decision: "retry" }]);
    expect(apres.state.stage).toBe("CLASSIFY");
    expect(apres.state.attempts).toBe(0);
    // Sans remise à zéro, le tour suivant escaladerait aussitôt.
    const encore = play([INITIALIZED, timeout, timeout, timeout, { type: "HUMAN_DECISION", decision: "retry" }, timeout]);
    expect(encore.state.stage).toBe("CLASSIFY");
  });

  it("confirmation automatique (O3, mode avancé) : route directement", () => {
    const { state } = play([INITIALIZED, PROPOSED("medium-hard")], { storyPath: "s.md", confirmDifficulty: false } as never);
    expect(state.difficulty).toMatchObject({ level: "medium-hard", confirmedBy: "auto" });
    expect(state.stage).toBe("SPECIALIST");
  });

  it("CONFIRM_DIFFICULTY + décision → ROUTE → SPECIALIST : difficulté écrite, RESEARCH exécutée pour medium-hard", () => {
    const { state, effects } = play(toFirstPhase("medium-hard"));
    expect(state.difficulty).toEqual({ level: "medium-hard", indicators: expect.any(Object), confirmedBy: "user" });
    expect(state.skipPhases).toEqual([]);
    expect(state.budget.maxAttemptsPerPhase).toBe(3);
    expect(state).toMatchObject({ stage: "SPECIALIST", phase: "RESEARCH" });
    expect(effects).toEqual([{ kind: "checkpointPhase", phase: "RESEARCH" }]);
  });

  it("saut de RESEARCH par règle : simple et medium commencent par DESIGN (après la question ouverte)", () => {
    for (const level of ["simple", "medium"]) {
      const { state } = play([...toFirstPhase(level), ANSWER]);
      expect(state.skipPhases).toEqual(["RESEARCH"]);
      expect(state.phase).toBe("DESIGN");
    }
    expect(play(toFirstPhase("simple")).state.budget.maxAttemptsPerPhase).toBe(2);
  });

  it("décision de difficulté invalide : ignorée", () => {
    const before = play([INITIALIZED, PROPOSED()]);
    expect(transition(before.state, DECIDE("géant"))).toEqual({ state: before.state, effects: [] });
  });
});

describe("Réducteur skraft — phases (§5.2)", () => {
  it("SPECIALIST : checkpoint de phase puis spécialiste lancé avec le rôle de la phase", () => {
    const { state, effects } = play([...toFirstPhase(), CP("RESEARCH")]);
    expect(state.checkpoints.RESEARCH).toBe("cp-RESEARCH");
    expect(effects).toEqual([{ kind: "runSpecialist", phase: "RESEARCH", role: "skraft-researcher", attempt: 1, feedback: [] }]);
  });

  it("SPECIALIST + AGENT_REPORTED → ARTIFACT_GATE", () => {
    const { state, effects } = play([...toFirstPhase(), CP("RESEARCH"), REPORTED]);
    expect(state.stage).toBe("ARTIFACT_GATE");
    expect(effects).toEqual([{ kind: "runGate", phase: "RESEARCH", attempt: 1 }]);
  });

  it("DESIGN : deux sessions successives, modélisation puis décisions, avant la porte", () => {
    const after = play([...toFirstPhase(), ...researchPhase, ANSWER, CP("DESIGN"), REPORTED]);
    expect(after.state.stage).toBe("SPECIALIST");
    expect(after.effects).toEqual([{ kind: "runSpecialist", phase: "DESIGN", role: "skraft-architect-decide", attempt: 1, feedback: [] }]);
    expect(kinds(play([...toFirstPhase(), ...researchPhase, ANSWER, CP("DESIGN"), REPORTED, REPORTED]).effects)).toEqual(["runGate"]);
  });

  it("réessai de DESIGN : la session de décisions reçoit aussi le motif du rejet", () => {
    const { effects } = play([...toFirstPhase(), ...researchPhase, ANSWER, CP("DESIGN"), REPORTED, REPORTED, GATE_FAIL, REPORTED]);
    expect(effects).toEqual([{ kind: "runSpecialist", phase: "DESIGN", role: "skraft-architect-decide", attempt: 2, feedback: ["fichier de 55 lignes"] }]);
  });

  it("GATE_OK sans reviewer (RESEARCH) → COMMIT ; artefacts ajoutés", () => {
    const { state, effects } = play([...toFirstPhase(), CP("RESEARCH"), REPORTED, GATE_OK]);
    expect(state.stage).toBe("COMMIT");
    expect(state.artifacts.RESEARCH).toHaveLength(1);
    expect(effects).toEqual([{ kind: "commitPhase", phase: "RESEARCH", message: "docs(skraft): research de us-12" }]);
  });

  it("GATE_OK avec reviewer → REVIEW avec les lentilles du niveau, réduites à ce que la phase peut occuper", () => {
    // `quality-gates` est écartée de DESIGN (ADR 0028) : aucun fait n'y est mesuré, et sommée de
    // juger sans matière elle invente un grief hors de son mandat. Les trois autres couvrent à
    // elles seules les quatre questions — `lentilles-par-phase.test.ts` le vérifie.
    const { state, effects } = play([...toFirstPhase(), ...researchPhase, ANSWER, CP("DESIGN"), REPORTED, REPORTED, GATE_OK]);
    expect(state.stage).toBe("REVIEW");
    expect(effects).toEqual([{ kind: "runReview", phase: "DESIGN", lenses: ["cold-reader", "test-integrity", "architecture"], attempt: 1 }]);
    // Le niveau garde bien ses quatre lentilles : c'est la phase qui en écarte une, pas le niveau.
    expect(state.lenses).toEqual(["cold-reader", "test-integrity", "architecture", "quality-gates"]);
  });

  it("GATE_FAIL avec budget → relance ciblée avec les motifs, sans rien annuler (ADR 0040)", () => {
    const { state, effects } = play([...toFirstPhase(), CP("RESEARCH"), REPORTED, GATE_FAIL]);
    expect(state).toMatchObject({ stage: "SPECIALIST", attempts: 1, lastRejection: { gate: "citations", reasons: ["fichier de 55 lignes"] } });
    expect(effects).toEqual([{ kind: "runSpecialist", phase: "RESEARCH", role: "skraft-researcher", attempt: 2, feedback: ["fichier de 55 lignes"] }]);
  });

  it("GATE_FAIL, budget épuisé → ESCALATED", () => {
    // Motifs différents à chaque essai : deux refus identiques déclencheraient le disjoncteur (ADR 0073).
    const fail = (n: string) => [REPORTED, { ...GATE_FAIL, reasons: [n] } as Ev];
    const { state, effects } = play([...toFirstPhase(), CP("RESEARCH"), ...fail("a"), ...fail("b"), ...fail("fichier de 55 lignes")]);
    expect(state.stage).toBe("ESCALATED");
    expect(state.attempts).toBe(3);
    // Le dépôt est rembobiné ET la mémoire des agents de la phase est oubliée (ADR 0050) : les
    // deux décrivent le même travail, les séparer laisse l'agent corriger un dépôt qui n'existe plus.
    expect(effects).toEqual([
      { kind: "rollback", to: "cp-RESEARCH" },
      { kind: "forgetSessions", roles: ["skraft-researcher"] },
      { kind: "askEscalation", reason: "citations : fichier de 55 lignes", options: ["retry", "skip", "abort"] },
    ]);
  });

  it("disjoncteur (ADR 0073) : le même refus deux fois de suite escalade aussitôt, sans attendre le budget", () => {
    const { state, effects } = play([...toFirstPhase(), CP("RESEARCH"), REPORTED, GATE_FAIL, REPORTED, GATE_FAIL]);
    expect(state).toMatchObject({ stage: "ESCALATED", attempts: 2 });
    expect(effects.at(-1)).toEqual({ kind: "askEscalation", reason: "citations : Même refus deux fois de suite : fichier de 55 lignes", options: ["retry", "skip", "abort"] });
  });

  it("disjoncteur : un motif différent, ou un délai entre deux refus identiques, ne le déclenche pas ; deux délais non plus", () => {
    const autre: Ev = { ...GATE_FAIL, reasons: ["autre motif"] } as Ev;
    expect(play([...toFirstPhase(), CP("RESEARCH"), REPORTED, GATE_FAIL, REPORTED, autre]).state.stage).toBe("SPECIALIST");
    const delai: Ev = { type: "TIMEOUT", reason: "silence" };
    // Avec un budget de 3, l'escalade qui suit est celle du budget, pas du disjoncteur.
    expect(play([...toFirstPhase(), CP("RESEARCH"), REPORTED, GATE_FAIL, delai, REPORTED, GATE_FAIL]).state.escalation?.reason).not.toMatch(/Même refus/);
    expect(play([...toFirstPhase(), CP("RESEARCH"), delai, delai]).state.stage).toBe("SPECIALIST");
  });

  it("TIMEOUT d'un agent : même relance qu'un GATE_FAIL, mais sans annuler le travail (ADR 0029)", () => {
    // L'équivalence TIMEOUT = GATE_FAIL tenait sur la relance et le budget ; elle ne tient pas sur
    // le rollback. Une porte a jugé le travail, un délai n'a rien jugé. Détail dans le describe
    // « interruption et verdict » plus bas.
    const { state } = play([...toFirstPhase(), CP("RESEARCH"), { type: "TIMEOUT", reason: "silence" }]);
    expect(state).toMatchObject({ stage: "SPECIALIST", attempts: 1, lastRejection: { gate: "délai" } });
    expect(state.lastRejection?.reasons.join(" ")).toContain("silence");
  });

  it("ENV_FAILURE → ESCALATED immédiat, sans consommer le budget", () => {
    const { state, effects } = play([...toFirstPhase(), CP("RESEARCH"), { type: "ENV_FAILURE", reason: "quota épuisé" }]);
    expect(state).toMatchObject({ stage: "ESCALATED", attempts: 0 });
    expect(effects).toEqual([
      { kind: "rollback", to: "cp-RESEARCH" },
      { kind: "forgetSessions", roles: ["skraft-researcher"] },
      { kind: "askEscalation", reason: "quota épuisé", options: ["retry", "skip", "abort"] },
    ]);
  });

  it("SPECIALIST + BLOCKER_REPORTED → BLOCKED ; réponse → relance avec la réponse", () => {
    const blocked = play([...toFirstPhase(), CP("RESEARCH"), { type: "BLOCKER_REPORTED", question: "Par prise ou par jour ?", choices: ["par prise", "par jour"] }]);
    expect(blocked.state.stage).toBe("BLOCKED");
    expect(blocked.effects).toEqual([{ kind: "askBlocker", question: "Par prise ou par jour ?", choices: ["par prise", "par jour"] }]);
    const answered = transition(blocked.state, DECIDE("par prise"));
    expect(answered.state.stage).toBe("SPECIALIST");
    expect(answered.state.answers).toEqual([{ question: "Par prise ou par jour ?", answer: "par prise" }]);
    expect(answered.effects).toEqual([{ kind: "runSpecialist", phase: "RESEARCH", role: "skraft-researcher", attempt: 1, feedback: [] }]);
  });

  it("D19 (docs/12) : commit en échec, aucun rembobinage ; relancer refait le commit, continuer passe à la suite et trace", () => {
    const approuve = [...toFirstPhase(), ...researchPhase, ANSWER, CP("DESIGN"), REPORTED, REPORTED, GATE_OK, LENSES(lens("APPROVED"))];
    const panne = play([...approuve, { type: "ENV_FAILURE", reason: "index.lock" } as Ev]);
    expect(panne.state).toMatchObject({ stage: "ESCALATED", escalation: { from: "COMMIT" } });
    expect(kinds(panne.effects)).toEqual(["askEscalation"]);
    expect(kinds(transition(panne.state, DECIDE("retry")).effects)).toEqual(["commitPhase"]);
    const suite = transition(panne.state, DECIDE("continue"));
    expect(suite.state).toMatchObject({ phasesCompleted: expect.arrayContaining(["DESIGN"]), nonCommitees: ["DESIGN"], lastRejection: { gate: "commit" } });
    expect(suite.state.rejections).toBe((panne.state.rejections ?? 0) + 1);
    expect(transition(suite.state, CP("DISTILL")).state.lastRejection).toBeNull();
  });

  it("REVIEW : APPROVED → COMMIT ; rapport consigné", () => {
    const { state, effects } = play([...toFirstPhase(), ...researchPhase, ANSWER, CP("DESIGN"), REPORTED, REPORTED, GATE_OK, LENSES(lens("APPROVED"))]);
    expect(state.stage).toBe("COMMIT");
    const consignees = LENSES(lens("APPROVED"));
    expect(state.reviews.DESIGN).toEqual([
      { attempt: 1, lenses: consignees.type === "LENSES_DONE" ? consignees.lenses : [], verdict: "APPROVED", reportPath: ".skraft/us-12/reviews/x.md" },
    ]);
    expect(kinds(effects)).toEqual(["commitPhase"]);
  });

  it("REVIEW : CHANGES_REQUESTED → relance avec les seuls défauts blocker et major", () => {
    const { state, effects } = play([...toFirstPhase(), ...researchPhase, ...designPhase, CP("DISTILL"), REPORTED, GATE_OK, LENSES(lens("APPROVED", ["major", "minor"]))]);
    expect(state.stage).toBe("SPECIALIST");
    expect(effects).toEqual([{ kind: "runSpecialist", phase: "DISTILL", role: "skraft-acceptance", attempt: 2, feedback: ["[cold-reader#1.1, major, code] défaut major (Sources/A.swift:3)", RESPONSE_INSTRUCTION] }]);
  });

  it("REVIEW : REJECTED → ESCALATED", () => {
    const { state } = play([...toFirstPhase(), ...researchPhase, ANSWER, CP("DESIGN"), REPORTED, REPORTED, GATE_OK, LENSES(lens("REJECTED"), lens("REJECTED"))]);
    expect(state.stage).toBe("ESCALATED");
  });

  it("COMMIT → ROUTE : phase complétée, essais remis à zéro, phase suivante", () => {
    const { state, effects } = play([...toFirstPhase(), ...researchPhase, ANSWER]);
    expect(state.phasesCompleted).toEqual(["RESEARCH"]);
    expect(state).toMatchObject({ stage: "SPECIALIST", phase: "DESIGN", attempts: 0 });
    expect(effects).toEqual([{ kind: "checkpointPhase", phase: "DESIGN" }]);
  });

  it("pipeline complet à vide : toutes les phases puis DONE avec bilan", () => {
    const { state, effects } = play([...toFirstPhase(), ...researchPhase, ...designPhase, ...reviewedPhase("DISTILL"), ...reviewedPhase("DELIVER")]);
    expect(state.stage).toBe("DONE");
    expect(state.phasesCompleted).toEqual(PHASE_ORDER);
    expect(effects).toEqual([{ kind: "finalReport" }]);
  });
});

describe("Réducteur skraft — questions ouvertes (§7.1, §11)", () => {
  it("les questions de la story sont reprises à l'initialisation", () => {
    expect(play([INITIALIZED]).state.openQuestions).toEqual([{ id: "q1", text: "Le plafond s'applique-t-il par prise ou par jour ?" }]);
  });

  it("RESEARCH démarre sans attendre ; avant DESIGN, chaque question sans réponse est posée une fois", () => {
    expect(play(toFirstPhase()).state.phase).toBe("RESEARCH");
    const { state, effects } = play([...toFirstPhase(), CP("RESEARCH"), REPORTED, { type: "GATE_OK", artifacts: [], openQuestions: ["Le plafond est-il affiché ?"] }, COMMITTED]);
    expect(state).toMatchObject({ stage: "ROUTE", phase: null });
    expect(effects).toEqual([
      { kind: "askQuestion", id: "q1", text: "Le plafond s'applique-t-il par prise ou par jour ?" },
      { kind: "askQuestion", id: "q2", text: "Le plafond est-il affiché ?" },
    ]);
  });

  it("D17 (docs/12) : panne en ROUTE, escalade relancer / abandonner ; relancer repose les seules questions non posées", () => {
    const route = [...toFirstPhase(), CP("RESEARCH"), REPORTED, { type: "GATE_OK", artifacts: [], openQuestions: ["Affiché ?"] } as Ev, COMMITTED];
    const panne = play([...route, { type: "QUESTION_ASKED", id: "q1" } as Ev, { type: "ENV_FAILURE", reason: "disque plein" } as Ev]);
    expect(panne.state.escalation).toEqual({ from: "ROUTE", reason: "disque plein" });
    expect(panne.effects).toEqual([{ kind: "askEscalation", reason: "disque plein", options: ["retry", "abort"] }]);
    // q1 a reçu sa réponse pendant l'escalade : elle n'est pas perdue.
    const repondue = transition(panne.state, DECIDE("answer:q1", "par prise"));
    expect(repondue.state.openQuestions[0]).toMatchObject({ id: "q1", answer: "par prise" });
    const relance = transition(repondue.state, DECIDE("retry"));
    expect(relance.state.stage).toBe("ROUTE");
    expect(relance.effects).toEqual([{ kind: "askQuestion", id: "q2", text: "Affiché ?" }]);
  });

  it("réponse libre ou report ; la phase suivante démarre quand tout est tranché", () => {
    const base = [...toFirstPhase(), CP("RESEARCH"), REPORTED, { type: "GATE_OK", artifacts: [], openQuestions: ["Affiché ?"] } as Ev, COMMITTED];
    const one = play([...base, DECIDE("answer:q1", "par prise")]);
    expect(one.state.stage).toBe("ROUTE");
    expect(one.effects).toEqual([]);
    const both = play([...base, DECIDE("answer:q1", "par prise"), DECIDE("defer:q2")]);
    expect(both.state.openQuestions).toEqual([
      { id: "q1", text: "Le plafond s'applique-t-il par prise ou par jour ?", answer: "par prise" },
      { id: "q2", text: "Affiché ?", answer: "(question reportée par l'utilisateur)" },
    ]);
    expect(both.state).toMatchObject({ stage: "SPECIALIST", phase: "DESIGN" });
  });

  it("story sans RESEARCH : les questions sont posées avant DESIGN", () => {
    const { state, effects } = play(toFirstPhase("simple"));
    expect(state.stage).toBe("ROUTE");
    expect(kinds(effects)).toEqual(["askQuestion"]);
  });

  it("réponse à une question inconnue ou déjà tranchée : ignorée", () => {
    const base = play([...toFirstPhase("simple")]);
    expect(transition(base.state, DECIDE("answer:q9", "x"))).toEqual({ state: base.state, effects: [] });
  });
});

describe("Réducteur skraft — ratification et escalade (§5.2)", () => {
  const withAdr: Ev = { type: "GATE_OK", artifacts: [], adrs: [{ id: "ADR-008", path: "docs/adr/adr-008-plafond.md", status: "Proposed" }] };
  const toRatification = [...toFirstPhase(), ...researchPhase, ANSWER, CP("DESIGN"), REPORTED, REPORTED, withAdr, LENSES(lens("APPROVED"))];

  it("DESIGN approuvé avec ADR proposés → RATIFICATION : une demande par ADR", () => {
    const { state, effects } = play(toRatification);
    expect(state.stage).toBe("RATIFICATION");
    expect(effects).toEqual([{ kind: "askRatification", adr: { id: "ADR-008", path: "docs/adr/adr-008-plafond.md", status: "Proposed" } }]);
  });

  it("accept de tous les ADR → COMMIT", () => {
    const { state, effects } = play([...toRatification, DECIDE("accept:ADR-008")]);
    expect(state.adrs).toEqual([{ id: "ADR-008", path: "docs/adr/adr-008-plafond.md", status: "Accepted", decisionBy: "user" }]);
    expect(state.stage).toBe("COMMIT");
    expect(effects).toEqual([
      { kind: "applyAdrStatuses", adrs: [{ path: "docs/adr/adr-008-plafond.md", status: "Accepted" }] },
      expect.objectContaining({ kind: "commitPhase", phase: "DESIGN" }),
    ]);
  });

  // D3 (docs/12) : pendant l'amendement d'un autre ADR, le fichier d'un ADR décidé le dit déjà.
  it("chaque décision écrit aussitôt son statut dans le fichier, sans attendre les autres ADR", () => {
    const deux: Ev = { type: "GATE_OK", artifacts: [], adrs: [{ id: "ADR-008", path: "docs/adr/adr-008-plafond.md", status: "Proposed" }, { id: "ADR-009", path: "docs/adr/adr-009-alerte.md", status: "Proposed" }] };
    const base = [...toFirstPhase(), ...researchPhase, ANSWER, CP("DESIGN"), REPORTED, REPORTED, deux, LENSES(lens("APPROVED"))];
    const un = play([...base, DECIDE("accept:ADR-008")]);
    expect(un.state.stage).toBe("RATIFICATION");
    expect(un.effects).toEqual([{ kind: "applyAdrStatuses", adrs: [{ path: "docs/adr/adr-008-plafond.md", status: "Accepted" }] }]);
    const amende = play([...base, DECIDE("accept:ADR-008"), DECIDE("amend:ADR-009", "alerte par prise")]);
    expect(kinds(amende.effects)).toEqual(["runSpecialist"]);
    const fin = play([...base, DECIDE("accept:ADR-008"), DECIDE("reject:ADR-009")]);
    expect(fin.effects).toEqual([
      { kind: "applyAdrStatuses", adrs: [{ path: "docs/adr/adr-009-alerte.md", status: "Rejected" }] },
      expect.objectContaining({ kind: "commitPhase", phase: "DESIGN" }),
    ]);
  });

  // D2 (docs/12) : le rembobinage efface les ADR de la phase ; la liste les oublie aussi.
  it("escalade puis « sauter » DESIGN : l'ADR proposé et effacé n'est pas ratifié, DESIGN n'est pas commitée", () => {
    const rejete = [...toFirstPhase(), ...researchPhase, ANSWER, CP("DESIGN"), REPORTED, REPORTED, withAdr, LENSES(lens("REJECTED"), { lens: "architecture", verdict: "REJECTED", defects: [] })];
    const esc = play(rejete);
    expect(esc.state.stage).toBe("ESCALATED");
    expect(esc.state.adrs).toEqual([]);
    const saute = transition(esc.state, DECIDE("skip"));
    expect(saute.state.stage).not.toBe("RATIFICATION");
    expect(kinds(saute.effects)).not.toContain("askRatification");
    expect(saute.state.skipPhases).toContain("DESIGN");
  });

  it("amend → relance de skraft-architect-decide avec la demande", () => {
    const { state, effects } = play([...toRatification, DECIDE("amend:ADR-008", "préciser le plafond journalier")]);
    expect(state.stage).toBe("SPECIALIST");
    expect(effects).toEqual([{ kind: "runSpecialist", phase: "DESIGN", role: "skraft-architect-decide", attempt: 1, feedback: ["Amendement demandé sur ADR-008 : préciser le plafond journalier"] }]);
  });

  it("D18 (docs/12) : sauter efface le motif et les défauts de la phase ; relancer les garde", () => {
    const escalated = play([...toFirstPhase(), CP("RESEARCH"), REPORTED, GATE_FAIL, REPORTED, GATE_FAIL, REPORTED, GATE_FAIL]);
    expect(escalated.state.stage).toBe("ESCALATED");
    expect(escalated.state.lastRejection).not.toBeNull();
    const saute = transition({ ...escalated.state, reviewThreads: [{ id: "x#1.1", lens: "x", severity: "major", description: "d", target: "code", status: "open", round: 1 }] }, DECIDE("skip"));
    expect(saute.state).toMatchObject({ lastRejection: null, reviewThreads: [] });
    expect(transition(escalated.state, DECIDE("retry")).state.lastRejection).toEqual(escalated.state.lastRejection);
  });

  it("ESCALATED : retry relance la phase, skip la saute avec rollback, abort termine", () => {
    const escalated = [...toFirstPhase(), CP("RESEARCH"), { type: "ENV_FAILURE", reason: "x" } as Ev];
    expect(play([...escalated, DECIDE("retry")]).effects).toEqual([{ kind: "runSpecialist", phase: "RESEARCH", role: "skraft-researcher", attempt: 1, feedback: [] }]);
    const skipped = play([...escalated, DECIDE("skip")]);
    expect(skipped.state.skipPhases).toEqual(["RESEARCH"]);
    expect(skipped.effects).toEqual([
      { kind: "rollback", to: "cp-RESEARCH" },
      { kind: "forgetSessions", roles: ["skraft-researcher"] },
      { kind: "askQuestion", id: "q1", text: "Le plafond s'applique-t-il par prise ou par jour ?" },
    ]);
    expect(play([...escalated, DECIDE("abort")]).state.stage).toBe("ABORTED");
  });

  it("ABORT depuis n'importe quel stage", () => {
    for (const events of [[], [INITIALIZED], toFirstPhase(), toRatification] as Ev[][])
      expect(play([...events, { type: "ABORT" }]).state.stage).toBe("ABORTED");
  });
});

// ---------- DELIVER (§7.4) ---------------------------------------------------------------

const SCENARIOS = [
  { id: "ac-1", ac: 1, acceptanceTestId: "A > ac-1", role: "driver", status: "pending" },
  { id: "ac-2", ac: 2, acceptanceTestId: "A > ac-2", role: "driver", status: "pending" },
  { id: "ac-3", ac: 3, acceptanceTestId: "A > ac-3", role: "regression", status: "done" },
] as const;
const PLANNED: Ev = { type: "DELIVER_PLANNED", scenarios: SCENARIOS.map((x) => ({ ...x })), all: ["A > ac-1", "A > ac-2", "A > ac-3", "U > old"], passed: ["A > ac-3", "U > old"] };
const STARTED: Ev = { type: "SCENARIO_STARTED", checkpointId: "cp-s" };
const REP_TEST: Ev = { type: "AGENT_REPORTED", role: "skraft-test", summary: "t", files: [] };
const REP_DEV: Ev = { type: "AGENT_REPORTED", role: "skraft-dev", summary: "d", files: [] };
const RED_OK = (n: number): Ev => ({ type: "STEP_OK", checkpointId: `cp-red-${n}`, all: [], passed: ["U > old"], newTest: `U > t${n}`, unitTestsHash: `h${n}` });
const GREEN_OK = (acceptanceGreen: boolean, n = 1, passed: string[] = ["U > old"]): Ev => ({ type: "STEP_OK", checkpointId: `cp-green-${n}`, all: [], passed, acceptanceGreen });
const FAIL = (reason = "motif"): Ev => ({ type: "STEP_FAIL", reason });
const DISTILL_FROZEN: Ev[] = [CP("DISTILL"), REPORTED, { ...GATE_OK, acceptanceHash: "acc" } as Ev, LENSES(lens("APPROVED")), COMMITTED];
const toDeliver = (level = "medium-hard") => [...toFirstPhase(level), ...researchPhase, ...designPhase, ...DISTILL_FROZEN, CP("DELIVER")];

describe("Écarts au plan de test (ADR 0067, PLAN_DEVIATION de skraft-plugin v1.15.1)", () => {
  const plan = { "ac-1": { couche: "Application", doublure: "dépôt en mémoire" } };
  const avecPlan = (): Ev[] => [
    ...toFirstPhase(), ...researchPhase, ...designPhase,
    CP("DISTILL"), REPORTED, { ...GATE_OK, acceptanceHash: "acc", planDeTest: plan } as Ev, LENSES(lens("APPROVED")), COMMITTED,
    CP("DELIVER"), PLANNED, STARTED,
  ];
  const ecart = { criterion: "ac-1", planned: "Application, dépôt en mémoire", actual: "Domaine, aucune", rule: "clean-architecture-testing : un invariant se teste dans le domaine" };

  it("DISTILL garde la matrice du plan de test", () => {
    expect(play(avecPlan()).state.planDeTest).toEqual(plan);
  });

  it("écart conforme : gardé quand la porte valide le pas, avec son auteur et son scénario", () => {
    const s = play([...avecPlan(), { ...REP_TEST, planDeviations: [ecart] } as Ev, RED_OK(1)]).state;
    expect(s.ecartsAuPlan).toEqual([{ ...ecart, par: "skraft-test", scenario: "ac-1" }]);
  });

  it("écart non conforme : le pas est refusé avec le motif, rien n'est gardé", () => {
    const r = play([...avecPlan(), { ...REP_TEST, planDeviations: [{ ...ecart, criterion: "ac-9" }] } as Ev]);
    expect(r.state.lastRejection).toEqual({ gate: "DELIVER", reasons: ["Écart au plan pour « ac-9 » : aucun critère de ce nom dans la matrice de test-plan.md."] });
    expect(r.effects.map((e) => e.kind)).toContain("rollback");
    expect(r.state.ecartsAuPlan ?? []).toEqual([]);
  });

  it("scénario repris depuis son début : ses écarts sont effacés avec ses tests", () => {
    const s = play([...avecPlan(), { ...REP_TEST, planDeviations: [ecart] } as Ev, RED_OK(1)]).state;
    expect(s.ecartsAuPlan).toHaveLength(1);
    const repris = transition({ ...s, deliver: { ...s.deliver!, attempts: 99 } }, { type: "STEP_FAIL", reason: "vert impossible" } as Ev).state;
    expect(repris.ecartsAuPlan ?? []).toEqual([]);
  });

  it("écart d'un pas que sa porte refuse : oublié avec le pas", () => {
    const s = play([...avecPlan(), { ...REP_TEST, planDeviations: [ecart] } as Ev, { type: "STEP_FAIL", reason: "pas de nouveau test" } as Ev, REP_TEST, RED_OK(1)]).state;
    expect(s.ecartsAuPlan ?? []).toEqual([]);
  });
});

describe("D9 (docs/12) : après une question bloquante, l'agent repart avec le retour qu'il avait", () => {
  const Q: Ev = { type: "BLOCKER_REPORTED", question: "Par prise ?", choices: [] };

  it("relancé après un rejet de porte : le motif reste", () => {
    const r = play([...toFirstPhase(), CP("RESEARCH"), REPORTED, GATE_FAIL, Q, DECIDE("oui")]);
    expect(r.effects).toEqual([{ kind: "runSpecialist", phase: "RESEARCH", role: "skraft-researcher", attempt: 2, feedback: ["fichier de 55 lignes"] }]);
  });

  it("relancé pour un amendement : la demande reste", () => {
    const r = play([...toFirstPhase(), ...researchPhase, ANSWER, CP("DESIGN"), REPORTED, REPORTED, { type: "GATE_OK", artifacts: [], adrs: [{ id: "ADR-008", path: "docs/adr/adr-008-plafond.md", status: "Proposed" }] } as Ev, LENSES(lens("APPROVED")), DECIDE("amend:ADR-008", "préciser le plafond journalier"), Q, DECIDE("oui")]);
    expect(r.effects).toEqual([{ kind: "runSpecialist", phase: "DESIGN", role: "skraft-architect-decide", attempt: 1, feedback: ["Amendement demandé sur ADR-008 : préciser le plafond journalier"] }]);
  });

  it("DELIVER, pas refusé : le motif reste", () => {
    const r = play([...toDeliver(), PLANNED, STARTED, REP_TEST, RED_OK(1), REP_DEV, FAIL("tests unitaires modifiés"), Q, DECIDE("oui")]);
    expect(r.effects).toEqual([{ kind: "runDeliverAgent", step: "dev", scenarioId: "ac-1", attempt: 2, feedback: ["tests unitaires modifiés"] }]);
  });
});

describe("Réducteur skraft — gel révisable pendant DISTILL", () => {
  const toReview = () => [
    ...toFirstPhase(), ...researchPhase, ...designPhase,
    CP("DISTILL"), REPORTED,
    { ...GATE_OK, acceptanceHash: "avant", regressions: ["ancienne"] } as Ev,
  ];

  it("un refus de revue lève le gel, puis les portes enregistrent l'ensemble corrigé pour DELIVER", () => {
    const refus = [...toReview(), LENSES(lens("CHANGES_REQUESTED", ["major"]))];
    expect(play(refus).state).toMatchObject({ stage: "SPECIALIST", phase: "DISTILL", acceptanceHash: null, regressions: [] });
    const correction = [...refus, REPORTED, { ...GATE_OK, acceptanceHash: "apres", regressions: ["nouvelle"] } as Ev];
    expect(play(correction).state).toMatchObject({ stage: "REVIEW", acceptanceHash: "apres", regressions: ["nouvelle"] });
    const approuve = [...correction, LENSES(lens("APPROVED")), COMMITTED, CP("DELIVER"), PLANNED];
    expect(play(approuve).state.deliver?.acceptanceHash).toBe("apres");
  });

  it.each([
    ["délai de revue", TIMEOUT("silence")],
    ["panne de revue", { type: "ENV_FAILURE", reason: "runtime indisponible" } as Ev],
    ["rejet définitif", LENSES(lens("REJECTED"))],
  ])("%s : invalide le gel de DISTILL avant une reprise", (_nom, evenement) => {
    expect(play([...toReview(), evenement]).state).toMatchObject({ acceptanceHash: null, regressions: [] });
  });

  // Défaut relevé en préparant docs/skraft-fonctionnement (13/10) : depuis D19, la panne du commit
  // de DISTILL passait par leverGelDistill avant d'être reconnue comme une panne de commit. La phase
  // est approuvée : rien ne sera refait, l'empreinte doit rester.
  it.each(["retry", "continue"])("commit de DISTILL en échec, « %s » : l'empreinte et les non-régressions restent jusqu'à DELIVER", (choix) => {
    const panne = [...toReview(), LENSES(lens("APPROVED")), { type: "ENV_FAILURE", reason: "index.lock" } as Ev];
    expect(play(panne).state).toMatchObject({ stage: "ESCALATED", escalation: { from: "COMMIT" }, acceptanceHash: "avant", regressions: ["ancienne"] });
    const suite = [...panne, DECIDE(choix), ...(choix === "retry" ? [COMMITTED] : []), CP("DELIVER"), PLANNED];
    const s = play(suite).state;
    expect(s).toMatchObject({ phase: "DELIVER", acceptanceHash: "avant", regressions: ["ancienne"] });
    expect(s.deliver?.acceptanceHash).toBe("avant");
  });

  it("un deuxième refus à budget épuisé lève le gel avant rembobinage", () => {
    const s = play([
      ...toReview(), LENSES(lens("CHANGES_REQUESTED", ["major"])), REPORTED,
      { ...GATE_OK, acceptanceHash: "apres" } as Ev,
    ]).state;
    const r = transition({ ...s, attempts: 99 }, LENSES(lens("CHANGES_REQUESTED", ["major"])));
    expect(r.state).toMatchObject({ stage: "ESCALATED", acceptanceHash: null, regressions: [] });
    expect(r.effects.map((e) => e.kind)).toContain("rollback");
  });

  it("un refus de revue en DELIVER conserve le gel d'acceptance", () => {
    const s = play(toDeliver()).state;
    const r = transition({ ...s, stage: "REVIEW" }, LENSES(lens("CHANGES_REQUESTED", ["major"])));
    expect(r.state.acceptanceHash).toBe("acc");
  });
});

describe("Réducteur skraft — sous-machine DELIVER (§7.4)", () => {
  it("début de DELIVER : plan des scénarios par le code ; les non-régressions sont déjà faites ; empreinte gelée reprise", () => {
    expect(play(toDeliver()).effects).toEqual([{ kind: "planDeliver" }]);
    const { state, effects } = play([...toDeliver(), PLANNED]);
    expect(effects).toEqual([{ kind: "startScenario", scenarioId: "ac-1" }]);
    expect(state.deliver).toMatchObject({ granularity: "turn-per-scenario", acceptanceHash: "acc", current: 0 });
    expect(state.deliver!.scenarios.map((x) => x.status)).toEqual(["in_progress", "pending", "done"]);
    expect(validateState(state)).toEqual({ ok: true });
  });

  it("un scénario dont l'acceptance ne verdit jamais finit par échouer au lieu de boucler", () => {
    // Plusieurs cycles test → code sont normaux en TDD, mais pas un nombre illimité : sans
    // plafond, un scénario impossible ajoute un test et un checkpoint à chaque tour, sans fin.
    const cycles = (n: number) => Array.from({ length: n }, () => [REP_TEST, RED_OK(1), REP_DEV, GREEN_OK(false)]).flat();

    // Sous le plafond (20) : le scénario continue normalement.
    const avant = play([...toDeliver(), PLANNED, STARTED, ...cycles(19)]);
    expect(kinds(avant.effects)).toEqual(["runDeliverAgent"]);
    expect(avant.state.deliver?.cycles).toBe(19);

    // Au plafond : le scénario est repris depuis son début, avec rollback et motif.
    const auPlafond = play([...toDeliver(), PLANNED, STARTED, ...cycles(20)]);
    expect(kinds(auPlafond.effects)).toContain("rollback");
    expect(auPlafond.state.deliver).toMatchObject({ scenarioFailures: 1, cycles: 0 });
    expect(auPlafond.state.deliver?.feedback.join(" ")).toMatch(/reste rouge/);

    // Le scénario emprunte bien le chemin d'échec : il repasse en sessions séparées, d'où
    // l'escalade à l'humain après trois reprises (couverte par les tests de la porte de scénario).
    expect(auPlafond.state.deliver?.granularity).toBe("session-per-step");
  });

  // ADR 0045 : un comportement déjà vérifié par le test d'acceptance du scénario n'exige pas de
  // test unitaire. Le testeur le déclare (`coveredBy`), le code le vérifie, et le test d'acceptance
  // devient la cible du pas de code — sans entrer dans la liste des tests unitaires du scénario.
  it("couvert par l'acceptance : la déclaration du testeur est transmise à la porte RED", () => {
    const r = play([...toDeliver(), PLANNED, STARTED, { ...REP_TEST, coveredBy: "A > ac-1" } as Ev]);
    expect(r.effects).toEqual([expect.objectContaining({ kind: "verifyUnitRed", scenarioId: "ac-1", coveredBy: "A > ac-1" })]);
  });

  it("couvert par l'acceptance : le pas de code vise le test d'acceptance, aucun test unitaire n'est ajouté", () => {
    const viaAcceptance: Ev = { type: "STEP_OK", checkpointId: "cp-acc", all: [], passed: ["U > old"], newTest: "A > ac-1", viaAcceptance: true };
    const r = play([...toDeliver(), PLANNED, STARTED, REP_TEST, viaAcceptance]);
    expect(r.effects).toEqual([{ kind: "runDeliverAgent", step: "dev", scenarioId: "ac-1", attempt: 1, feedback: [] }]);
    expect(r.state.deliver).toMatchObject({ newTest: "A > ac-1", unitTests: [], step: "dev" });
    const dev = play([...toDeliver(), PLANNED, STARTED, REP_TEST, viaAcceptance, REP_DEV]);
    expect(dev.effects).toEqual([expect.objectContaining({ kind: "verifyUnitGreen", mode: "dev", newTest: "A > ac-1" })]);
  });

  it("un tour par pas : test rouge, puis code, jusqu'au vert de l'acceptance ; porte de fin de scénario", () => {
    let r = play([...toDeliver(), PLANNED, STARTED]);
    expect(r.effects).toEqual([{ kind: "runDeliverAgent", step: "test", scenarioId: "ac-1", attempt: 1, feedback: [] }]);
    r = play([...toDeliver(), PLANNED, STARTED, REP_TEST]);
    expect(r.effects).toEqual([
      { kind: "verifyUnitRed", scenarioId: "ac-1", since: "cp-s", baseline: { all: PLANNED.type === "DELIVER_PLANNED" ? PLANNED.all : [], passed: ["A > ac-3", "U > old"] }, pending: ["A > ac-1", "A > ac-2"] },
    ]);
    r = play([...toDeliver(), PLANNED, STARTED, REP_TEST, RED_OK(1), REP_DEV]);
    expect(r.effects).toEqual([
      { kind: "verifyUnitGreen", mode: "dev", scenarioId: "ac-1", since: "cp-red-1", newTest: "U > t1", unitTestsHash: "h1", pending: ["A > ac-1", "A > ac-2"] },
    ]);
    // Acceptance encore rouge : nouveau test unitaire.
    r = play([...toDeliver(), PLANNED, STARTED, REP_TEST, RED_OK(1), REP_DEV, GREEN_OK(false)]);
    expect(r.effects).toEqual([{ kind: "runDeliverAgent", step: "test", scenarioId: "ac-1", attempt: 1, feedback: [] }]);
    // Acceptance verte : porte de fin de scénario, le test du scénario suivant reste autorisé à échouer.
    r = play([...toDeliver(), PLANNED, STARTED, REP_TEST, RED_OK(1), REP_DEV, GREEN_OK(false), REP_TEST, RED_OK(2), REP_DEV, GREEN_OK(true, 2)]);
    expect(r.effects).toEqual([{ kind: "scenarioGate", scenarioId: "ac-1", since: "cp-s", unitTests: ["U > t1", "U > t2"], pending: ["A > ac-2"] }]);
    r = play([...toDeliver(), PLANNED, STARTED, REP_TEST, RED_OK(1), REP_DEV, GREEN_OK(true), { type: "SCENARIO_OK", notes: ["n"] }]);
    expect(r.effects).toEqual([{ kind: "startScenario", scenarioId: "ac-2" }]);
    expect(r.state.deliver).toMatchObject({ current: 1, unitTests: [], notes: ["n"] });
  });

  it("scénario déjà vert à son début : directement la porte ; dernier scénario → porte de phase", () => {
    const passedAll = ["U > old", "U > t1", "A > ac-1", "A > ac-2", "A > ac-3"];
    const base = [...toDeliver(), PLANNED, STARTED, REP_TEST, RED_OK(1), REP_DEV, GREEN_OK(true, 1, passedAll), { type: "SCENARIO_OK", notes: [] } as Ev];
    const r = play([...base, { type: "SCENARIO_STARTED", checkpointId: "cp-s2" }]);
    expect(r.effects).toEqual([{ kind: "scenarioGate", scenarioId: "ac-2", since: "cp-s2", unitTests: [], pending: [] }]);
    // Le code d'un pas précédent l'a fait passer sans test rouge qui le demande : noté, sans refus (08/11).
    expect(r.state.deliver?.notes).toContain("Scénario ac-2 : déjà vert avant son premier pas ; le code d'un pas précédent l'a fait passer sans test rouge qui le demande.");
    const end = play([...base, { type: "SCENARIO_STARTED", checkpointId: "cp-s2" }, { type: "SCENARIO_OK", notes: [] }]);
    expect(end.state.stage).toBe("ARTIFACT_GATE");
    expect(end.effects).toEqual([{ kind: "runGate", phase: "DELIVER", attempt: 1 }]);
  });

  it("sessions séparées (challenging ou réglage) : rouge, vert, nettoyage ; nettoyage refusé → retour au vert sans escalade", () => {
    expect(play([...toDeliver("challenging"), PLANNED]).state.deliver?.granularity).toBe("session-per-step");
    expect(play([...toDeliver(), PLANNED], { storyPath: "stories/us-12.md", granularity: "session-per-step" } as never).state.deliver?.granularity).toBe("session-per-step");
    const strict = [...toDeliver("challenging"), PLANNED, STARTED, REP_TEST, RED_OK(1)];
    expect(play(strict).effects).toEqual([{ kind: "runDeliverAgent", step: "green", scenarioId: "ac-1", attempt: 1, feedback: [] }]);
    expect(play([...strict, REP_DEV]).effects[0]).toMatchObject({ kind: "verifyUnitGreen", mode: "green" });
    expect(play([...strict, REP_DEV, GREEN_OK(true)]).effects).toEqual([{ kind: "runDeliverAgent", step: "refactor", scenarioId: "ac-1", attempt: 1, feedback: [] }]);
    const refused = play([...strict, REP_DEV, GREEN_OK(true), REP_DEV, FAIL("suite rouge")]);
    expect(refused.effects).toEqual([
      { kind: "rollback", to: "cp-green-1" },
      { kind: "scenarioGate", scenarioId: "ac-1", since: "cp-s", unitTests: ["U > t1"], pending: ["A > ac-2"] },
    ]);
    expect(refused.state.deliver?.attempts).toBe(0);
    expect(refused.state.deliver?.notes).toEqual(["Scénario ac-1 : nettoyage annulé (suite rouge)"]);
    // D21 (docs/12) : compté et tracé, sous le nom de porte du workflow.
    expect(refused.state.rejections).toBe((play([...strict, REP_DEV, GREEN_OK(true), REP_DEV]).state.rejections ?? 0) + 1);
    expect(refused.state.lastRejection).toEqual({ gate: "pas refactor (ac-1)", reasons: ["suite rouge"] });
  });

  it("D21 (docs/12) : plafond de cycles et relance du classifieur comptés et tracés comme rejets", () => {
    const cycles = (n: number) => Array.from({ length: n }, () => [REP_TEST, RED_OK(1), REP_DEV, GREEN_OK(false)]).flat();
    const avant = play([...toDeliver(), PLANNED, STARTED, ...cycles(19), REP_TEST, RED_OK(1), REP_DEV]);
    const plafond = transition(avant.state, GREEN_OK(false));
    expect(plafond.state.rejections).toBe((avant.state.rejections ?? 0) + 1);
    expect(plafond.state.lastRejection).toEqual({ gate: "scénario ac-1", reasons: [expect.stringMatching(/reste rouge après 20 cycles/)] });
    const inconnu = play([INITIALIZED, PROPOSED("très difficile")]);
    expect(inconnu.state.rejections).toBe(1);
    expect(inconnu.state.lastRejection).toEqual({ gate: "classifieur", reasons: ["Niveau de difficulté inconnu : très difficile"] });
    // Le motif du classifieur n'est pas un « rejet précédent » pour la première phase.
    expect(play([INITIALIZED, PROPOSED("très difficile"), PROPOSED("medium"), DECIDE("medium")]).state.lastRejection).toBeNull();
  });

  describe("D20 (docs/12) : une escalade de DELIVER rembobine ET fait oublier les sessions (ADR 0050)", () => {
    const oubli = { kind: "forgetSessions", roles: ["skraft-test", "skraft-dev"] };

    it("panne d'environnement pendant un scénario", () => {
      const r = play([...toDeliver(), PLANNED, STARTED, REP_TEST, { type: "ENV_FAILURE", reason: "Copilot injoignable" } as Ev]);
      expect(r.state.stage).toBe("ESCALATED");
      expect(r.effects).toEqual([{ kind: "rollback", to: "cp-s" }, oubli, expect.objectContaining({ kind: "askEscalation" })]);
    });

    it("scénario en échec au-delà du budget", () => {
      // Motifs différents : deux échecs identiques déclencheraient le disjoncteur (ADR 0073).
      const echec = (n: number): Ev => ({ type: "SCENARIO_FAIL", reasons: [`acceptance rouge ${n}`] });
      const r = play([...toDeliver(), PLANNED, STARTED, echec(1), echec(2), echec(3)]);
      expect(r.state.stage).toBe("ESCALATED");
      expect(r.effects).toEqual([{ kind: "rollback", to: "cp-s" }, oubli, expect.objectContaining({ kind: "askEscalation" })]);
    });
  });

  it("pas refusé : rollback au dernier point sûr, relance ciblée ; budget épuisé en mode tour → scénario repris en sessions séparées", () => {
    const dev = [...toDeliver(), PLANNED, STARTED, REP_TEST, RED_OK(1), REP_DEV];
    const once = play([...dev, FAIL("tests unitaires modifiés")]);
    expect(once.effects).toEqual([
      { kind: "rollback", to: "cp-red-1" },
      { kind: "runDeliverAgent", step: "dev", scenarioId: "ac-1", attempt: 2, feedback: ["tests unitaires modifiés"] },
    ]);
    const exhausted = play([...dev, FAIL("a"), REP_DEV, FAIL("b"), REP_DEV, FAIL("c")]);
    expect(exhausted.effects).toEqual([{ kind: "rollback", to: "cp-s" }, { kind: "runDeliverAgent", step: "test", scenarioId: "ac-1", attempt: 1, feedback: ["c"] }]);
    expect(exhausted.state.deliver).toMatchObject({ granularity: "session-per-step", unitTests: [], scenarioFailures: 1, stepCheckpoint: "cp-s" });
    expect(exhausted.state.stage).toBe("SPECIALIST");
  });

  it("porte de fin de scénario refusée : reprise du scénario avec les motifs, puis escalade au budget ; « retry » relance le scénario", () => {
    const gate = [...toDeliver("challenging"), PLANNED, STARTED, REP_TEST, RED_OK(1), REP_DEV, GREEN_OK(true), REP_DEV, GREEN_OK(true, 2)];
    const fail1 = play([...gate, { type: "SCENARIO_FAIL", reasons: ["Mutation : 95 %"] }]);
    expect(fail1.effects).toEqual([{ kind: "rollback", to: "cp-s" }, { kind: "runDeliverAgent", step: "test", scenarioId: "ac-1", attempt: 1, feedback: ["Mutation : 95 %"] }]);
    // Score différent à chaque reprise : le même deux fois déclencherait le disjoncteur (ADR 0073).
    const again = (st: Ev[], score: string) => [...st, REP_TEST, RED_OK(1), REP_DEV, GREEN_OK(true), REP_DEV, GREEN_OK(true, 2), { type: "SCENARIO_FAIL", reasons: [`Mutation : ${score}`] } as Ev];
    const esc = play(again(again([...gate, { type: "SCENARIO_FAIL", reasons: ["Mutation : 90 %"] }], "93 %"), "95 %"));
    expect(esc.state.stage).toBe("ESCALATED");
    // Rembobiner et oublier vont ensemble (ADR 0050, D20 de docs/12).
    expect(esc.effects).toEqual([
      { kind: "rollback", to: "cp-s" },
      { kind: "forgetSessions", roles: ["skraft-test", "skraft-dev"] },
      { kind: "askEscalation", reason: "Scénario ac-1 : Mutation : 95 %", options: ["retry", "skip", "abort"] },
    ]);
    const retried = transition(esc.state, DECIDE("retry"));
    expect(retried.effects).toEqual([{ kind: "runDeliverAgent", step: "test", scenarioId: "ac-1", attempt: 1, feedback: ["Mutation : 95 %"] }]);
    expect(retried.state.deliver?.scenarioFailures).toBe(0);
  });

  it("blocage métier pendant un pas → BLOCKED ; la réponse relance le même pas", () => {
    const blocked = play([...toDeliver(), PLANNED, STARTED, REP_TEST, RED_OK(1), { type: "BLOCKER_REPORTED", question: "Plafond par prise ?", choices: ["oui", "non"] }]);
    expect(blocked.state.stage).toBe("BLOCKED");
    const r = transition(blocked.state, DECIDE("oui"));
    expect(r.effects).toEqual([{ kind: "runDeliverAgent", step: "dev", scenarioId: "ac-1", attempt: 1, feedback: [] }]);
    expect(r.state.answers).toEqual([{ question: "Plafond par prise ?", answer: "oui" }]);
  });

  it("revue de DELIVER avec défaut major : retour au dernier vert, correction ciblée, porte de fin de scénario, nouvelle revue", () => {
    const passedAll = ["U > old", "U > t1", "A > ac-1", "A > ac-2", "A > ac-3"];
    const delivered = [
      ...toDeliver(), PLANNED, STARTED, REP_TEST, RED_OK(1), REP_DEV, GREEN_OK(true, 1, passedAll), { type: "SCENARIO_OK", notes: [], facts: ["Mutation (ac-1) : 100 %"] } as Ev,
      { type: "SCENARIO_STARTED", checkpointId: "cp-s2" } as Ev, { type: "SCENARIO_OK", notes: [] } as Ev, GATE_OK,
    ];
    const major: LensVerdict = { lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [{ severity: "major", description: "MaxBolus accepte une valeur négative", file: "Sources/Domain/BolusCap.swift", line: 2 }, { severity: "minor", description: "nom" }] };
    const fix = play([...delivered, LENSES(major)]);
    const defect = "[cold-reader#1.1, major, code] MaxBolus accepte une valeur négative (Sources/Domain/BolusCap.swift:2)";
    expect(fix.effects).toEqual([{ kind: "rollback", to: "cp-s2" }, { kind: "runDeliverAgent", step: "fix", scenarioId: "ac-2", attempt: 1, feedback: [defect, RESPONSE_INSTRUCTION] }]);
    expect(fix.state).toMatchObject({ stage: "SPECIALIST", attempts: 1, retries: { DELIVER: 1 }, rejections: 1 });
    expect(fix.state.deliver!.scenarios[0]!.unitTests).toEqual(["U > t1"]);
    const verify = transition(fix.state, REP_DEV);
    expect(verify.effects).toEqual([{ kind: "verifyUnitGreen", mode: "fix", scenarioId: "ac-2", since: "cp-s2", newTest: null, unitTestsHash: "h1", pending: [] }]);
    const gate = transition(verify.state, { type: "STEP_OK", checkpointId: "cp-fix", all: [], passed: passedAll, acceptanceGreen: true });
    expect(gate.effects).toEqual([{ kind: "scenarioGate", scenarioId: "ac-2", since: "cp-s2", unitTests: [], pending: [] }]);
    const back = transition(gate.state, { type: "SCENARIO_OK", notes: [] });
    expect(back.effects).toEqual([{ kind: "runGate", phase: "DELIVER", attempt: 2 }]);
    expect(back.state.deliver!.fixing).toBe(false);
    expect(back.state.deliver!.facts).toEqual(["Mutation (ac-1) : 100 %"]);
  });

  describe("correction de revue : défauts conservés, correction seulement s'il y a quoi corriger", () => {
    const passedAll = ["U > old", "U > t1", "A > ac-1", "A > ac-2", "A > ac-3"];
    const delivered = [
      ...toDeliver(), PLANNED, STARTED, REP_TEST, RED_OK(1), REP_DEV, GREEN_OK(true, 1, passedAll), { type: "SCENARIO_OK", notes: [] } as Ev,
      { type: "SCENARIO_STARTED", checkpointId: "cp-s2" } as Ev, { type: "SCENARIO_OK", notes: [] } as Ev, GATE_OK,
    ];
    const defect = "[cold-reader#1.1, major, code] MaxBolus accepte une valeur négative (Sources/Domain/BolusCap.swift:2)";
    const major = LENSES({ lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [{ severity: "major", description: "MaxBolus accepte une valeur négative", file: "Sources/Domain/BolusCap.swift", line: 2 }] });

    it("pas de correction refusé : relance avec les défauts de revue ET le motif du refus", () => {
      const r = play([...delivered, major, REP_DEV, FAIL("Tests en échec : U > t1.")]);
      expect(r.effects).toEqual([
        { kind: "rollback", to: "cp-s2" },
        { kind: "runDeliverAgent", step: "fix", scenarioId: "ac-2", attempt: 2, feedback: [defect, RESPONSE_INSTRUCTION, "Tests en échec : U > t1."] },
      ]);
    });

    it("porte de fin de scénario refusée après correction : les défauts de revue restent transmis", () => {
      const r = play([...delivered, major, REP_DEV, { type: "STEP_OK", checkpointId: "cp-fix", all: [], passed: passedAll, acceptanceGreen: true }, { type: "SCENARIO_FAIL", reasons: ["Mutation : 90 %"] }]);
      expect(r.effects.at(-1)).toEqual({ kind: "runDeliverAgent", step: "fix", scenarioId: "ac-2", attempt: 1, feedback: [defect, RESPONSE_INSTRUCTION, "Mutation : 90 %"] });
    });

    it("D14 (docs/12) : panne pendant la correction, « relancer » la reprend, sans replanifier DELIVER", () => {
      const panne = play([...delivered, major, { type: "ENV_FAILURE", reason: "Copilot injoignable" } as Ev]);
      expect(panne.state.stage).toBe("ESCALATED");
      const relance = transition(panne.state, DECIDE("retry"));
      expect(kinds(relance.effects)).not.toContain("planDeliver");
      expect(relance.effects).toEqual([expect.objectContaining({ kind: "runDeliverAgent", step: "fix", feedback: expect.arrayContaining([defect]) })]);
    });

    it("ADR 0066 : correction escaladée sur un test qui passait avant DELIVER ; « déclarer obsolète » reprend la correction, sans replanifier", () => {
      let r = play([...delivered, major]);
      const rouge: Ev = { type: "STEP_FAIL", reason: "Tests en échec : U > old.", rouges: ["U > old"] };
      for (let n = 0; n < 20 && r.state.stage !== "ESCALATED"; n++) r = transition(transition(r.state, REP_DEV).state, rouge);
      expect(r.state.stage).toBe("ESCALATED");
      expect(r.effects.at(-1)).toMatchObject({ kind: "askEscalation", options: ["obsolete", "retry", "skip", "abort"] });
      const suite = transition(r.state, { type: "HUMAN_DECISION", decision: "obsolete", comment: "comportement changé" });
      expect(suite.state.testsObsoletes).toEqual([{ test: "U > old", scenario: "ac-2", raison: "comportement changé" }]);
      expect(kinds(suite.effects)).not.toContain("planDeliver");
      expect(suite.effects).toEqual([expect.objectContaining({ kind: "runDeliverAgent", step: "fix", feedback: expect.arrayContaining([defect]) })]);
    });

    it("blocage pendant la correction : la réponse relance la correction avec ses défauts", () => {
      const blocked = play([...delivered, major, { type: "BLOCKER_REPORTED", question: "Valeur minimale ?", choices: [] }]);
      expect(transition(blocked.state, DECIDE("0")).effects).toEqual([{ kind: "runDeliverAgent", step: "fix", scenarioId: "ac-2", attempt: 1, feedback: [defect, RESPONSE_INSTRUCTION] }]);
    });

    // D5 (docs/12) : tout est vert, rejouer la phase ne ferait travailler personne.
    it("changements demandés avec des défauts mineurs seulement : correction ciblée, comme un majeur", () => {
      const minorOnly = LENSES({ lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [{ severity: "minor", description: "nom vague", target: "code" }] });
      const r = play([...delivered, minorOnly]);
      expect(r.effects).toEqual([
        { kind: "rollback", to: "cp-s2" },
        { kind: "runDeliverAgent", step: "fix", scenarioId: "ac-2", attempt: 1, feedback: ["[cold-reader#1.mineur1, minor, code] nom vague", RESPONSE_INSTRUCTION] },
      ]);
      expect(kinds(r.effects)).not.toContain("planDeliver");
    });

    it("changements demandés sans aucun défaut : personne à qui l'adresser, escalade sans consommer d'essai", () => {
      const empty = LENSES({ lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [] });
      const before = play(delivered).state.attempts;
      const r = play([...delivered, empty]);
      expect(r.state.stage).toBe("ESCALATED");
      expect(r.state.attempts).toBe(before);
      expect(r.state.escalation?.reason).toMatch(/sans défaut à corriger.*cold-reader : CHANGES_REQUESTED/);
    });
  });

  it("état persisté avant S6 (sans retries, facts, fixing) : repris sans erreur et toujours valide", () => {
    const current = play([...toDeliver(), PLANNED, STARTED, REP_TEST, RED_OK(1), REP_DEV]).state;
    const { retries: _r, ...withoutRetries } = current;
    const { facts: _f, fixing: _x, reviewDefects: _d, ...oldDeliver } = current.deliver!;
    const old = { ...withoutRetries, deliver: oldDeliver } as SkraftState;
    expect(validateState(old)).toEqual({ ok: true });
    const failed = transition(old, FAIL("motif"));
    expect(failed.state.retries).toEqual({ DELIVER: 1 });
    const done = transition(transition(old, GREEN_OK(true)).state, { type: "SCENARIO_OK", notes: [], facts: ["f"] });
    expect(done.state.deliver?.facts).toEqual(["f"]);
  });

  it("panne d'environnement pendant un scénario : retour au début du scénario et escalade, sans perdre les scénarios livrés", () => {
    const base = [...toDeliver(), PLANNED, STARTED, REP_TEST, RED_OK(1), REP_DEV, GREEN_OK(true), { type: "SCENARIO_OK", notes: [] } as Ev, { type: "SCENARIO_STARTED", checkpointId: "cp-s2" } as Ev];
    const r = play([...base, REP_TEST, { type: "ENV_FAILURE", reason: "swift introuvable" }]);
    expect(r.effects).toEqual([
      { kind: "rollback", to: "cp-s2" },
      { kind: "forgetSessions", roles: ["skraft-test", "skraft-dev"] },
      { kind: "askEscalation", reason: "swift introuvable", options: ["retry", "skip", "abort"] },
    ]);
    expect(r.state.deliver!.scenarios.map((x) => x.status)).toEqual(["done", "in_progress", "done"]);
    expect(transition(r.state, DECIDE("retry")).effects).toEqual([{ kind: "runDeliverAgent", step: "test", scenarioId: "ac-2", attempt: 1, feedback: [] }]);
  });
});

/**
 * D4 (docs/12) : une question de lentille n'est pas un échec du producteur. Elle part à l'humain ;
 * la phase est rejouée avec la question et la réponse, sans consommer d'essai (DELIVER : seule la
 * revue est relancée). Au-delà de deux questions de revue dans une phase, escalade.
 */
describe("question d'une lentille (D4)", () => {
  const enRevueDesign = () => [...toFirstPhase(), ...researchPhase, ANSWER, CP("DESIGN"), REPORTED, REPORTED, GATE_OK];
  const QUESTION: Ev = { type: "LENS_BLOCKED", lens: "architecture", question: "Le palier s'applique-t-il par ligne ou par commande ?", choices: ["par ligne", "par commande"] };

  it("la question part à l'humain, au nom de la lentille", () => {
    const r = play([...enRevueDesign(), QUESTION]);
    expect(r.state.stage).toBe("BLOCKED");
    expect(r.effects).toEqual([{ kind: "askBlocker", question: "Le palier s'applique-t-il par ligne ou par commande ?", choices: ["par ligne", "par commande"], lens: "architecture" }]);
  });

  it("la réponse fait rejouer la phase depuis la modélisation, sans consommer d'essai, avec la question et la réponse", () => {
    const avant = play(enRevueDesign()).state;
    const r = play([...enRevueDesign(), QUESTION, DECIDE("par ligne")]);
    const motif = "Question de la revue (architecture) : Le palier s'applique-t-il par ligne ou par commande ? — Réponse de l'utilisateur : par ligne";
    expect(r.effects).toEqual([{ kind: "runSpecialist", phase: "DESIGN", role: "skraft-architect-model", attempt: avant.attempts + 1, feedback: [motif] }]);
    expect(r.state).toMatchObject({ stage: "SPECIALIST", attempts: avant.attempts, designStep: "model", blocker: null });
    expect(r.state.answers).toContainEqual({ question: "Le palier s'applique-t-il par ligne ou par commande ?", answer: "par ligne" });
    // Tracé comme un rejeu, avec sa vraie cause (docs/10 §4.3).
    expect(r.state.rejections).toBe((avant.rejections ?? 0) + 1);
    expect(r.state.lastRejection).toEqual({ gate: "question de revue", reasons: [motif] });
  });

  it("une troisième question de revue dans la phase : escalade", () => {
    const tour = [REPORTED, REPORTED, GATE_OK];
    const r = play([...enRevueDesign(), QUESTION, DECIDE("par ligne"), ...tour, { ...QUESTION, question: "Q2 ?" } as Ev, DECIDE("oui"), ...tour, { ...QUESTION, question: "Q3 ?" } as Ev]);
    expect(r.state.stage).toBe("ESCALATED");
    expect(r.state.escalation?.reason).toMatch(/Plus de 2 questions de revue.*Q3 \?/);
  });

  it("DELIVER : la réponse relance la revue seule, rien n'est rejoué à vide", () => {
    const passedAll = ["U > old", "U > t1", "A > ac-1", "A > ac-2", "A > ac-3"];
    const delivered = [
      ...toDeliver(), PLANNED, STARTED, REP_TEST, RED_OK(1), REP_DEV, GREEN_OK(true, 1, passedAll), { type: "SCENARIO_OK", notes: [] } as Ev,
      { type: "SCENARIO_STARTED", checkpointId: "cp-s2" } as Ev, { type: "SCENARIO_OK", notes: [] } as Ev, GATE_OK,
    ];
    const r = play([...delivered, QUESTION, DECIDE("par ligne")]);
    expect(r.state.stage).toBe("REVIEW");
    expect(kinds(r.effects)).toEqual(["runReview"]);
  });
});

describe("Skills chargées à la demande (D26)", () => {
  it("chaque AGENT_REPORTED qui porte des skills est tracé avec sa phase et son rôle, sans changer la suite", () => {
    const base = [...toFirstPhase(), CP("RESEARCH")];
    const traced = play([...base, { ...REPORTED, skills: ["architecture-patterns"] } as Ev]);
    const plain = play([...base, REPORTED]);
    expect(traced.state.skillsLoaded).toEqual([{ phase: "RESEARCH", role: "skraft-researcher", skills: ["architecture-patterns"] }]);
    expect(traced.effects).toEqual(plain.effects);
    expect(plain.state.skillsLoaded).toBeUndefined();
    expect(validateState(traced.state)).toEqual({ ok: true });
  });
});

describe("Invariants (§5.3)", () => {
  /** Générateur pseudo-aléatoire déterministe : suites d'événements plausibles et absurdes. */
  function* randomRuns(n: number): Generator<Ev[]> {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pool: Ev[] = [
      INITIALIZED, PROPOSED("simple"), PROPOSED("medium-hard"), DECIDE("medium"), DECIDE("challenging"), DECIDE("retry"), DECIDE("skip"), DECIDE("accept:ADR-008"), DECIDE("amend:ADR-008", "x"),
      DECIDE("answer:q1", "par prise"), DECIDE("defer:q1"), CP("RESEARCH"), CP("DESIGN"), CP("DISTILL"), CP("DELIVER"), REPORTED, GATE_OK, GATE_FAIL, { type: "GATE_OK", artifacts: [], adrs: [{ id: "ADR-008", path: "p", status: "Proposed" }] },
      LENSES(lens("APPROVED")), LENSES(lens("APPROVED", ["major"])), LENSES(lens("REJECTED"), lens("REJECTED")), COMMITTED,
      { type: "TIMEOUT", reason: "t" }, { type: "BLOCKER_REPORTED", question: "q", choices: [] }, { type: "RESUMED" },
      PLANNED, STARTED, REP_TEST, REP_DEV, RED_OK(1), GREEN_OK(false), GREEN_OK(true), { type: "STEP_FAIL", reason: "r" }, { type: "SCENARIO_OK", notes: [] },
      { type: "SCENARIO_FAIL", reasons: ["m"] }, { type: "ENV_FAILURE", reason: "e" }, DECIDE("abort"),
    ];
    for (let i = 0; i < n; i++) yield Array.from({ length: 5 + Math.floor(rnd() * 60) }, () => pool[Math.floor(rnd() * pool.length)]!);
  }

  it("1–8 tiennent sur 400 suites d'événements pseudo-aléatoires", () => {
    for (const events of randomRuns(400)) {
      let s = initialState({ storyPath: "s.md" });
      let prevCompleted: string[] = [];
      let prevArtifacts = 0;
      let prevReviews = 0;
      let prevDifficulty = s.difficulty;
      for (const e of events) {
        const before = s;
        s = transition(s, e).state;
        // 3. le budget n'est jamais dépassé
        expect(s.attempts).toBeLessThanOrEqual(s.budget.maxAttemptsPerPhase);
        if (s.deliver) {
          expect(s.deliver.attempts).toBeLessThan(s.budget.maxAttemptsPerPhase);
          expect(s.deliver.scenarioFailures).toBeLessThanOrEqual(s.budget.maxAttemptsPerPhase);
        }
        // 4. append-only
        expect(s.phasesCompleted.slice(0, prevCompleted.length)).toEqual(prevCompleted);
        const artifacts = Object.values(s.artifacts).flat().length;
        const reviews = Object.values(s.reviews).flat().length;
        expect(artifacts).toBeGreaterThanOrEqual(prevArtifacts);
        expect(reviews).toBeGreaterThanOrEqual(prevReviews);
        // 5. difficulté écrite une seule fois
        if (prevDifficulty) expect(s.difficulty).toEqual(prevDifficulty);
        // 6. terminaux
        if (before.stage === "DONE" || before.stage === "ABORTED") expect(s).toBe(before);
        // 7. DISTILL inatteignable avec un ADR proposé
        if (s.phase === "DISTILL" || s.phase === "DELIVER") expect(s.adrs.some((a) => a.status === "Proposed")).toBe(false);
        // 2. la phase courante est la première non terminée et non sautée
        if (s.phase && s.stage !== "DONE") {
          const expected = s.phaseOrder.find((p) => !s.phasesCompleted.includes(p) && !s.skipPhases.includes(p));
          if (!s.skipPhases.includes(s.phase)) expect(s.phase).toBe(expected);
        }
        // 1. on ne quitte une phase qu'après APPROVED (ou GATE_OK sans reviewer)
        for (const p of s.phasesCompleted.slice(prevCompleted.length)) {
          if (p === "RESEARCH") expect(s.artifacts.RESEARCH.length).toBeGreaterThanOrEqual(0);
          else expect(s.reviews[p].at(-1)?.verdict).toBe("APPROVED");
        }
        prevCompleted = [...s.phasesCompleted];
        prevArtifacts = artifacts;
        prevReviews = reviews;
        prevDifficulty = s.difficulty;
        // 8. l'état reste valide (seul le moteur l'écrit, jamais un agent)
        expect(validateState(s)).toEqual({ ok: true });
      }
    }
  });

  it("le réducteur est pur : l'état d'entrée n'est jamais modifié", () => {
    const before = play([...toFirstPhase(), CP("RESEARCH"), REPORTED]).state;
    const frozen = structuredClone(before);
    transition(before, GATE_FAIL);
    transition(before, GATE_OK);
    expect(before).toEqual(frozen);
  });

  it("état corrompu refusé par le validateur", () => {
    expect(validateState({ schemaVersion: 1, stage: "DISCOVER" })).toMatchObject({ ok: false, reason: expect.stringMatching(/état corrompu/) });
  });
});

/**
 * Un tour interrompu n'est pas un travail jugé mauvais (ADR 0029).
 *
 * Le 28/09, le tour de `skraft-architect-model` a été coupé après 1 h 55, et le réducteur a traité
 * ce `TIMEOUT` par le **même chemin** qu'un refus de porte : `rollback` au checkpoint de phase.
 * Tout ce que l'architecte avait écrit a donc été effacé, alors qu'aucune porte ne l'avait examiné.
 *
 * Une porte qui refuse a JUGÉ le travail ; un délai dépassé n'a RIEN jugé. La sécurité ne repose
 * pas sur ce rollback — la porte de fin de phase juge l'état final, quel que soit le nombre de
 * tours qu'il a fallu pour l'atteindre.
 */
describe("Réducteur skraft — interruption et verdict ne mènent pas au même effet", () => {
  it("TIMEOUT : relance sans rollback — le travail du tour reste sur le disque", () => {
    const { state, effects } = play([...toFirstPhase(), CP("RESEARCH"), TIMEOUT("silence")]);
    expect(state).toMatchObject({ stage: "SPECIALIST", attempts: 1 });
    expect(effects.map((f) => f.kind)).toEqual(["runSpecialist"]);
  });

  /**
   * ADR 0040 : le rejet de porte a rejoint l'interruption, pour une autre raison. Depuis l'ADR 0039
   * l'agent garde sa session : sa conversation contient les appels d'outils qui ont créé ses
   * fichiers. Les effacer sous lui, c'est lui demander de corriger ce qui n'existe plus.
   */
  it("GATE_FAIL : n'annule plus rien non plus — l'agent garde sa session ET ses fichiers", () => {
    const { effects } = play([...toFirstPhase(), CP("RESEARCH"), REPORTED, GATE_FAIL]);
    expect(effects.map((f) => f.kind)).toEqual(["runSpecialist"]);
  });

  it("le tour suivant est prévenu que le précédent a été interrompu, pas refusé", () => {
    // Sans cette phrase, l'agent relit des fichiers à moitié écrits en les croyant finis.
    const { effects } = play([...toFirstPhase(), CP("RESEARCH"), TIMEOUT("plafond atteint")]);
    const relance = effects.find((f) => f.kind === "runSpecialist") as unknown as { feedback: string[] };
    const texte = relance.feedback.join(" ");
    expect(texte).toContain("plafond atteint");
    expect(texte).toMatch(/interrompu/i);
    expect(texte).toMatch(/disque|déjà écrit/i);
  });

  it("le budget d'essais est consommé quand même : une interruption ne se rejoue pas sans fin", () => {
    const { state } = play([...toFirstPhase(), CP("RESEARCH"), TIMEOUT("a"), TIMEOUT("b")]);
    expect(state.attempts).toBe(2);
  });

  it("budget épuisé : escalade, et là le rollback revient — l'humain reprend un dépôt propre", () => {
    const { state, effects } = play([...toFirstPhase(), CP("RESEARCH"), TIMEOUT("a"), TIMEOUT("b"), TIMEOUT("c")]);
    expect(state.stage).toBe("ESCALATED");
    expect(effects[0]).toEqual({ kind: "rollback", to: "cp-RESEARCH" });
  });
});

/**
 * La première revue d'une phase a droit à un essai (ADR 0042).
 *
 * Run du 29/09, DISTILL relancée depuis une base où RESEARCH et DESIGN étaient déjà produites :
 *
 *   essai 1  porte valeurs  rejet — « 10 articles ou plus : 5 % » absent du scénario @ac-1
 *   essai 2  porte valeurs  rejet — même famille
 *   essai 3  portes valeurs et RED franchies, puis la revue rend DEUX DÉFAUTS MAJEURS :
 *            `Facture.ATPayer` ignore `Remise`, alors que le contrat de conception ratifié exige
 *            `SommeDesArticles - Remise + FraisDePort`.
 *
 * Précis, corrigeables — et partis en escalade, budget épuisé, sans qu'un seul tour ait pu y
 * répondre. Le budget est commun aux portes de forme et à la revue, alors que recopier une valeur
 * dans un Gherkin et rebrancher un calcul de facture ne sont pas le même travail.
 */
describe("Réducteur skraft — la revue n'hérite pas d'un budget vidé par les portes de forme", () => {
  const CHANGES = LENSES(lens("CHANGES_REQUESTED", ["major"]));
  // DISTILL, la phase du run : deux rejets de la porte des valeurs, puis la porte passe.
  const jusquADistill = [...toFirstPhase(), ...researchPhase, ...designPhase, CP("DISTILL")];
  // Deux rejets différents : deux identiques déclencheraient le disjoncteur (ADR 0073).
  const épuiser = [...jusquADistill, REPORTED, GATE_FAIL, REPORTED, { ...GATE_FAIL, reasons: ["valeur absente du Gherkin"] } as Ev];

  it("budget à zéro, première revue défavorable : un essai est accordé, pas une escalade", () => {
    const { state, effects } = play([...épuiser, REPORTED, GATE_OK, CHANGES]);
    expect(state.attempts).toBe(3); // le budget EST épuisé…
    expect(state.stage).toBe("SPECIALIST"); // …et pourtant la phase repart
    expect(kinds(effects)).toEqual(["runSpecialist"]);
    const relance = effects.find((f) => f.kind === "runSpecialist") as unknown as { feedback: string[] };
    expect(relance.feedback.join(" ")).toContain("défaut major");
  });

  it("la DEUXIÈME revue défavorable escalade : l'essai est garanti une fois, pas indéfiniment", () => {
    const { state, effects } = play([...épuiser, REPORTED, GATE_OK, CHANGES, REPORTED, GATE_OK, CHANGES]);
    expect(state.stage).toBe("ESCALATED");
    expect(effects[0]).toEqual({ kind: "rollback", to: "cp-DISTILL" });
  });

  it("la garantie ne vaut que pour la revue : une porte de forme escalade comme avant", () => {
    const { state } = play([...épuiser, REPORTED, GATE_FAIL]);
    expect(state.stage).toBe("ESCALATED");
  });

  it("un verdict REJECTED escalade toujours, budget ou non : ce n'est pas une demande de changement", () => {
    const { state } = play([...jusquADistill, REPORTED, GATE_OK, LENSES(lens("REJECTED"), { lens: "architecture", verdict: "REJECTED", defects: [] })]);
    expect(state.stage).toBe("ESCALATED");
  });

  it("un verdict REJECTED est tracé comme un rejet de la porte « revue », avec les lentilles qui rejettent (D11)", () => {
    const avant = play([...jusquADistill, REPORTED, GATE_OK]).state.rejections ?? 0;
    const { state } = play([...jusquADistill, REPORTED, GATE_OK, LENSES(lens("REJECTED", ["blocker"]), { lens: "architecture", verdict: "REJECTED", defects: [] })]);
    expect(state.rejections).toBe(avant + 1);
    expect(state.lastRejection).toEqual({ gate: "revue", reasons: ["cold-reader : REJECTED — défaut blocker", "architecture : REJECTED"] });
    expect(state.escalation?.reason).toBe("Revue : verdict REJECTED (cold-reader : REJECTED — défaut blocker ; architecture : REJECTED)");
  });
});

/**
 * ADR 0046 — fils de défauts : routage, réponses des agents, arbitrage des lentilles, et l'humain
 * en dernier recours. Run réel US-2 du 03/10 : la revue réclamait deux fois des tests que le
 * testeur jugeait redondants et qu'une correction ne pouvait pas écrire.
 */
describe("Réducteur skraft — fils de défauts de revue (ADR 0046)", () => {
  const distill = [...toFirstPhase(), ...researchPhase, ...designPhase, CP("DISTILL"), REPORTED, GATE_OK];
  const archi = (description: string, rulings: LensVerdict["rulings"] = []): LensVerdict => ({ lens: "architecture", verdict: "CHANGES_REQUESTED", defects: [{ severity: "major", description, target: "deliverable" }], rulings });
  const respond = (responses: { defect: string; status: "fixed" | "contested"; reason?: string }[]): Ev => ({ type: "AGENT_REPORTED", role: "skraft-acceptance", summary: "s", files: [], responses });
  const feedbackOf = (effects: SkraftEffect[]) => (effects.find((x) => x.kind === "runSpecialist") as { feedback: string[] } | undefined)?.feedback.join("\n") ?? "";

  it("après un rejet de revue, le retour conserve les demandes des rejets précédents, en rappel", () => {
    const r = play([...distill, LENSES(archi("calcul pur modélisé en événement")), respond([{ defect: "architecture#1.1", status: "fixed" }]), GATE_OK,
      LENSES({ lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [{ severity: "major", description: "la grille n'a pas de source", target: "deliverable" }] })]);
    const fb = feedbackOf(r.effects);
    expect(fb).toMatch(/\[cold-reader#2\.1, major, deliverable\] la grille n'a pas de source/);
    expect(fb).toMatch(/Rappel.*\[architecture#1\.1\] calcul pur modélisé en événement/s);
  });

  it("une contestation acceptée par la lentille fait tomber le défaut : la phase est approuvée", () => {
    const r = play([...distill, LENSES(archi("modèle trop riche")), respond([{ defect: "architecture#1.1", status: "contested", reason: "imposé par l'ADR-002" }]), GATE_OK,
      LENSES({ lens: "architecture", verdict: "APPROVED", defects: [], rulings: [{ defect: "architecture#1.1", decision: "accepted", reason: "en effet" }] })]);
    expect(kinds(r.effects)).toEqual(["commitPhase"]);
    expect(r.state.reviewThreads?.[0]).toMatchObject({ status: "accepted", ruling: "en effet" });
  });

  it("maintenu une fois : à corriger ; contesté encore puis maintenu : l'humain arbitre, et sa décision s'applique", () => {
    const maintained = { lens: "architecture", verdict: "CHANGES_REQUESTED" as const, defects: [], rulings: [{ defect: "architecture#1.1", decision: "maintained" as const, reason: "non" }] };
    const round2 = play([...distill, LENSES(archi("modèle trop riche")), respond([{ defect: "architecture#1.1", status: "contested", reason: "x" }]), GATE_OK, LENSES(maintained)]);
    expect(feedbackOf(round2.effects)).toMatch(/maintenu par la lentille après ta contestation \(non\) : à corriger/);

    const round3 = play([...distill, LENSES(archi("modèle trop riche")), respond([{ defect: "architecture#1.1", status: "contested", reason: "x" }]), GATE_OK, LENSES(maintained),
      respond([{ defect: "architecture#1.1", status: "contested", reason: "toujours x" }]), GATE_OK, LENSES(maintained)]);
    expect(round3.state.stage).toBe("ARBITRATION");
    expect(round3.effects).toEqual([{ kind: "askArbitration", thread: expect.objectContaining({ id: "architecture#1.1", contestation: "toujours x" }) }]);

    const agent = transition(round3.state, DECIDE("accept:architecture#1.1"));
    expect(kinds(agent.effects)).toEqual(["commitPhase"]);
    const lentille = transition(round3.state, DECIDE("maintain:architecture#1.1"));
    expect(lentille.state.stage).toBe("SPECIALIST");
    expect(feedbackOf(lentille.effects)).toMatch(/tranché par l'humain en faveur de la lentille/);
  });

  describe("DELIVER : chaque défaut va à l'agent qu'il concerne", () => {
    const passedAll = ["U > old", "U > t1", "A > ac-1", "A > ac-2", "A > ac-3"];
    const delivered = [
      ...toDeliver(), PLANNED, STARTED, REP_TEST, RED_OK(1), REP_DEV, GREEN_OK(true, 1, passedAll), { type: "SCENARIO_OK", notes: [] } as Ev,
      { type: "SCENARIO_STARTED", checkpointId: "cp-s2" } as Ev, { type: "SCENARIO_OK", notes: [] } as Ev, GATE_OK,
    ];
    const review = LENSES({ lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [
      { severity: "major", description: "grille vide non testée", target: "test", file: "Tests/GrilleTests.swift" },
      { severity: "major", description: "taux négatif accepté", target: "code" },
    ] });

    it("les défauts de test d'abord, à l'agent des tests, qui ne reçoit qu'eux", () => {
      const r = play([...delivered, review]);
      const run = r.effects.find((x) => x.kind === "runDeliverAgent") as { step: string; feedback: string[] };
      expect(run.step).toBe("fix-test");
      expect(run.feedback.join("\n")).toMatch(/grille vide non testée/);
      expect(run.feedback.join("\n")).not.toMatch(/taux négatif/);
    });

    it("correction côté tests : vérifiée par le code, puis le développeur fait passer les tests rouges et traite ses défauts", () => {
      const verify = play([...delivered, review, { ...REP_TEST, responses: [{ defect: "cold-reader#1.1", status: "fixed" }] } as Ev]);
      // Le défaut cite un fichier de test : le testeur peut le renforcer (D10 de docs/12).
      expect(verify.effects).toEqual([{ kind: "verifyFixTests", scenarioId: "ac-2", since: "cp-s2", baseline: expect.any(Object), editable: ["Tests/GrilleTests.swift"] }]);
      // La réponse attend la validation du pas : un pas refusé est annulé, ses « corrigé » avec lui.
      expect(verify.state.reviewThreads?.find((t) => t.id === "cold-reader#1.1")?.status).toBe("open");

      const fixTestOk: Ev = { type: "STEP_OK", checkpointId: "cp-ft", all: [], passed: passedAll, unitTestsHash: "h9", fixTargets: ["U > t9"] };
      const dev = transition(verify.state, fixTestOk);
      expect(dev.state.reviewThreads?.find((t) => t.id === "cold-reader#1.1")?.status).toBe("fixed");
      const run = dev.effects.find((x) => x.kind === "runDeliverAgent") as { step: string; feedback: string[] };
      expect(run.step).toBe("fix");
      expect(run.feedback.join("\n")).toMatch(/taux négatif accepté/);
      expect(run.feedback.join("\n")).toMatch(/Tests ajoutés par la correction côté tests, rouges : fais-les passer\. U > t9/);

      const green = transition(dev.state, REP_DEV);
      expect(green.effects).toEqual([expect.objectContaining({ kind: "verifyUnitGreen", mode: "fix", targets: ["U > t9"], unitTestsHash: "h9" })]);
      const gate = transition(green.state, { type: "STEP_OK", checkpointId: "cp-fix", all: [], passed: passedAll, acceptanceGreen: true });
      expect(gate.effects).toEqual([expect.objectContaining({ kind: "scenarioGate", unitTests: ["U > t9"] })]);
    });

    it("défaut renvoyé « hors de mon périmètre » par le développeur : il repart au testeur après la correction du code", () => {
      const onlyCode = LENSES({ lens: "quality-gates", verdict: "CHANGES_REQUESTED", defects: [{ severity: "major", description: "aucun test ne couvre ATPayer", target: "code" }] });
      const fix = play([...delivered, onlyCode]);
      expect((fix.effects.find((x) => x.kind === "runDeliverAgent") as { step: string }).step).toBe("fix");
      const reported = transition(fix.state, { ...REP_DEV, responses: [{ defect: "quality-gates#1.1", status: "outOfScope", reason: "il faut un test" }] } as Ev);
      const next = transition(reported.state, { type: "STEP_OK", checkpointId: "cp-fix", all: [], passed: passedAll, acceptanceGreen: true });
      expect(next.state.reviewThreads?.[0]).toMatchObject({ target: "test", status: "open", rerouted: true });
      const run = next.effects.find((x) => x.kind === "runDeliverAgent") as { step: string; feedback: string[] };
      expect(run.step).toBe("fix-test");
      expect(run.feedback.join("\n")).toMatch(/aucun test ne couvre ATPayer/);
    });

    it("D7 (docs/12) : chaque défaut contesté ou renvoyé, sans test rouge à faire passer : le pas peut ne rien modifier", () => {
      const onlyCode = LENSES({ lens: "quality-gates", verdict: "CHANGES_REQUESTED", defects: [{ severity: "major", description: "nom vague", target: "code" }] });
      const fix = play([...delivered, onlyCode]);
      const conteste = transition(fix.state, { ...REP_DEV, responses: [{ defect: "quality-gates#1.1", status: "contested", reason: "le contrat l'impose" }] } as Ev);
      expect(conteste.effects).toEqual([expect.objectContaining({ kind: "verifyUnitGreen", mode: "fix", nothingToChange: true })]);
      const corrige = transition(fix.state, { ...REP_DEV, responses: [{ defect: "quality-gates#1.1", status: "fixed" }] } as Ev);
      expect(corrige.effects[0]).not.toHaveProperty("nothingToChange");
      const muet = transition(fix.state, REP_DEV);
      expect(muet.effects[0]).not.toHaveProperty("nothingToChange");
    });

    it("D12, D23 (docs/12) : une correction en échec reprend avec l'empreinte et la référence de son entrée, pas celles de l'essai effacé", () => {
      const entree = play([...delivered, review]).state.deliver!;
      const fixTestOk: Ev = { type: "STEP_OK", checkpointId: "cp-ft", all: [...passedAll, "U > t9"], passed: passedAll, unitTestsHash: "h9", fixTargets: ["U > t9"] };
      const echec = play([...delivered, review, REP_TEST, fixTestOk, REP_DEV, FAIL("a"), REP_DEV, FAIL("b"), REP_DEV, FAIL("c")]);
      const d = echec.state.deliver!;
      expect(d.step).toBe("fix-test");
      expect(d.unitTestsHash).toBe(entree.unitTestsHash);
      expect(d.baseline).toEqual(entree.baseline);
    });

    it("la référence du contrat relevée à la revue accompagne la correction du développeur", () => {
      const review = { ...(LENSES({ lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [{ severity: "major", description: "taux négatif", target: "code" }] }) as object), contractSymbols: ["Soustrait", "ATPayer"] } as Ev;
      const fix = play([...delivered, review]);
      const green = transition(fix.state, REP_DEV);
      expect(green.effects).toEqual([expect.objectContaining({ kind: "verifyUnitGreen", mode: "fix", contractSymbols: ["Soustrait", "ATPayer"] })]);
    });

    it("aucun agent ne répond aux défauts : la correction se termine quand même, sans rebondir (revue de code du 03/10)", () => {
      const r = play([...delivered, review, REP_TEST, { type: "STEP_OK", checkpointId: "cp-ft", all: [], passed: passedAll, unitTestsHash: "h1", fixTargets: [] } as Ev]);
      expect((r.effects.find((x) => x.kind === "runDeliverAgent") as { step: string }).step).toBe("fix");
      const fin = play([...delivered, review, REP_TEST, { type: "STEP_OK", checkpointId: "cp-ft", all: [], passed: passedAll, unitTestsHash: "h1", fixTargets: [] } as Ev,
        REP_DEV, { type: "STEP_OK", checkpointId: "cp-fix", all: [], passed: passedAll, acceptanceGreen: true } as Ev]);
      expect(kinds(fin.effects)).toEqual(["scenarioGate"]);
    });

    it("porte de fin de scénario refusée pendant la correction : les fils reviennent à leur état d'avant, comme le code", () => {
      // Le rollback annule le code du développeur ; ses « corrigé » de l'essai annulé ne doivent pas
      // survivre, sinon la reprise le saute et revérifie un code jamais corrigé.
      const ok = (cp: string, extra = {}) => ({ type: "STEP_OK", checkpointId: cp, all: [], passed: passedAll, ...extra }) as Ev;
      const r = play([...delivered, review,
        { ...REP_TEST, responses: [{ defect: "cold-reader#1.1", status: "fixed" }] } as Ev, ok("cp-ft", { unitTestsHash: "h1", fixTargets: [] }),
        { ...REP_DEV, responses: [{ defect: "cold-reader#1.2", status: "fixed" }] } as Ev, ok("cp-fix", { acceptanceGreen: true }),
        { type: "SCENARIO_FAIL", reasons: ["Mutation : 80 %"] }]);
      const run = r.effects.find((x) => x.kind === "runDeliverAgent") as { step: string; feedback: string[] };
      expect(run.step).toBe("fix-test");
      expect(r.state.reviewThreads?.map((t) => t.status)).toEqual(["open", "open"]);
      // Après la reprise côté tests, le développeur doit repasser : son défaut est de nouveau actif.
      const apresTest = transition(transition(r.state, REP_TEST).state, ok("cp-ft2", { unitTestsHash: "h1", fixTargets: [] }));
      expect((apresTest.effects.find((x) => x.kind === "runDeliverAgent") as { step: string }).step).toBe("fix");
    });

    it("reprise après la porte de fin de scénario : le premier pas dépend des défauts actifs, pas des lignes de rappel", () => {
      const ok = (cp: string, extra = {}) => ({ type: "STEP_OK", checkpointId: cp, all: [], passed: passedAll, ...extra }) as Ev;
      const onlyTest = LENSES({ lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [{ severity: "major", description: "grille vide non testée", target: "test" }] });
      const onlyCode = LENSES({ lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [{ severity: "major", description: "taux négatif accepté", target: "code" }] });
      // Revue 1 : un défaut de test, corrigé ; revue 2 : un défaut de code seulement. Le défaut de test
      // corrigé reste en rappel dans le retour du testeur — il ne doit pas le faire relancer.
      const r = play([...delivered, onlyTest, { ...REP_TEST, responses: [{ defect: "cold-reader#1.1", status: "fixed" }] } as Ev, ok("cp-ft", { unitTestsHash: "h1", fixTargets: [] }),
        { type: "SCENARIO_OK", notes: [] } as Ev, GATE_OK, onlyCode, { type: "SCENARIO_FAIL", reasons: ["Mutation : 80 %"] } as Ev]);
      expect((r.effects.find((x) => x.kind === "runDeliverAgent") as { step: string }).step).toBe("fix");
    });

    it("mutant survivant en fin de DELIVER : défaut adressé au testeur, sans relancer la phase (ADR 0049)", () => {
      const allDone = [
        ...toDeliver(), PLANNED, STARTED, REP_TEST, RED_OK(1), REP_DEV, GREEN_OK(true, 1, passedAll), { type: "SCENARIO_OK", notes: [] } as Ev,
        { type: "SCENARIO_STARTED", checkpointId: "cp-s2" } as Ev, { type: "SCENARIO_OK", notes: [] } as Ev,
      ];
      const r = play([...allDone, { type: "GATE_FAIL", gate: "mutation", reasons: ["Mutation : src/Montant.cs à 80 % (minimum 100 %) ; mutants survivants : ligne 25 (ArithmeticOperatorReplacement)."] }]);
      const run = r.effects.find((x) => x.kind === "runDeliverAgent") as { step: string; feedback: string[] };
      expect(run.step).toBe("fix-test");
      expect(run.feedback.join("\n")).toMatch(/\[mutation#1\.1, major, test\].*ligne 25.*tue ce mutant/s);
      expect(kinds(r.effects)).not.toContain("planDeliver");
    });

    // D5 (docs/12) : tous les scénarios sont verts, rejouer la phase ne ferait travailler personne.
    const toutLivre = () => [
      ...toDeliver(), PLANNED, STARTED, REP_TEST, RED_OK(1), REP_DEV, GREEN_OK(true, 1, passedAll), { type: "SCENARIO_OK", notes: [] } as Ev,
      { type: "SCENARIO_STARTED", checkpointId: "cp-s2" } as Ev, { type: "SCENARIO_OK", notes: [] } as Ev,
    ];

    describe("ADR 0065 : mutant contesté comme équivalent, arbitré puis tracé", () => {
      const M = { file: "src/Montant.cs", line: 25, operator: "EqualityOperator", replacement: "a >= b" };
      const echec = (mutants = [M]): Ev => ({ type: "GATE_FAIL", gate: "mutation", reasons: ["Mutation : src/Montant.cs à 75 %."], mutants });
      const conteste = (ids: string[]): Ev => ({ ...REP_TEST, responses: ids.map((defect) => ({ defect, status: "contested", reason: "équivalent" })) } as Ev);
      const fixTestOk: Ev = { type: "STEP_OK", checkpointId: "cp-ft", all: [], passed: passedAll, unitTestsHash: "h1", fixTargets: [] };
      const juge = (decision: "accepted" | "maintained", ids = ["mutation#1.1"]): Ev => ({ type: "MUTANTS_JUDGED", rulings: ids.map((defect) => ({ defect, decision, reason: "r" })) });

      it("un défaut par mutant, qui garde le mutant exact", () => {
        const r = play([...toutLivre(), echec()]);
        expect(r.state.reviewThreads).toEqual([expect.objectContaining({ id: "mutation#1.1", mutant: M, target: "test" })]);
      });

      it("contesté : l'arbitre est appelé ; équivalent : dérogation tracée, la correction reprend", () => {
        const arb = play([...toutLivre(), echec(), conteste(["mutation#1.1"]), fixTestOk]);
        expect(arb.state.stage).toBe("ARBITRATION");
        expect(arb.effects).toEqual([{ kind: "arbitrateMutants", threads: [expect.objectContaining({ id: "mutation#1.1", status: "contested" })] }]);
        const ok = transition(arb.state, juge("accepted"));
        expect(ok.state.derogations).toEqual([expect.objectContaining({ file: M.file, line: 25, operator: M.operator, par: "agent" })]);
        expect(ok.state.arbitrages).toEqual([expect.objectContaining({ décision: "dérogation", par: "agent", élément: "src/Montant.cs:25 (EqualityOperator)" })]);
        expect(kinds(ok.effects)).toEqual(["scenarioGate"]);
      });

      it("non équivalent : l'humain tranche ; « corriger » renvoie le testeur, sans recours", () => {
        const arb = play([...toutLivre(), echec(), conteste(["mutation#1.1"]), fixTestOk, juge("maintained")]);
        expect(arb.effects).toEqual([{ kind: "askMutationArbitration", thread: expect.objectContaining({ id: "mutation#1.1" }), avis: expect.stringMatching(/non équivalent/) }]);
        const corr = transition(arb.state, DECIDE("corriger:mutation#1.1", "un test le tue"));
        expect(corr.state.arbitrages!.map((a) => [a.par, a.décision])).toEqual([["agent", "à corriger"], ["humain", "à corriger"]]);
        const run = corr.effects.find((x) => x.kind === "runDeliverAgent") as { step: string; feedback: string[] };
        expect(run.step).toBe("fix-test");
        expect(run.feedback.join("\n")).toMatch(/tranché par l'humain/);
      });

      it("plafond : au-delà de deux dérogations de l'arbitre, l'humain tranche", () => {
        const trois = [M, { ...M, line: 26 }, { ...M, line: 27 }];
        const ids = ["mutation#1.1", "mutation#1.2", "mutation#1.3"];
        const r = play([...toutLivre(), echec(trois), conteste(ids), fixTestOk, juge("accepted", ids)]);
        expect(r.state.derogations).toHaveLength(2);
        expect(r.effects).toEqual([{ kind: "askMutationArbitration", thread: expect.objectContaining({ id: "mutation#1.3" }), avis: expect.stringMatching(/plafond/) }]);
        const fin = transition(r.state, DECIDE("derogation:mutation#1.3", "équivalent aussi"));
        expect(fin.state.derogations!.map((x) => x.par)).toEqual(["agent", "agent", "humain"]);
      });
    });

    it("couverture du diff insuffisante en fin de DELIVER : défaut adressé au testeur, sans relancer la phase (D5)", () => {
      const motif = "Couverture du diff : src/Panier.cs à 62 % (minimum 80 %). Lignes non couvertes : 14.";
      const r = play([...toutLivre(), { type: "GATE_FAIL", gate: "couverture du diff", reasons: [motif] }]);
      const run = r.effects.find((x) => x.kind === "runDeliverAgent") as { step: string; feedback: string[] };
      expect(run.step).toBe("fix-test");
      expect(run.feedback.join("\n")).toMatch(/\[couverture#1\.1, major, test\].*Lignes non couvertes : 14\..*test qui exerce/s);
      expect(kinds(r.effects)).not.toContain("planDeliver");
      expect(r.state.attempts).toBe(1);
    });

    it("suite finale en échec en fin de DELIVER : défaut adressé au développeur, sans relancer la phase (D5)", () => {
      const r = play([...toutLivre(), { type: "GATE_FAIL", gate: "suite finale", reasons: ["Tests en échec : tests/PanierTests.cs > Total."] }]);
      const run = r.effects.find((x) => x.kind === "runDeliverAgent") as { step: string; feedback: string[] };
      expect(run.step).toBe("fix");
      expect(run.feedback.join("\n")).toMatch(/\[suite finale#1\.1, major, code\].*PanierTests\.cs > Total.*ne modifie pas ce test/s);
      expect(kinds(r.effects)).not.toContain("planDeliver");
    });

    it("couverture insuffisante, budget épuisé : escalade, pas de correction de plus", () => {
      const motif = "Couverture du diff : src/Panier.cs à 62 % (minimum 80 %). Lignes non couvertes : 14.";
      const epuise = { ...play(toutLivre()).state, attempts: 2 };
      const r = transition(epuise, { type: "GATE_FAIL", gate: "couverture du diff", reasons: [motif] });
      expect(r.state.stage).toBe("ESCALATED");
    });

    it("aucun livrable en fin de DELIVER : personne à qui l'adresser, escalade sans consommer d'essai", () => {
      const r = play([...toutLivre(), { type: "GATE_FAIL", gate: "livrables", reasons: ["Aucun livrable produit pendant la phase DELIVER."] }]);
      expect(r.state.stage).toBe("ESCALATED");
      expect(r.state.attempts).toBe(0);
      expect(kinds(r.effects)).toContain("askEscalation");
    });

    it("mutation réussie en fin de DELIVER : ses faits vont aux lentilles", () => {
      const r = play([...delivered.slice(0, -1), { ...GATE_OK, facts: ["Mutation (fin de DELIVER) : src/Montant.cs à 100 %, 0 mutant(s) survivant(s)."] } as Ev]);
      expect(r.state.deliver?.facts).toContain("Mutation (fin de DELIVER) : src/Montant.cs à 100 %, 0 mutant(s) survivant(s).");
    });

    it("tout contesté côté tests, rien côté code : directement la porte de fin de scénario, puis la revue", () => {
      const onlyTest = LENSES({ lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [{ severity: "major", description: "grille vide non testée", target: "test" }] });
      const r = play([...delivered, onlyTest, { ...REP_TEST, responses: [{ defect: "cold-reader#1.1", status: "contested", reason: "couvert par ac-5" }] } as Ev,
        { type: "STEP_OK", checkpointId: "cp-ft", all: [], passed: passedAll, unitTestsHash: "h1", fixTargets: [] } as Ev]);
      expect(kinds(r.effects)).toEqual(["scenarioGate"]);
      expect(r.state.reviewThreads?.[0]).toMatchObject({ status: "contested", contestation: "couvert par ac-5" });
    });
  });
});

/**
 * Rembobiner sans faire oublier, c'est garder le souvenir et retirer la chose (ADR 0050).
 *
 * L'ADR 0040 a levé cette incohérence pour le RÉESSAI, en cessant d'annuler. Elle restait entière
 * sur le chemin d'ESCALADE, où l'ADR 0029 (point 3) veut au contraire que le dépôt redevienne
 * propre pour l'humain : le rollback partait, la conversation des agents restait. À la relance,
 * l'architecte revenait avec, dans sa mémoire, les appels d'outils qui avaient créé
 * `contracts.md`, `event-model.md`, `domain-model.md` — et un disque qui ne les contenait plus.
 *
 * Jamais observé dans un run, pour une mauvaise raison : le banc répondait « po » à une escalade
 * qui exige développeur ou architecte, la réponse était refusée en silence, et la relance n'avait
 * jamais lieu.
 */
describe("Réducteur skraft — le dépôt et la mémoire reviennent au même point", () => {
  const oubli = (roles: string[]) => ({ kind: "forgetSessions", roles });
  const paire = (e: SkraftEffect[]) => e.filter((x) => x.kind === "rollback" || x.kind === "forgetSessions").map((x) => x.kind);

  it("budget épuisé : le rollback est immédiatement suivi de l'oubli", () => {
    const fail = (n: string) => [REPORTED, { ...GATE_FAIL, reasons: [n] } as Ev];
    const { effects } = play([...toFirstPhase(), CP("RESEARCH"), ...fail("a"), ...fail("b"), ...fail("c")]);
    expect(paire(effects)).toEqual(["rollback", "forgetSessions"]);
    expect(effects).toContainEqual(oubli(["skraft-researcher"]));
  });

  it("panne d'environnement : même paire", () => {
    const { effects } = play([...toFirstPhase(), CP("RESEARCH"), { type: "ENV_FAILURE", reason: "quota épuisé" }]);
    expect(paire(effects)).toEqual(["rollback", "forgetSessions"]);
  });

  it("phase sautée : même paire — le travail écarté ne doit pas survivre en mémoire", () => {
    const fail = [REPORTED, GATE_FAIL];
    const escalade = [...toFirstPhase(), CP("RESEARCH"), ...fail, ...fail, ...fail];
    expect(paire(play([...escalade, DECIDE("skip")]).effects)).toEqual(["rollback", "forgetSessions"]);
  });

  it("DESIGN a DEUX rôles : les deux sont oubliés, pas seulement celui du tour en cours", () => {
    // L'architecte modélise puis décide. Escalader en n'oubliant que le second laisserait au
    // premier la mémoire de fichiers effacés.
    const fail = (n: string) => [REPORTED, REPORTED, { ...GATE_FAIL, reasons: [n] } as Ev];
    const { effects } = play([...toFirstPhase(), ...researchPhase, ANSWER, CP("DESIGN"), ...fail("a"), ...fail("b"), ...fail("c")]);
    expect(effects).toContainEqual(oubli(["skraft-architect-model", "skraft-architect-decide"]));
  });

  it("un REESSAI, lui, n'oublie rien : rien n'a été rembobiné (ADR 0040)", () => {
    const { effects } = play([...toFirstPhase(), CP("RESEARCH"), REPORTED, GATE_FAIL]);
    expect(paire(effects)).toEqual([]);
  });
});
