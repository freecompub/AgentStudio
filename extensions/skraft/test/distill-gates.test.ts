import { describe, expect, it } from "vitest";
import { acOf, checkAcceptanceRed, checkPlans, checkValues, featureScenarios } from "../src/distill.js";
import { matchesAny } from "@agent-studio/extension-api";
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

  it("les tests SANS marqueur sont ignorés, pas jugés : la suite entière peut être transmise", () => {
    // La porte reçoit tous les résultats de la suite. Un test unitaire vert n'est pas « un test
    // d'acceptance qui passe déjà » : il n'est pas de son ressort.
    const unitaire = { id: "CalculDuPanierTests.Un_panier_vide_vaut_zero", file: "x", status: "passed" as const };
    const r = checkAcceptanceRed({ criteria, testPlan: "", results: [unitaire, red("ac-1 x", "missing_symbol"), red("ac-2 x", "assertion"), red("ac-3 x", "assertion")] });
    expect(r).toEqual({ reasons: [], regressions: [] });
  });

  it("aucun test exécuté du tout : la porte le dit ainsi", () => {
    expect(checkAcceptanceRed({ criteria, testPlan: "", results: [] }).reasons).toEqual(["Aucun test n'a été exécuté : la suite n'a produit aucun résultat."]);
  });
});

/**
 * Ce que la porte RED a reproché trois fois de suite à un agent qui avait raison (29/09, ADR 0041).
 *
 * `effects.ts` filtrait les résultats sur les globs de `layout.acceptanceTests` —
 * `tests/**\/*AcceptanceTests.cs` — alors qu'un rapport JUnit exprime `file` comme un NOM DE CLASSE
 * (`file: c.classname`, read-report.ts) et `id` comme un nom .NET qualifié. Aucun glob de chemin ne
 * peut correspondre à l'un ou à l'autre : le filtre rendait toujours zéro, et la porte répondait
 * « Aucun test d'acceptance n'a été exécuté » alors que dix tests venaient de tourner, dont deux
 * rouges sur assertion — exactement le rouge qu'elle attendait.
 *
 * L'agent a épuisé ses trois essais sur un reproche que rien, dans son travail, ne pouvait lever.
 * La réponse était deux lignes plus bas : `acOf(r.id)`, que la porte appelait déjà pour relier un
 * résultat à son critère.
 */
