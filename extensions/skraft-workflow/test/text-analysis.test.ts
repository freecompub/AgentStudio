// Copie de extensions/skraft/test/text-analysis.test.ts (2026-10-08) : elle protège la copie du module.
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

describe("Noms déclarés par un contrat (garde du contrat ratifié, ADR 0047)", async () => {
  const { declaredIdentifiers } = await import("../src/text-analysis.js");

  it("ne retient que les noms des blocs délimités, pas ceux du texte ni des backticks en ligne", () => {
    const md = "Le `Panier` en ligne.\n\n```\npublic Montant Soustrait(Montant autre);\n```\n\nPuis du texte : PalierApplicable(x).";
    expect(declaredIdentifiers(md)).toEqual(["Soustrait"]);
  });

  it("retient les types, méthodes et propriétés DÉCLARÉS, pas les noms seulement utilisés", () => {
    // Revue de code du 03/10 : prendre tout mot capitalisé gardait `List`, `ArgumentException`…, et
    // une correction légitime retirant leur dernier usage aurait été refusée.
    const md = [
      "```",
      "public readonly record struct Taux",
      "{",
      "    public decimal Valeur { get; }",
      "    public static Taux De(decimal valeur); // lève ArgumentOutOfRangeException si valeur < 0",
      "}",
      "public sealed class GrilleDePaliers",
      "{",
      "    public static GrilleDePaliers De(IEnumerable<Palier> paliers);",
      "    public Palier? PalierApplicable(Quantite quantite);",
      "}",
      "public Montant SommeDesRemises(GrilleDePaliers grille) =>",
      "    _lignes.Aggregate(Montant.Zero, (total, l) => total + l.Remise(grille));",
      "public Montant ATPayer => SommeDesArticles.Soustrait(Remise) + FraisDePort;",
      "```",
    ].join("\n");
    expect(declaredIdentifiers(md).sort()).toEqual(["ATPayer", "De", "GrilleDePaliers", "PalierApplicable", "SommeDesRemises", "Taux", "Valeur"]);
  });
});
