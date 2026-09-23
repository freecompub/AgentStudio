import { describe, expect, it } from "vitest";
import { PHASE_ORDER } from "../src/config.js";
import type { SkraftEffect, SkraftState } from "../src/model.js";
import { validateState } from "../src/model.js";
import { initialEffects, initialState, transition, type Ev } from "../src/reducer.js";
import type { LensVerdict } from "../src/review.js";
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
const lens = (verdict: LensVerdict["verdict"], severities: ("blocker" | "major" | "minor")[] = []): LensVerdict => ({
  lens: "cold-reader",
  verdict,
  defects: severities.map((severity) => ({ severity, description: `défaut ${severity}`, file: "Sources/A.swift", line: 3 })),
});
const LENSES = (...l: LensVerdict[]): Ev => ({ type: "LENSES_DONE", lenses: l, reportPath: ".skraft/us-12/reviews/x.md" });

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
    expect(effects).toEqual([{ kind: "askEscalation", reason: "Story invalide : aucun critère", options: ["retry", "abort"] }]);
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

  it("GATE_OK avec reviewer → REVIEW avec les lentilles du niveau", () => {
    const { state, effects } = play([...toFirstPhase(), ...researchPhase, ANSWER, CP("DESIGN"), REPORTED, REPORTED, GATE_OK]);
    expect(state.stage).toBe("REVIEW");
    expect(effects).toEqual([{ kind: "runReview", phase: "DESIGN", lenses: ["cold-reader", "test-integrity", "architecture"], attempt: 1 }]);
  });

  it("GATE_FAIL avec budget → rollback au checkpoint de phase, relance ciblée avec les motifs", () => {
    const { state, effects } = play([...toFirstPhase(), CP("RESEARCH"), REPORTED, GATE_FAIL]);
    expect(state).toMatchObject({ stage: "SPECIALIST", attempts: 1, lastRejection: { gate: "citations", reasons: ["fichier de 55 lignes"] } });
    expect(effects).toEqual([
      { kind: "rollback", to: "cp-RESEARCH" },
      { kind: "runSpecialist", phase: "RESEARCH", role: "skraft-researcher", attempt: 2, feedback: ["fichier de 55 lignes"] },
    ]);
  });

  it("GATE_FAIL, budget épuisé → ESCALATED", () => {
    const fail = [REPORTED, GATE_FAIL];
    const { state, effects } = play([...toFirstPhase(), CP("RESEARCH"), ...fail, ...fail, ...fail]);
    expect(state.stage).toBe("ESCALATED");
    expect(state.attempts).toBe(3);
    expect(effects).toEqual([
      { kind: "rollback", to: "cp-RESEARCH" },
      { kind: "askEscalation", reason: "citations : fichier de 55 lignes", options: ["retry", "skip", "abort"] },
    ]);
  });

  it("TIMEOUT d'un agent = GATE_FAIL", () => {
    const { state } = play([...toFirstPhase(), CP("RESEARCH"), { type: "TIMEOUT", reason: "silence" }]);
    expect(state).toMatchObject({ stage: "SPECIALIST", attempts: 1, lastRejection: { gate: "délai", reasons: ["silence"] } });
  });

  it("ENV_FAILURE → ESCALATED immédiat, sans consommer le budget", () => {
    const { state, effects } = play([...toFirstPhase(), CP("RESEARCH"), { type: "ENV_FAILURE", reason: "quota épuisé" }]);
    expect(state).toMatchObject({ stage: "ESCALATED", attempts: 0 });
    expect(effects).toEqual([
      { kind: "rollback", to: "cp-RESEARCH" },
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

  it("REVIEW : APPROVED → COMMIT ; rapport consigné", () => {
    const { state, effects } = play([...toFirstPhase(), ...researchPhase, ANSWER, CP("DESIGN"), REPORTED, REPORTED, GATE_OK, LENSES(lens("APPROVED"))]);
    expect(state.stage).toBe("COMMIT");
    expect(state.reviews.DESIGN).toEqual([{ attempt: 1, lenses: [lens("APPROVED")], verdict: "APPROVED", reportPath: ".skraft/us-12/reviews/x.md" }]);
    expect(kinds(effects)).toEqual(["commitPhase"]);
  });

  it("REVIEW : CHANGES_REQUESTED → rollback, relance avec les seuls défauts blocker et major", () => {
    const { state, effects } = play([...toFirstPhase(), ...researchPhase, ...designPhase, CP("DISTILL"), REPORTED, GATE_OK, LENSES(lens("APPROVED", ["major", "minor"]))]);
    expect(state.stage).toBe("SPECIALIST");
    expect(effects).toEqual([
      { kind: "rollback", to: "cp-DISTILL" },
      { kind: "runSpecialist", phase: "DISTILL", role: "skraft-acceptance", attempt: 2, feedback: ["[cold-reader, major] défaut major (Sources/A.swift:3)"] },
    ]);
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

  it("amend → relance de skraft-architect-decide avec la demande", () => {
    const { state, effects } = play([...toRatification, DECIDE("amend:ADR-008", "préciser le plafond journalier")]);
    expect(state.stage).toBe("SPECIALIST");
    expect(effects).toEqual([{ kind: "runSpecialist", phase: "DESIGN", role: "skraft-architect-decide", attempt: 1, feedback: ["Amendement demandé sur ADR-008 : préciser le plafond journalier"] }]);
  });

  it("ESCALATED : retry relance la phase, skip la saute avec rollback, abort termine", () => {
    const escalated = [...toFirstPhase(), CP("RESEARCH"), { type: "ENV_FAILURE", reason: "x" } as Ev];
    expect(play([...escalated, DECIDE("retry")]).effects).toEqual([{ kind: "runSpecialist", phase: "RESEARCH", role: "skraft-researcher", attempt: 1, feedback: [] }]);
    const skipped = play([...escalated, DECIDE("skip")]);
    expect(skipped.state.skipPhases).toEqual(["RESEARCH"]);
    expect(skipped.effects).toEqual([{ kind: "rollback", to: "cp-RESEARCH" }, { kind: "askQuestion", id: "q1", text: "Le plafond s'applique-t-il par prise ou par jour ?" }]);
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

describe("Réducteur skraft — sous-machine DELIVER (§7.4)", () => {
  it("début de DELIVER : plan des scénarios par le code ; les non-régressions sont déjà faites ; empreinte gelée reprise", () => {
    expect(play(toDeliver()).effects).toEqual([{ kind: "planDeliver" }]);
    const { state, effects } = play([...toDeliver(), PLANNED]);
    expect(effects).toEqual([{ kind: "startScenario", scenarioId: "ac-1" }]);
    expect(state.deliver).toMatchObject({ granularity: "turn-per-scenario", acceptanceHash: "acc", current: 0 });
    expect(state.deliver!.scenarios.map((x) => x.status)).toEqual(["in_progress", "pending", "done"]);
    expect(validateState(state)).toEqual({ ok: true });
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
    const again = (st: Ev[]) => [...st, REP_TEST, RED_OK(1), REP_DEV, GREEN_OK(true), REP_DEV, GREEN_OK(true, 2), { type: "SCENARIO_FAIL", reasons: ["Mutation : 95 %"] } as Ev];
    const esc = play(again(again([...gate, { type: "SCENARIO_FAIL", reasons: ["Mutation : 95 %"] }])));
    expect(esc.state.stage).toBe("ESCALATED");
    expect(esc.effects).toEqual([
      { kind: "rollback", to: "cp-s" },
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
    const defect = "[cold-reader, major] MaxBolus accepte une valeur négative (Sources/Domain/BolusCap.swift:2)";
    expect(fix.effects).toEqual([{ kind: "rollback", to: "cp-s2" }, { kind: "runDeliverAgent", step: "fix", scenarioId: "ac-2", attempt: 1, feedback: [defect] }]);
    expect(fix.state).toMatchObject({ stage: "SPECIALIST", attempts: 1, retries: { DELIVER: 1 } });
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

  it("panne d'environnement pendant un scénario : retour au début du scénario et escalade, sans perdre les scénarios livrés", () => {
    const base = [...toDeliver(), PLANNED, STARTED, REP_TEST, RED_OK(1), REP_DEV, GREEN_OK(true), { type: "SCENARIO_OK", notes: [] } as Ev, { type: "SCENARIO_STARTED", checkpointId: "cp-s2" } as Ev];
    const r = play([...base, REP_TEST, { type: "ENV_FAILURE", reason: "swift introuvable" }]);
    expect(r.effects).toEqual([{ kind: "rollback", to: "cp-s2" }, { kind: "askEscalation", reason: "swift introuvable", options: ["retry", "skip", "abort"] }]);
    expect(r.state.deliver!.scenarios.map((x) => x.status)).toEqual(["done", "in_progress", "done"]);
    expect(transition(r.state, DECIDE("retry")).effects).toEqual([{ kind: "runDeliverAgent", step: "test", scenarioId: "ac-2", attempt: 1, feedback: [] }]);
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