describe("Porte RED : reconnaître ses tests par leur marqueur, pas par leur rangement", () => {
  const criteria = [1, 2, 3, 4, 5].map((n) => ({ n, text: `critère ${n}`, literals: [] }));
  const dotnet = (nom: string, status: "passed" | "failed", failureKind?: "assertion") => ({
    id: `Tarification.Tests.${nom}`,
    file: `Tarification.Tests.${nom.split(".")[0]}`,
    status,
    ...(failureKind ? { failureKind } : {}),
  });
  // Les dix résultats réels du run, tels que le rapport JUnit de `dotnet test` les a rendus.
  const suite = [
    dotnet("RemiseParPalierAcceptanceTests.Ac1_Sous_le_seuil_aucune_remise", "passed"),
    dotnet("RemiseParPalierAcceptanceTests.Ac2_Une_ligne_qui_atteint_le_seuil_obtient_la_remise_du_palier", "failed", "assertion"),
    dotnet("RemiseParPalierAcceptanceTests.Ac3_Le_palier_le_plus_eleve_atteint_l_emporte", "failed", "assertion"),
    dotnet("RemiseParPalierAcceptanceTests.Ac4_La_remise_se_calcule_par_ligne_jamais_sur_le_panier_entier", "passed"),
    dotnet("RemiseParPalierAcceptanceTests.Ac5_Aucun_palier_configure_n_accorde_aucune_remise", "passed"),
    dotnet("CalculDuPanierTests.Un_panier_vide_vaut_zero", "passed"),
    dotnet("CalculDuPanierTests.Plusieurs_lignes_s_additionnent", "passed"),
    dotnet("CalculDuPanierTests.Un_montant_negatif_n_existe_pas", "passed"),
    dotnet("MontantTests.Une_quantite_multiplie_un_montant", "passed"),
    dotnet("FactureTests.Le_total_a_payer_additionne_les_lignes", "passed"),
  ];
  // Le compte du run : 8 réussis, 2 échecs sur assertion.
  it("la fixture est bien celle du run", () => {
    expect(suite).toHaveLength(10);
    expect(suite.filter((r) => r.status === "passed")).toHaveLength(8);
  });

  it("un identifiant .NET n'a jamais la forme d'un chemin — et n'a pas à l'avoir", () => {
    const glob = "tests/**/*AcceptanceTests.cs";
    for (const r of suite) {
      expect(matchesAny([glob], r.id), r.id).toBe(false);
      expect(matchesAny([glob], r.file), r.file).toBe(false);
    }
  });

  it("le marqueur, lui, les distingue : les cinq d'acceptance, et aucun unitaire", () => {
    expect(suite.filter((r) => acOf(r.id) !== null).map((r) => acOf(r.id))).toEqual([1, 2, 3, 4, 5]);
  });

  it("la porte juge ce que l'agent avait produit : deux rouges sur assertion, trois verts à justifier", () => {
    const plan = [1, 4, 5].map((n) => `- @ac-${n} : role: regression — justification : comportement déjà couvert.`).join("\n");
    expect(checkAcceptanceRed({ criteria, testPlan: plan, results: suite })).toEqual({
      reasons: [],
      regressions: suite.filter((r) => r.status === "passed" && acOf(r.id) !== null).map((r) => r.id),
    });
  });

  it("aucun marqueur nulle part : la porte dit ce qu'elle a mesuré, et où mettre le marqueur", () => {
    // L'ancien message — « aucun test d'acceptance n'a été exécué » — affirmait un fait faux, et
    // l'agent ne pouvait qu'y répondre en relançant les tests, ce qu'il a fait, en vain.
    const sansMarqueur = suite.map((r) => ({ ...r, id: r.id.replace(/Ac\d_/, "") }));
    const [motif] = checkAcceptanceRed({ criteria, testPlan: "", results: sansMarqueur }).reasons;
    expect(motif).toContain("10 test(s) exécuté(s)");
    expect(motif).toMatch(/NOM/);
    expect(motif).toContain("Tarification.Tests.RemiseParPalierAcceptanceTests."); // ce qu'elle a vu
    expect(motif).not.toMatch(/n'a été exécuté/);
  });
});

describe("Porte plan de test : plans de DISTILL (option C de docs/15 §4.5)", () => {
  // Repris de skraft-plugin v1.6.1, acceptance-designer-reviewer : G6 (« chaque scénario a sa
  // place dans le plan d'implémentation ») et G8 (« au moins un walking skeleton »).
  const testPlan = "# Plan\n- @ac-1 : walking skeleton — traverse le cas d'usage de bout en bout.\n";
  const implPlan = "1. ac-1\n2. ac-2\n3. ac-3\n";

  it("plans complets : aucun rejet", () => {
    expect(checkPlans({ criteria, testPlan, implPlan })).toEqual([]);
  });

  it("un critère absent du plan d'implémentation : rejet (G6)", () => {
    expect(checkPlans({ criteria, testPlan, implPlan: "1. ac-1\n2. ac-3\n" })).toEqual([
      "impl-plan.md ne cite pas le critère 2 (ac-2) : chaque critère y a sa place dans l'ordre de livraison.",
    ]);
  });

  it("plan d'implémentation absent : rejet", () => {
    expect(checkPlans({ criteria, testPlan, implPlan: null })).toEqual(["Plan d'implémentation absent : impl-plan.md."]);
  });

  it("aucun walking skeleton désigné : rejet (G8)", () => {
    expect(checkPlans({ criteria, testPlan: "# Plan\n", implPlan })).toEqual([
      "test-plan.md ne désigne aucun walking skeleton : marque au moins un scénario par une ligne « - @ac-<n> : walking skeleton — <raison> ».",
    ]);
  });
});
