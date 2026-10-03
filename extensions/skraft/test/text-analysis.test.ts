import { describe, expect, it } from "vitest";
import { extractPascalIdentifiers, parseCitations } from "../src/text-analysis.js";

describe("Citations (porte citations, §7.1)", () => {
  it("chemins avec ou sans plage de lignes, URL ; ignore le reste", () => {
    const md = `Voir \`Sources/Bolus/BolusCalculator.swift:40-72\` et Sources/Settings/Max.swift:3.
Le fichier Package.swift définit les modules. Doc : https://developer.apple.com/xctest et http://mal formée.
Version 1.2.3 ou « 12,5 U » ne sont pas des chemins.`;
    expect(parseCitations(md)).toEqual({
      paths: [
        { path: "Sources/Bolus/BolusCalculator.swift", start: 40, end: 72 },
        { path: "Sources/Settings/Max.swift", start: 3, end: 3 },
        { path: "Package.swift" },
      ],
      urls: ["https://developer.apple.com/xctest", "http://mal"],
    });
  });

  it("plage inversée conservée telle quelle (la porte la rejettera)", () => {
    expect(parseCitations("`a/b.ts:9-3`").paths).toEqual([{ path: "a/b.ts", start: 9, end: 3 }]);
  });
});

describe("Identifiants PascalCase entre backticks (porte cohérence, §7.2)", () => {
  it("n'extrait que les identifiants en PascalCase entre backticks, sans doublon", () => {
    const md = "L'événement `BolusCapped` suit `CapBolus` ; `bolusCapped`, BolusLimited et `MaxBolus.value` ne comptent pas. Encore `BolusCapped`.";
    expect(extractPascalIdentifiers(md)).toEqual(["BolusCapped", "CapBolus"]);
  });
});

describe("Identifiants des blocs de code (garde du contrat ratifié, ADR 0047)", async () => {
  const { fencedIdentifiers } = await import("../src/text-analysis.js");
  it("ne retient que les noms des blocs délimités, pas ceux du texte ni des backticks en ligne", () => {
    const md = "Le `Panier` et `Facture` en ligne.\n\n```\npublic Montant Soustrait(Montant autre);\npublic static Taux De(decimal valeur);\n```\n\nPuis du texte : PalierApplicable.";
    expect(fencedIdentifiers(md).sort()).toEqual(["De", "Montant", "Soustrait", "Taux"]);
  });
});
