// Repris de extensions/skraft-workflow/test/gherkin.test.ts (2026-10-10) : teste le workflow en dossier (ADR 0055).
/**
 * Porte `gherkin` (§7.3) : la partie mécanisable de la skill `bdd-methodology`, portée en code.
 *
 * Pourquoi une porte et pas seulement une consigne. Les tests d'acceptance sont **gelés** à la
 * sortie de DISTILL : un scénario couplé à un détail technique ne devient pas seulement médiocre,
 * il devient la spécification que toute la phase de livraison doit satisfaire, et plus personne ne
 * peut le corriger. Ailleurs une faiblesse de méthode coûte un réessai ; ici elle se fige.
 *
 * La porte ne juge pas le style. Elle refuse ce qui est reconnaissable sans interprétation.
 */
import { describe, expect, it } from "vitest";
import { checkGherkin, checkTitresBdd, dossiersDesFeatures, gherkinDeLaStory } from "../../../workflows/skraft/gherkin.mjs";

const scenario = (corps: string, tags = "@ac-1") => [{ path: "features/x.feature", content: `Fonctionnalité: F\n\n  ${tags}\n  ${corps}\n` }];

describe("Vocabulaire de couche : le Gherkin parle métier, jamais technique", () => {
  it.each([
    ["verbe HTTP", "Quand j'appelle POST /api/panier", /POST|HTTP/i],
    ["segment d'URL", "Quand le client ouvre /api/v1/paniers/12", /URL|chemin/i],
    ["nom de classe", "Quand le CalculDuPanier applique la remise", /CalculDuPanier|classe/i],
    ["dépôt", "Étant donné que le PanierRepository contient 3 articles", /PanierRepository|classe/i],
    ["infrastructure", "Étant donné que la base de données contient un panier", /base de données|infrastructure/i],
    ["infrastructure anglaise", "Given the database contains a cart", /database|infrastructure/i],
  ] as const)("%s est refusé", (_cas, etape, motif) => {
    const r = checkGherkin(scenario(`Scénario: s\n    ${etape}\n    Alors la remise est de 1,00 €`));
    expect(r.join(" ")).toMatch(motif);
  });

  it("une étape purement métier passe", () => {
    const r = checkGherkin(scenario("Scénario: le client obtient sa remise\n    Étant donné un panier de 10 articles à 2,00 €\n    Quand le client demande le chiffrage\n    Alors la remise appliquée est de 1,00 €"));
    expect(r).toEqual([]);
  });

  it("un mot métier qui ressemble à un mot technique n'est pas refusé", () => {
    // « base » seul est un mot courant ; c'est « base de données » qui est technique.
    const r = checkGherkin(scenario("Scénario: s\n    Étant donné un tarif de base de 2,00 €\n    Quand le client commande\n    Alors le prix est de 2,00 €"));
    expect(r).toEqual([]);
  });
});

describe("Structure : un déclencheur, une assertion qui nomme un résultat", () => {
  it("deux étapes « Quand » sont refusées : deux comportements font deux scénarios", () => {
    const r = checkGherkin(scenario("Scénario: s\n    Quand le client commande\n    Quand le client paie\n    Alors c'est enregistré"));
    expect(r.join(" ")).toMatch(/déclencheur|Quand/i);
  });

  it("« Et » après un « Quand » ne compte pas pour un second déclencheur", () => {
    const r = checkGherkin(scenario("Scénario: s\n    Quand le client commande\n    Et qu'il ajoute un article\n    Alors la remise appliquée est de 1,00 €"));
    expect(r).toEqual([]);
  });

  it.each(["Alors ça marche", "Alors c'est correct", "Alors tout est ok", "Then it works"])(
    "une assertion vague est refusée : « %s »",
    (alors) => {
      const r = checkGherkin(scenario(`Scénario: s\n    Quand le client commande\n    ${alors}`));
      expect(r.join(" ")).toMatch(/assertion|résultat/i);
    },
  );

  it("un scénario de plus de sept étapes est refusé", () => {
    const etapes = Array.from({ length: 8 }, (_, i) => `    Et l'étape métier numéro ${i + 1}`).join("\n");
    const r = checkGherkin(scenario(`Scénario: s\n    Quand le client commande\n${etapes}\n    Alors la remise appliquée est de 1,00 €`));
    expect(r.join(" ")).toMatch(/étapes/i);
  });

  it("sept étapes exactement passent : la limite n'est pas un piège", () => {
    const etapes = Array.from({ length: 5 }, (_, i) => `    Et l'étape métier numéro ${i + 1}`).join("\n");
    const r = checkGherkin(scenario(`Scénario: s\n    Quand le client commande\n${etapes}\n    Alors la remise appliquée est de 1,00 €`));
    expect(r).toEqual([]);
  });
});

