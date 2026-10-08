// Copie de extensions/skraft/test/design-gate.test.ts (2026-10-08) : elle protège la copie du module.
import { describe, expect, it } from "vitest";
import { renderAdr, supersessionLine } from "../src/adr.js";
import { checkDesign, type DesignInput } from "../src/design.js";

const adr = (n: number, over: Record<string, unknown> = {}) =>
  renderAdr(n, { title: `Décision ${n}`, status: "Proposed", context: "c", decision: "d", consequences: "q", alternatives: "a", ...over } as never, "2026-09-23");

function input(over: Partial<DesignInput> = {}): DesignInput {
  return {
    docs: {
      "event-model.md": "Commande `CapBolus` → événement `BolusCapped`, vue `ProposedDose`.",
      "domain-model.md": "Agrégat `BolusCalculation`, objet-valeur `MaxBolus`.",
      "contracts.md": "`CapBolus` produit `BolusCapped` ; `MaxBolus` est validé.",
      "diagrams.md": "`BolusCalculation` émet `BolusCapped`.",
    },
    adrs: [
      { path: "docs/adr/adr-001-decision-1.md", md: adr(1), isNew: false },
      { path: "docs/adr/adr-002-decision-2.md", md: adr(2), isNew: true },
    ],
    supersessions: "",
    modifiedExistingAdrs: [],
    ...over,
  };
}

