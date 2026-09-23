import { describe, expect, it } from "vitest";
import type { TddEffect, TddState } from "../src/model.js";
import { initialEffects, initialState, transition, type Ev } from "../src/reducer.js";

/** Rejoue une suite d'événements depuis l'état initial ; renvoie l'état final et les effets du dernier pas. */
function play(events: Ev[], input = { feature: "Plafonner le bolus", autoApprovePlan: true }) {
  let state = initialState(input);
  let effects: TddEffect[] = initialEffects(state);
  for (const e of events) ({ state, effects } = transition(state, e));
  return { state, effects };
}

const PLAN: Ev = {
  type: "PLAN_SUBMITTED",
  steps: [
    { id: "s1", behavior: "dose sous le plafond inchangée" },
    { id: "s2", behavior: "dose au-dessus du plafond plafonnée" },
  ],
};
const CP = (id: string, baseline: string[] = []): Ev => ({ type: "CHECKPOINT_CREATED", checkpointId: id, baselineTests: baseline });
const DONE: Ev = { type: "AGENT_DONE", summary: "fait", files: ["x"] };
const RED_OK: Ev = { type: "VERIFY_OK", checkpointId: "cp-red", newTestIds: ["t1"], testsHash: "h1" };
const OK = (cp: string): Ev => ({ type: "VERIFY_OK", checkpointId: cp });
const FAIL = (reason: string): Ev => ({ type: "VERIFY_FAIL", reason });

const kinds = (effects: TddEffect[]) => effects.map((e) => e.kind);

describe("Réducteur TDD — planification", () => {
  it("démarre en PLANNING et lance le planificateur", () => {
    const s = initialState({ feature: "F" });
    expect(s.phase).toBe("PLANNING");
    expect(s.maxAttempts).toBe(3);
    expect(initialEffects(s)).toEqual([{ kind: "runPlanner", feature: "F" }]);
  });

  it("plan vide : terminé", () => {
    expect(play([{ type: "PLAN_SUBMITTED", steps: [] }]).state.phase).toBe("DONE");
  });

  it("plan soumis : demande de validation à l'utilisateur (sans attente bloquante)", () => {
    const { state, effects } = play([PLAN], { feature: "F", autoApprovePlan: false });
    expect(state.phase).toBe("PLAN_REVIEW");
    expect(effects).toEqual([{ kind: "askPlanReview", steps: state.steps }]);
    expect(state.steps.map((s) => s.status)).toEqual(["pending", "pending"]);
  });

  it("plan approuvé : première étape, checkpoint", () => {
    const { state, effects } = play([PLAN, { type: "HUMAN_DECISION", decision: "approve" }], { feature: "F", autoApprovePlan: false });
    expect(state.phase).toBe("STEP_START");
    expect(effects).toEqual([{ kind: "createCheckpoint", label: "Avant l'étape s1" }]);
  });

  it("plan refusé : replanification avec le motif", () => {
    const { state, effects } = play([PLAN, { type: "HUMAN_DECISION", decision: "reject", comment: "trop gros" }], {
      feature: "F",
      autoApprovePlan: false,
    });
    expect(state.phase).toBe("PLANNING");
    expect(effects).toEqual([{ kind: "runPlanner", feature: "F", feedback: "trop gros" }]);
  });

  it("auto-approbation : directement la première étape", () => {
    expect(kinds(play([PLAN]).effects)).toEqual(["createCheckpoint"]);
  });

  it("identifiants d'étape en double : replanification avec motif précis", () => {
    const { state, effects } = play([{ type: "PLAN_SUBMITTED", steps: [{ id: "a", behavior: "x" }, { id: "a", behavior: "y" }] }]);
    expect(state.phase).toBe("PLANNING");
    expect(effects[0]).toMatchObject({ kind: "runPlanner", feedback: expect.stringMatching(/unique/) });
  });

  it("délai dépassé du planificateur : réessai, puis escalade au budget épuisé", () => {
    const t: Ev = { type: "TIMEOUT", reason: "silence" };
    expect(kinds(play([t]).effects)).toEqual(["runPlanner"]);
    const { state, effects } = play([t, t, t]);
    expect(state.phase).toBe("ESCALATED");
    expect(effects).toEqual([{ kind: "askHuman", reason: "silence", from: "PLANNING", options: ["retry", "abort"] }]);
  });
});

