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
