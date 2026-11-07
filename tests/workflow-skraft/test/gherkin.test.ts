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
import { checkGherkin } from "../../../workflows/skraft/gherkin.mjs";

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