describe("Réducteur TDD — cycle d'une étape", () => {
  const toRed = [PLAN, CP("cp-s1", ["old"])];

  it("checkpoint pris : RED, agent test lancé, ligne de base enregistrée", () => {
    const { state, effects } = play(toRed);
    expect(state.phase).toBe("RED");
    expect(state.checkpoints.step).toBe("cp-s1");
    expect(state.baselineTests).toEqual(["old"]);
    expect(effects).toEqual([{ kind: "runTestAgent", step: state.steps[0] }]);
  });

  it("agent test terminé : vérification RED depuis le checkpoint de l'étape, résumé conservé", () => {
    const { state, effects } = play([...toRed, DONE]);
    expect(state.phase).toBe("RED_VERIFY");
    expect(effects).toEqual([{ kind: "verifyRed", since: "cp-s1", baseline: ["old"], step: state.steps[0] }]);
    expect(state.reports).toEqual([{ stepId: "s1", phase: "RED", summary: "fait", files: ["x"] }]);
  });

  it("RED valide : GREEN avec les tests gelés", () => {
    const { state, effects } = play([...toRed, DONE, RED_OK]);
    expect(state.phase).toBe("GREEN");
    expect(state.testsHash).toBe("h1");
    expect(state.newTestIds).toEqual(["t1"]);
    expect(state.checkpoints.red).toBe("cp-red");
    expect(effects).toEqual([{ kind: "runDevAgent", mode: "green", step: state.steps[0], testIds: ["t1"] }]);
  });

  it("GREEN terminé : vérification depuis le point rouge avec l'empreinte gelée", () => {
    const { effects } = play([...toRed, DONE, RED_OK, DONE]);
    expect(effects).toEqual([
      { kind: "verifyGreen", since: "cp-red", testsHash: "h1", message: "feat: dose sous le plafond inchangée", mode: "green" },
    ]);
  });

  it("GREEN valide : REFACTOR ; REFACTOR valide : étape suivante", () => {
    const green = play([...toRed, DONE, RED_OK, DONE, OK("cp-green")]);
    expect(green.state.phase).toBe("REFACTOR");
    expect(green.effects).toEqual([{ kind: "runDevAgent", mode: "refactor", step: green.state.steps[0], testIds: ["t1"] }]);

    const next = play([...toRed, DONE, RED_OK, DONE, OK("cp-green"), DONE, OK("cp-ref")]);
    expect(next.state.steps[0]?.status).toBe("done");
    expect(next.state.current).toBe(1);
    expect(next.state.phase).toBe("STEP_START");
    expect(next.effects).toEqual([{ kind: "createCheckpoint", label: "Avant l'étape s2" }]);
  });

  it("vérification du nettoyage : message refactor, depuis le point vert", () => {
    const { effects } = play([...toRed, DONE, RED_OK, DONE, OK("cp-green"), DONE]);
    expect(effects[0]).toMatchObject({ kind: "verifyGreen", since: "cp-green", mode: "refactor", message: "refactor: dose sous le plafond inchangée" });
  });

  it("sans refactor : l'étape se termine au vert", () => {
    const { state } = play([PLAN, CP("cp"), DONE, RED_OK, DONE, OK("cp-green")], {
      feature: "F",
      autoApprovePlan: true,
      skipRefactor: true,
    } as never);
    expect(state.steps[0]?.status).toBe("done");
  });

  it("dernière étape terminée : DONE", () => {
    const step = (cp: string) => [CP(cp), DONE, RED_OK, DONE, OK("g"), DONE, OK("r")];
    const { state, effects } = play([PLAN, ...step("a"), ...step("b")]);
    expect(state.phase).toBe("DONE");
    expect(effects).toEqual([]);
    expect(state.steps.map((s) => s.status)).toEqual(["done", "done"]);
  });
});