describe("Porte cohérence (SPEC-skraft §7.2, fixtures §13.2)", () => {
  it("conception cohérente : aucun rejet", () => {
    expect(checkDesign(input())).toEqual([]);
  });

  it("événement cité dans contracts.md absent du modèle : rejet nommant les deux fichiers", () => {
    const r = checkDesign(input({ docs: { ...input().docs, "contracts.md": "`CapBolus` produit `BolusLimited`." } }));
    expect(r).toEqual(["`BolusLimited` cité dans contracts.md n'existe pas dans event-model.md ni dans domain-model.md."]);
  });

  // Run réel du 03/10 sur US-2 : DESIGN rejetée trois fois, 200 requêtes premium, pour un nom
  // pourtant défini. Le modèle le déclarait dans un bloc de code et sous forme d'appel ; la porte
  // ne reconnaissait qu'un nom seul entre backticks.
  it("un nom défini dans un bloc de code du modèle est connu", () => {
    const docs = {
      ...input().docs,
      "domain-model.md": "Agrégat `BolusCalculation`, objet-valeur `MaxBolus`.\n\n```\nTauxDeRemise { }\nMontant AppliqueA(Montant montant)\n```\n",
      "contracts.md": "`CapBolus` produit `BolusCapped` ; `MaxBolus` est validé ; `AppliqueA` ne fait aucun arrondi.",
    };
    expect(checkDesign(input({ docs }))).toEqual([]);
  });

  it("un nom défini sous forme d'appel entre backticks dans le modèle est connu", () => {
    const docs = {
      ...input().docs,
      "domain-model.md": "Agrégat `BolusCalculation`, objet-valeur `MaxBolus`. Retourne `palier.Taux.AppliqueA(SousTotal)`.",
      "contracts.md": "`CapBolus` produit `BolusCapped` ; `MaxBolus` ; `AppliqueA` ; `SousTotal`.",
    };
    expect(checkDesign(input({ docs }))).toEqual([]);
  });

  it("un nom écrit seulement en prose dans le modèle, hors code, reste inconnu", () => {
    // La convention reste celle des documents de conception : un nom du modèle s'écrit en code.
    const docs = { ...input().docs, "domain-model.md": "Agrégat `BolusCalculation`, objet-valeur `MaxBolus`, et AppliqueA en prose.", "contracts.md": "`AppliqueA`." };
    expect(checkDesign(input({ docs }))).toEqual(["`AppliqueA` cité dans contracts.md n'existe pas dans event-model.md ni dans domain-model.md."]);
  });

  it("identifiant cité dans diagrams.md absent : rejet", () => {
    expect(checkDesign(input({ docs: { ...input().docs, "diagrams.md": "`GhostAggregate` émet `BolusCapped`." } }))).toEqual([
      "`GhostAggregate` cité dans diagrams.md n'existe pas dans event-model.md ni dans domain-model.md.",
    ]);
  });

  it("modèle d'événements absent : rejet", () => {
    const docs = { ...input().docs };
    delete (docs as Record<string, string>)["event-model.md"];
    expect(checkDesign(input({ docs }))).toEqual(expect.arrayContaining(["Document de conception manquant : event-model.md."]));
  });

  it("ADR existant modifié : rejet (append-only)", () => {
    expect(checkDesign(input({ modifiedExistingAdrs: ["docs/adr/adr-001-decision-1.md"] }))).toEqual([
      "ADR existant modifié : docs/adr/adr-001-decision-1.md (les ADR sont append-only ; en rédiger un nouveau qui le remplace).",
    ]);
  });

  it("nouvel ADR : champ manquant ou statut autre que Proposed", () => {
    const broken = adr(2).replace(/## Alternatives[\s\S]*$/, "");
    const first = { path: "docs/adr/adr-001-decision-1.md", md: adr(1), isNew: false };
    expect(checkDesign(input({ adrs: [first, { path: "docs/adr/adr-002-x.md", md: broken, isNew: true }] }))).toEqual(["docs/adr/adr-002-x.md : section manquante « Alternatives »."]);
    const accepted = adr(2).replace("Statut : Proposed", "Statut : Accepted");
    expect(checkDesign(input({ adrs: [first, { path: "docs/adr/adr-002-x.md", md: accepted, isNew: true }] }))).toEqual(["docs/adr/adr-002-x.md : statut Accepted, Proposed attendu."]);
  });

  it("numérotation : trou ou doublon", () => {
    expect(checkDesign(input({ adrs: [{ path: "a1", md: adr(1), isNew: false }, { path: "a3", md: adr(3), isNew: true }] }))).toEqual(["Numérotation des ADR : ADR-002 manque."]);
    expect(checkDesign(input({ adrs: [{ path: "a1", md: adr(1), isNew: false }, { path: "a1b", md: adr(1), isNew: true }] }))).toEqual(["Numérotation des ADR : ADR-001 en double."]);
  });

  it("un trou déjà présent dans le dépôt n'est pas reproché à la phase", () => {
    // ADR-002 a été archivé avant cette story : l'agent ne peut pas le recréer, et le lui
    // reprocher ferait échouer DESIGN jusqu'à épuisement du budget, sur chaque tentative.
    const existants = [
      { path: "a1", md: adr(1), isNew: false },
      { path: "a3", md: adr(3), isNew: false },
    ];
    expect(checkDesign(input({ adrs: existants }))).toEqual([]);
    // En revanche, le nouvel ADR doit bien prendre le numéro suivant.
    expect(checkDesign(input({ adrs: [...existants, { path: "a4", md: adr(4), isNew: true }] }))).toEqual([]);
    expect(checkDesign(input({ adrs: [...existants, { path: "a6", md: adr(6), isNew: true }] }))).toEqual([
      "Numérotation des ADR : ADR-004 manque.",
      "Numérotation des ADR : ADR-005 manque.",
    ]);
  });

  it("remplacement : présent dans le nouvel ADR ET dans supersessions.md", () => {
    const adrs = [
      { path: "a1", md: adr(1), isNew: false },
      { path: "a2", md: adr(2, { supersedes: ["ADR-001"] }), isNew: true },
    ];
    expect(checkDesign(input({ adrs }))).toEqual(["ADR-002 remplace ADR-001 mais le registre supersessions.md ne le mentionne pas."]);
    expect(checkDesign(input({ adrs, supersessions: supersessionLine("ADR-002", "ADR-001") }))).toEqual([]);
    expect(checkDesign(input({ supersessions: supersessionLine("ADR-002", "ADR-001") }))).toEqual([
      "supersessions.md indique qu'ADR-002 remplace ADR-001, mais ADR-002 ne le déclare pas.",
    ]);
  });
});

/**
 * Deux anti-patrons d'ADR portés en code depuis les skills reprises : le verdict inscrit dans le
 * nom de fichier (`architecture-review-criteria` G14) et l'ADR de « bonne pratique »
 * (`adr-eligibility-gate`, Q2). Ils sont reconnaissables sans interprétation ; le reste de ces
 * skills reste du jugement, et appartient aux lentilles.
 *
 * DESIGN est la phase où nous avons le moins de portes : chaque règle mécanisable y compte double.
 */
describe("Anti-patrons d'ADR reconnaissables sans interprétation", () => {
  const avecAdr = (path: string, titre: string) =>
    checkDesign(input({ adrs: [{ path, md: adr(1, { title: titre }), isNew: true }] }));

  it.each(["docs/adr/adr-001-event-sourcing-rejected.md", "docs/adr/adr-001-cqrs-accepted.md", "docs/adr/adr-001-saga-deprecated.md", "docs/adr/adr-001-x-superseded.md"])(
    "le verdict dans le nom de fichier est refusé : %s",
    (path) => {
      const r = avecAdr(path, "Event Sourcing");
      expect(r.join(" ")).toMatch(/nom de fichier|verdict/i);
      // Le motif doit dire où le verdict a sa place, sinon l'agent renomme au hasard.
      expect(r.join(" ")).toMatch(/Statut/);
    },
  );

  it("un nom de fichier qui décrit le sujet passe", () => {
    expect(avecAdr("docs/adr/adr-001-event-sourcing.md", "Event Sourcing")).toEqual([]);
  });

  it("un sujet qui contient un mot proche du verdict n'est pas refusé", () => {
    // « rejet » est ici le sujet de la décision, pas son verdict.
    expect(avecAdr("docs/adr/adr-001-rejet-des-paiements.md", "Rejet des paiements")).toEqual([]);
  });

  it.each(["Ne pas utiliser de variables globales", "Éviter le couplage fort", "Toujours valider aux frontières", "Avoid hardcoded values", "No hardcoded phase names"])(
    "un ADR de « bonne pratique » est refusé : %s",
    (titre) => {
      const r = avecAdr("docs/adr/adr-001-sujet.md", titre);
      expect(r.join(" ")).toMatch(/bonne pratique|décision/i);
    },
  );

  it("un titre qui nomme une décision passe", () => {
    for (const titre of ["Event Sourcing pour le journal des paiements", "Découpage domaine / application", "Résultat typé plutôt qu'exception"])
      expect(avecAdr("docs/adr/adr-001-sujet.md", titre), titre).toEqual([]);
  });
});