describe("Tags", () => {
  it("un tag de couche technique est refusé", () => {
    const r = checkGherkin(scenario("Scénario: s\n    Quand le client commande\n    Alors la remise appliquée est de 1,00 €", "@ac-1 @backend"));
    expect(r.join(" ")).toMatch(/@backend/);
  });

  it("un tag de comportement passe", () => {
    const r = checkGherkin(scenario("Scénario: s\n    Quand le client commande\n    Alors la remise appliquée est de 1,00 €", "@ac-1 @happy-path"));
    expect(r).toEqual([]);
  });
});

describe("Ce que la porte ne fait pas", () => {
  it("elle nomme le fichier et le scénario fautifs, pour que la correction soit possible", () => {
    const r = checkGherkin([{ path: "features/panier.feature", content: "Fonctionnalité: F\n\n  @ac-2\n  Scénario: remise appliquée\n    Quand j'appelle POST /api/x\n    Alors la remise appliquée est de 1,00 €\n" }]);
    expect(r[0]).toMatch(/panier\.feature/);
    expect(r[0]).toMatch(/remise appliquée/);
  });

  it("un fichier sans aucun scénario ne produit aucun motif : c'est la porte valeurs qui s'en charge", () => {
    expect(checkGherkin([{ path: "features/vide.feature", content: "Fonctionnalité: F\n" }])).toEqual([]);
  });

  it("les lignes de commentaire et les tableaux d'exemples ne sont pas analysés comme des étapes", () => {
    const r = checkGherkin(scenario("Scénario: s\n    # Quand j'appelle POST /api/x — note pour plus tard\n    Quand le client commande\n    Alors la remise appliquée est de 1,00 €"));
    expect(r).toEqual([]);
  });
});

/**
 * BDD (ADR 0074) : le `.feature` de DISTILL va au projet, et le titre de chaque scénario commence par
 * son critère (`AC-1 …`). C'est ce qui relie le scénario à son test : Reqnroll nomme le test d'après
 * le titre (`AC_1LeClient…`), et l'enregistreur JUnit ne garde pas le tag `@ac-1`.
 */
describe("BDD : où vit le Gherkin, et titres AC-n (ADR 0074)", () => {
  it("sans BDD, le dossier de DISTILL ; en BDD, les dossiers features des couples", () => {
    expect(dossiersDesFeatures("us-2", undefined)).toEqual([".skraft/us-2/distill/features"]);
    expect(dossiersDesFeatures("us-2", [{ lanceur: "reqnroll", features: "tests/A/Features", etapes: "tests/A/Steps" }, { lanceur: "reqnroll", features: "web/features", etapes: "web/steps" }])).toEqual(["tests/A/Features", "web/features"]);
  });

  it("chaque scénario @ac-<n> commence son titre par AC-<n> ; casse et séparateur libres", () => {
    const f = (corps: string) => [{ path: "tests/A/Features/panier.feature", content: `# language: fr\nFonctionnalité: Chiffrer\n${corps}` }];
    expect(checkTitresBdd(f("  @ac-1\n  Scénario: AC-1 Le client chiffre une ligne\n    Soit un panier\n  @ac-2\n  Scénario: ac2 — le client chiffre deux lignes\n    Soit un panier\n"))).toEqual([]);
    expect(checkTitresBdd(f("  @ac-1 @happy-path\n  Scénario: Le client chiffre une ligne\n    Soit un panier\n"))).toEqual([
      "tests/A/Features/panier.feature : le titre du scénario « Le client chiffre une ligne » (@ac-1) doit commencer par « AC-1 » : c'est ce qui le relie à son test.",
    ]);
    expect(checkTitresBdd(f("  @ac-2\n  Scénario: AC-1 mauvais critère\n    Soit un panier\n"))).toEqual([
      "tests/A/Features/panier.feature : le titre du scénario « AC-1 mauvais critère » (@ac-2) doit commencer par « AC-2 » : c'est ce qui le relie à son test.",
    ]);
  });
});