describe("Réducteur TDD — rejets, budget et escalade (D24)", () => {
  const atRedVerify = [PLAN, CP("cp-s1"), DONE];
  const atGreenVerify = [PLAN, CP("cp-s1"), DONE, RED_OK, DONE];

  it("RED rejeté : rollback au début de l'étape puis relance avec le motif précis", () => {
    const { state, effects } = play([...atRedVerify, FAIL("Aucun nouveau test détecté.")]);
    expect(state.phase).toBe("RED");
    expect(state.attempts).toBe(1);
    expect(effects).toEqual([
      { kind: "rollback", to: "cp-s1" },
      { kind: "runTestAgent", step: state.steps[0], feedback: "Aucun nouveau test détecté." },
    ]);
  });

  it("GREEN rejeté (test modifié) : rollback au point rouge et relance ciblée", () => {
    const { state, effects } = play([...atGreenVerify, FAIL("Les fichiers de test ont été modifiés")]);
    expect(state.phase).toBe("GREEN");
    expect(effects).toEqual([
      { kind: "rollback", to: "cp-red" },
      { kind: "runDevAgent", mode: "green", step: state.steps[0], testIds: ["t1"], feedback: "Les fichiers de test ont été modifiés" },
    ]);
  });

  it("TIMEOUT pendant un tour d'agent = rejet (réessai)", () => {
    const { state, effects } = play([PLAN, CP("cp-s1"), { type: "TIMEOUT", reason: "Aucune activité" }]);
    expect(state.phase).toBe("RED");
    expect(state.attempts).toBe(1);
    expect(kinds(effects)).toEqual(["rollback", "runTestAgent"]);
  });

  it("budget épuisé : escalade avec rollback et demande à l'humain", () => {
    const f = FAIL("mauvais test");
    const { state, effects } = play([...atRedVerify, f, DONE, f, DONE, f]);
    expect(state.phase).toBe("ESCALATED");
    expect(state.escalation).toEqual({ from: "RED", reason: "mauvais test" });
    expect(effects).toEqual([
      { kind: "rollback", to: "cp-s1" },
      { kind: "askHuman", reason: "mauvais test", from: "RED", options: ["retry", "skip", "abort"] },
    ]);
  });

  it("ENV_FAILURE : escalade immédiate, sans consommer le budget (D25)", () => {
    const { state, effects } = play([PLAN, CP("cp-s1"), { type: "ENV_FAILURE", reason: "runtime injoignable" }]);
    expect(state.phase).toBe("ESCALATED");
    expect(state.attempts).toBe(0);
    expect(effects).toEqual([
      { kind: "rollback", to: "cp-s1" },
      { kind: "askHuman", reason: "runtime injoignable", from: "RED", options: ["retry", "skip", "abort"] },
    ]);
  });

  it("ENV_FAILURE pendant GREEN : retour au point rouge", () => {
    const { effects } = play([PLAN, CP("cp-s1"), DONE, RED_OK, { type: "ENV_FAILURE", reason: "quota" }]);
    expect(effects[0]).toEqual({ kind: "rollback", to: "cp-red" });
  });

  it("escalade → relancer : repart de la phase fautive, budget remis à zéro", () => {
    const f = FAIL("x");
    const { state, effects } = play([...atRedVerify, f, DONE, f, DONE, f, { type: "HUMAN_DECISION", decision: "retry" }]);
    expect(state.phase).toBe("RED");
    expect(state.attempts).toBe(0);
    expect(effects).toEqual([{ kind: "runTestAgent", step: state.steps[0], feedback: "x" }]);
  });

  it("escalade → sauter : étape marquée sautée, rollback au début d'étape, étape suivante", () => {
    const f = FAIL("x");
    const { state, effects } = play([...atRedVerify, f, DONE, f, DONE, f, { type: "HUMAN_DECISION", decision: "skip" }]);
    expect(state.steps[0]?.status).toBe("skipped");
    expect(state.phase).toBe("STEP_START");
    expect(effects).toEqual([
      { kind: "rollback", to: "cp-s1" },
      { kind: "createCheckpoint", label: "Avant l'étape s2" },
    ]);
  });

  it("escalade avant le checkpoint d'étape → relancer : l'étape repart de son début", () => {
    const { state, effects } = play([PLAN, { type: "ENV_FAILURE", reason: "git absent" }, { type: "HUMAN_DECISION", decision: "retry" }]);
    expect(state.phase).toBe("STEP_START");
    expect(effects).toEqual([{ kind: "createCheckpoint", label: "Avant l'étape s1" }]);
  });

  it("escalade → abandonner : ABORTED", () => {
    const { state } = play([PLAN, CP("c"), { type: "ENV_FAILURE", reason: "x" }, { type: "HUMAN_DECISION", decision: "abort" }]);
    expect(state.phase).toBe("ABORTED");
  });

  it("décision inconnue en escalade : ignorée", () => {
    const before = play([PLAN, CP("c"), { type: "ENV_FAILURE", reason: "x" }]);
    const after = transition(before.state, { type: "HUMAN_DECISION", decision: "n'importe quoi" });
    expect(after).toEqual({ state: before.state, effects: [] });
  });

  it("REFACTOR raté : rollback au vert, étape terminée sans escalade", () => {
    const { state, effects } = play([PLAN, CP("cp-s1"), DONE, RED_OK, DONE, OK("cp-green"), DONE, FAIL("rouge")]);
    expect(state.steps[0]?.status).toBe("done");
    expect(effects).toEqual([
      { kind: "rollback", to: "cp-green" },
      { kind: "createCheckpoint", label: "Avant l'étape s2" },
    ]);
  });

  it("TIMEOUT pendant REFACTOR : même traitement qu'un refactor raté", () => {
    const { effects } = play([PLAN, CP("cp-s1"), DONE, RED_OK, DONE, OK("cp-green"), { type: "TIMEOUT", reason: "t" }]);
    expect(effects[0]).toEqual({ kind: "rollback", to: "cp-green" });
  });
});

