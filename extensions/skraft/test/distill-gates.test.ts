import { describe, expect, it } from "vitest";
import { acOf, checkAcceptanceRed, checkValues, featureScenarios } from "../src/distill.js";
import { parseStory } from "../src/story.js";
import { US12 } from "./story.test.js";

const criteria = (() => {
  const r = parseStory(US12);
  if (!r.ok) throw new Error();
  return r.story.criteria;
})();

const FEATURE = `# language: fr
Fonctionnalité: Plafonner le bolus proposé

  @ac-1
  Scénario: dose sous le plafond
    Soit un plafond de 10 U
    Quand le calcul donne 6 U
    Alors la dose proposée est 6 U sans alerte

  @ac-2
  Scénario: dose au-dessus du plafond
    Soit un plafond de 10 U
    Quand le calcul donne 12,5 U
    Alors la dose proposée est 10 U avec l'alerte « Dose plafonnée à 10 U »

  @ac-3
  Scénario: aucun plafond
    Soit aucun plafond configuré
    Alors la dose proposée égale le calcul
`;

const TESTS = `import { describe, it, expect } from "vitest";
import { capBolus, proposeDose } from "../../src/bolus";
it("ac-1 dose sous le plafond", () => expect(capBolus(6, 10)).toEqual({ dose: 6, alert: null }));
it("ac-2 dose plafonnée", () => expect(capBolus(12.5, 10)).toEqual({ dose: 10, alert: "Dose plafonnée à 10 U" }));
it("ac-3 aucun plafond", () => expect(proposeDose(7)).toBe(7));
`;

const files = (feature = FEATURE, tests = TESTS) => ({
  criteria,
  features: [{ path: ".skraft/us-12/distill/features/plafond.feature", content: feature }],
  acceptanceTests: [{ path: "tests/acceptance/plafond.test.ts", content: tests }],
});

describe("Porte valeurs (SPEC-skraft §7.3, fixture §13.2)", () => {
  it("scénarios tagués par critère", () => {
    expect([...featureScenarios(FEATURE).keys()]).toEqual([1, 2, 3]);
  });

  it("valeurs copiées mot pour mot : aucun rejet", () => {
    expect(checkValues(files())).toEqual([]);
  });

  it("« 12 U » au lieu de « 12,5 U » dans le scénario : rejet nommant le critère 2", () => {
    expect(checkValues(files(FEATURE.replace("12,5 U", "12 U")))).toEqual([
      "La valeur « 12,5 U » du critère 2 n'apparaît pas dans le scénario @ac-2 (.skraft/us-12/distill/features/plafond.feature).",
    ]);
  });

  it("valeur absente du test d'acceptance du critère", () => {
    expect(checkValues(files(FEATURE, TESTS.replace("12.5", "12")))).toEqual([
      "La valeur « 12,5 U » du critère 2 n'apparaît pas dans le test d'acceptance du critère 2 (tests/acceptance/plafond.test.ts).",
    ]);
  });

  it("séparateur décimal et espaces normalisés", () => {
    expect(checkValues(files(FEATURE.replace("12,5 U", "12.5 U")))).toEqual([]);
  });

  it("critère sans scénario ni test d'acceptance", () => {
    const r = checkValues(files(FEATURE.replace("@ac-3", "@autre"), TESTS.replace("ac-3", "autre")));
    expect(r).toEqual(["Aucun scénario tagué @ac-3 pour le critère 3.", "Aucun test d'acceptance ne porte le marqueur ac-3 (critère 3)."]);
  });
});

describe("Porte RED d'acceptance (SPEC-skraft §7.3, fixture §13.2)", () => {
  const red = (id: string, failureKind: "assertion" | "missing_symbol" | "other_error", message = "x") => ({ id, file: "tests/acceptance/plafond.test.ts", status: "failed" as const, failureKind, message });
  const green = (id: string) => ({ id, file: "tests/acceptance/plafond.test.ts", status: "passed" as const });

  it("marqueur de critère dans l'identifiant d'un test", () => {
    expect(acOf("tests/acceptance/plafond.test.ts > ac-2 dose plafonnée")).toBe(2);
    expect(acOf("AcceptanceTests.PlafondTests/testAc3NoCap")).toBe(3);
    expect(acOf("unit > cap")).toBeNull();
  });

  it("rouge sur assertion ou symbole manquant : accepté", () => {
    const r = checkAcceptanceRed({ criteria, testPlan: "", results: [red("ac-1 x", "missing_symbol"), red("ac-2 x", "assertion"), red("ac-3 x", "assertion")] });
    expect(r).toEqual({ reasons: [], regressions: [] });
  });

  it("mauvaise raison d'échouer : rejet", () => {
    const r = checkAcceptanceRed({ criteria, testPlan: "", results: [red("ac-1 x", "other_error", "SyntaxError: Unexpected token"), red("ac-2 x", "assertion"), red("ac-3 x", "assertion")] });
    expect(r.reasons).toEqual(["Le test d'acceptance « ac-1 x » échoue pour une mauvaise raison : SyntaxError: Unexpected token"]);
  });

  it("test déjà vert sans justification : rejet ; avec justification dans test-plan.md : requalifié en non-régression", () => {
    const results = [red("ac-1 x", "missing_symbol"), red("ac-2 x", "assertion"), green("ac-3 aucun plafond")];
    expect(checkAcceptanceRed({ criteria, testPlan: "", results }).reasons).toEqual([
      "Le test d'acceptance « ac-3 aucun plafond » (critère 3) passe déjà : requalifiez-le en non-régression avec une justification dans test-plan.md, ou faites-le piloter un nouveau comportement.",
    ]);
    const plan = "## Rôles\n- @ac-3 : role: regression — justification : le comportement « aucun plafond » existe déjà.\n";
    expect(checkAcceptanceRed({ criteria, testPlan: plan, results })).toEqual({ reasons: [], regressions: ["ac-3 aucun plafond"] });
  });

  it("aucun test d'acceptance exécuté : rejet", () => {
    expect(checkAcceptanceRed({ criteria, testPlan: "", results: [] }).reasons).toEqual(["Aucun test d'acceptance n'a été exécuté."]);
  });
});