/**
 * Le Gherkin de la story (ADR 0074, run du 08/11) : en BDD, le dossier `features` contient aussi les
 * scénarios des stories précédentes. Les portes ne jugent que les scénarios nouveaux, et un scénario
 * existant modifié ou supprimé est refusé : il appartient à une autre story.
 */
describe("Gherkin de la story : nouveaux scénarios seulement, les existants intouchables", () => {
  const US1 = `# language: fr
@US-1
Fonctionnalité: Chiffrer un panier

  @ac-1 @happy-path
  Scénario: Le client chiffre une ligne
    Soit un panier vide
    Alors la somme est de 13.50 euros

  @ac-2
  Scénario: Le client chiffre deux lignes
    Soit un panier vide
    Alors la somme est de 15.90 euros
`;
  const US2 = `# language: fr
Fonctionnalité: Remise par palier

  @ac-1
  Scénario: AC-1 Une ligne sous le palier
    Soit le palier « 10 articles ou plus : 5 % »
    Alors la remise est de 0,00 €
`;
  const avant = [{ path: "F/panier-chiffrage.feature", content: US1 }];

  it("un nouveau fichier : tous ses scénarios sont ceux de la story ; les fichiers inchangés n'en donnent aucun", () => {
    const r = gherkinDeLaStory(avant, [...avant, { path: "F/panier-remise.feature", content: US2 }]);
    expect(r.modifies).toEqual([]);
    expect(r.features.map((f) => f.path)).toEqual(["F/panier-remise.feature"]);
    // Les portes qui jugent la story ne voient plus les titres de l'US-1.
    expect(checkTitresBdd(r.features)).toEqual([]);
  });

  it("des scénarios ajoutés à un fichier existant : seuls ceux-là, avec l'en-tête du fichier", () => {
    const ajout = `${US1}\n  @ac-3\n  Scénario: AC-3 Le client chiffre un panier vide\n    Soit un panier vide\n    Alors la somme est de 0.00 euros\n`;
    const r = gherkinDeLaStory(avant, [{ path: "F/panier-chiffrage.feature", content: ajout }]);
    expect(r.modifies).toEqual([]);
    expect(r.features).toHaveLength(1);
    expect(r.features[0]!.content).toContain("# language: fr");
    expect(r.features[0]!.content).toContain("Scénario: AC-3 Le client chiffre un panier vide");
    expect(r.features[0]!.content).not.toContain("Le client chiffre une ligne");
  });

  it("un scénario existant renommé est refusé, avec son titre d'origine et la conduite à tenir", () => {
    const renomme = US1.replace("Scénario: Le client chiffre une ligne", "Scénario: AC-1 Le client chiffre une ligne");
    const r = gherkinDeLaStory(avant, [{ path: "F/panier-chiffrage.feature", content: renomme }]);
    expect(r.modifies).toEqual([
      "F/panier-chiffrage.feature : le scénario « Le client chiffre une ligne » existait avant DISTILL et a été modifié ou supprimé. Il appartient à une story précédente : n'y touche pas ; si cette story change ce comportement, pose la question.",
    ]);
  });

  it("un scénario existant supprimé, ou son fichier, est refusé de même", () => {
    const sans = US1.slice(0, US1.indexOf("  @ac-2"));
    expect(gherkinDeLaStory(avant, [{ path: "F/panier-chiffrage.feature", content: sans }]).modifies).toHaveLength(1);
    expect(gherkinDeLaStory(avant, []).modifies).toHaveLength(2);
  });

  it("l'en-tête d'un fichier existant modifié (contexte partagé, fonctionnalité) est refusé : il change ses scénarios", () => {
    const contexte = US1.replace("Fonctionnalité: Chiffrer un panier\n", "Fonctionnalité: Chiffrer un panier\n\n  Contexte:\n    Soit un client connecté\n");
    expect(gherkinDeLaStory(avant, [{ path: "F/panier-chiffrage.feature", content: contexte }]).modifies).toEqual([
      "F/panier-chiffrage.feature : l'en-tête du fichier (fonctionnalité, contexte partagé) existait avant DISTILL et a été modifié. Il appartient à une story précédente : n'y touche pas ; si cette story change ce comportement, pose la question.",
    ]);
  });

  it("lignes vides et espaces de fin ne comptent pas comme une modification", () => {
    const aere = US1.replaceAll("\n", "  \n").replace("@ac-2", "\n\n  @ac-2");
    expect(gherkinDeLaStory(avant, [{ path: "F/panier-chiffrage.feature", content: aere }])).toEqual({ features: [], modifies: [] });
  });
});
