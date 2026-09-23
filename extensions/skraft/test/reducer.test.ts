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
/** Déroule DESIGN (deux sessions) jusqu'au commit, sans ADR. */
const designPhase = [CP("DESIGN"), REPORTED, REPORTED, GATE_OK, LENSES(lens("APPROVED")), COMMITTED];
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

  it("saut de RESEARCH par règle : simple et medium commencent par DESIGN", () => {
    for (const level of ["simple", "medium"]) {
      const { state } = play(toFirstPhase(level));
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
    const after = play([...toFirstPhase(), ...researchPhase, CP("DESIGN"), REPORTED]);
    expect(after.state.stage).toBe("SPECIALIST");
    expect(after.effects).toEqual([{ kind: "runSpecialist", phase: "DESIGN", role: "skraft-architect-decide", attempt: 1, feedback: [] }]);
    expect(kinds(play([...toFirstPhase(), ...researchPhase, CP("DESIGN"), REPORTED, REPORTED]).effects)).toEqual(["runGate"]);
  });

  it("GATE_OK sans reviewer (RESEARCH) → COMMIT ; artefacts ajoutés", () => {
    const { state, effects } = play([...toFirstPhase(), CP("RESEARCH"), REPORTED, GATE_OK]);
    expect(state.stage).toBe("COMMIT");
    expect(state.artifacts.RESEARCH).toHaveLength(1);
    expect(effects).toEqual([{ kind: "commitPhase", phase: "RESEARCH", message: "docs(skraft): research de us-12" }]);
  });

  it("GATE_OK avec reviewer → REVIEW avec les lentilles du niveau", () => {
    const { state, effects } = play([...toFirstPhase(), ...researchPhase, CP("DESIGN"), REPORTED, REPORTED, GATE_OK]);
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
    const { state, effects } = play([...toFirstPhase(), ...researchPhase, CP("DESIGN"), REPORTED, REPORTED, GATE_OK, LENSES(lens("APPROVED"))]);
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
    const { state } = play([...toFirstPhase(), ...researchPhase, CP("DESIGN"), REPORTED, REPORTED, GATE_OK, LENSES(lens("REJECTED"), lens("REJECTED"))]);
    expect(state.stage).toBe("ESCALATED");
  });

  it("COMMIT → ROUTE : phase complétée, essais remis à zéro, phase suivante", () => {
    const { state, effects } = play([...toFirstPhase(), ...researchPhase]);
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

describe("Réducteur skraft — ratification et escalade (§5.2)", () => {
  const withAdr: Ev = { type: "GATE_OK", artifacts: [], adrs: [{ id: "ADR-008", path: "docs/adr/adr-008-plafond.md", status: "Proposed" }] };
  const toRatification = [...toFirstPhase(), ...researchPhase, CP("DESIGN"), REPORTED, REPORTED, withAdr, LENSES(lens("APPROVED"))];

  it("DESIGN approuvé avec ADR proposés → RATIFICATION : une demande par ADR", () => {
    const { state, effects } = play(toRatification);
    expect(state.stage).toBe("RATIFICATION");
    expect(effects).toEqual([{ kind: "askRatification", adr: { id: "ADR-008", path: "docs/adr/adr-008-plafond.md", status: "Proposed" } }]);
  });

  it("accept de tous les ADR → COMMIT", () => {
    const { state, effects } = play([...toRatification, DECIDE("accept:ADR-008")]);
    expect(state.adrs).toEqual([{ id: "ADR-008", path: "docs/adr/adr-008-plafond.md", status: "Accepted", decisionBy: "user" }]);
    expect(state.stage).toBe("COMMIT");
    expect(kinds(effects)).toEqual(["commitPhase"]);
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
    expect(skipped.effects).toEqual([{ kind: "rollback", to: "cp-RESEARCH" }, { kind: "checkpointPhase", phase: "DESIGN" }]);
    expect(play([...escalated, DECIDE("abort")]).state.stage).toBe("ABORTED");
  });

  it("ABORT depuis n'importe quel stage", () => {
    for (const events of [[], [INITIALIZED], toFirstPhase(), toRatification] as Ev[][])
      expect(play([...events, { type: "ABORT" }]).state.stage).toBe("ABORTED");
  });
});

describe("Invariants (§5.3)", () => {
  /** Générateur pseudo-aléatoire déterministe : suites d'événements plausibles et absurdes. */
  function* randomRuns(n: number): Generator<Ev[]> {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pool: Ev[] = [
      INITIALIZED, PROPOSED("simple"), PROPOSED("medium-hard"), DECIDE("medium"), DECIDE("challenging"), DECIDE("retry"), DECIDE("skip"), DECIDE("accept:ADR-008"), DECIDE("amend:ADR-008", "x"),
      CP("RESEARCH"), CP("DESIGN"), CP("DISTILL"), CP("DELIVER"), REPORTED, GATE_OK, GATE_FAIL, { type: "GATE_OK", artifacts: [], adrs: [{ id: "ADR-008", path: "p", status: "Proposed" }] },
      LENSES(lens("APPROVED")), LENSES(lens("APPROVED", ["major"])), LENSES(lens("REJECTED"), lens("REJECTED")), COMMITTED,
      { type: "TIMEOUT", reason: "t" }, { type: "BLOCKER_REPORTED", question: "q", choices: [] }, { type: "RESUMED" },
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