describe("Réducteur TDD — événements système et robustesse", () => {
  it("ABORT depuis n'importe quel état actif : ABORTED sans effet", () => {
    for (const events of [[], [PLAN], [PLAN, CP("c")], [PLAN, CP("c"), DONE]] as Ev[][]) {
      const { state } = play([...events, { type: "ABORT" }]);
      expect(state.phase).toBe("ABORTED");
    }
  });

  it("RESUMED ne change rien : le moteur rejoue lui-même l'effet interrompu", () => {
    const before = play([PLAN, CP("c")]);
    expect(transition(before.state, { type: "RESUMED" })).toEqual({ state: before.state, effects: [] });
  });

  it("événement inattendu : ignoré (état et effets inchangés)", () => {
    const before = play([PLAN, CP("c")]);
    expect(transition(before.state, RED_OK)).toEqual({ state: before.state, effects: [] });
  });

  it("états terminaux : plus rien ne bouge", () => {
    const aborted = play([{ type: "ABORT" }]).state;
    expect(transition(aborted, PLAN)).toEqual({ state: aborted, effects: [] });
  });

  it("le réducteur est pur : l'état d'entrée n'est jamais modifié", () => {
    const before = play([PLAN, CP("c"), DONE]).state;
    const frozen: TddState = structuredClone(before);
    transition(before, FAIL("x"));
    transition(before, RED_OK);
    expect(before).toEqual(frozen);
  });
});
