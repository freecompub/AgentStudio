/**
 * Lecteur du rapport JSON de Stryker (schéma `mutation-testing-elements`, partagé par Stryker.NET,
 * StrykerJS et Stryker4s). La référence est un rapport RÉEL : Stryker.NET 5.0.0 sur le code livré
 * d'US-2 le 03/10 (projet d'essai .NET), chemins anonymisés sous `/projet`.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStrykerReport } from "../src/mutation/stryker-report.js";

const reel = async () => JSON.parse(await readFile(join(import.meta.dirname, "fixtures/stryker-net-us2.json"), "utf8"));

describe("parseStrykerReport", () => {
  it("retrouve le score que Stryker a affiché : 72 %", async () => {
    // Tués (et délais dépassés) sur tués + survivants + non couverts ; les erreurs de compilation
    // et les mutants ignorés ne comptent pas — c'est le calcul de Stryker.
    expect((await parseStrykerReport(await reel(), "/projet")).score).toBe(72);
  });

  it("score et survivants par fichier, chemins relatifs à la racine du projet", async () => {
    const r = parseStrykerReport(await reel(), "/projet");
    const montant = r.files.find((f) => f.file === "src/Tarification.Domaine/Montant.cs")!;
    expect(montant.score).toBeCloseTo((10 / 15) * 100, 5);
    expect(montant.survived).toHaveLength(5);
    expect(montant.survived.filter((s) => s.operator.endsWith("(non couvert)"))).toHaveLength(2);
    expect(montant.survived.every((s) => s.line > 0)).toBe(true);
    expect(r.files.find((f) => f.file === "src/Tarification.Domaine/GrilleDePaliers.cs")).toMatchObject({ score: 100, survived: [] });
  });

  it("tués et jugés par fichier, et remplacement de chaque survivant : de quoi retirer un mutant du score (D22 de docs/12)", async () => {
    const montant = parseStrykerReport(await reel(), "/projet").files.find((f) => f.file === "src/Tarification.Domaine/Montant.cs")!;
    expect(montant).toMatchObject({ killed: 10, total: 15 });
    expect(montant.survived.every((s) => typeof s.replacement === "string" || s.replacement === undefined)).toBe(true);
    expect(montant.survived.some((s) => typeof s.replacement === "string" && s.replacement.length > 0)).toBe(true);
  });

  it("un fichier sans mutant testable est absent : rien n'y a été mesuré", async () => {
    // LigneDePanier.cs : trois mutants, tous en erreur de compilation.
    const r = parseStrykerReport(await reel(), "/projet");
    expect(r.files.map((f) => f.file)).not.toContain("src/Tarification.Domaine/LigneDePanier.cs");
    expect(r.files.map((f) => f.file)).not.toContain("src/Tarification.Domaine/Palier.cs");
  });

  it("un rapport qui n'a pas la forme attendue est refusé, jamais lu à moitié", () => {
    expect(() => parseStrykerReport({ files: { "a.cs": { mutants: [{ status: "Killed" }] } } }, "/projet")).toThrow(/Stryker/);
    expect(() => parseStrykerReport({ score: 3 }, "/projet")).toThrow(/Stryker/);
  });
});
