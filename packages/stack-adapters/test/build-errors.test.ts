/**
 * Lecture des erreurs de compilation déclarées par un profil (J5).
 *
 * Pourquoi c'est nécessaire : dans un langage compilé, un symbole absent **empêche la
 * compilation**. Le lanceur ne produit alors aucun rapport de tests, et l'adaptateur générique
 * n'avait qu'une exception à offrir. Conséquence, c'est tout le cycle TDD qui devenait
 * impraticable : le rouge légitime du pas RED — « la fonction que je viens d'appeler n'existe pas
 * encore » — n'atteignait jamais la porte.
 *
 * Le motif vient du dépôt du projet, donc d'une source non fiable : il est appliqué ligne à ligne,
 * sur des lignes et un nombre de lignes bornés, et les motifs manifestement explosifs sont refusés.
 */
import { describe, expect, it } from "vitest";
import { compileBuildErrorSpec, readBuildErrors } from "../src/profile/build-errors.js";

const CSHARP = {
  pattern: String.raw`^(?<file>[^\s(]+\.cs)\(\d+,\d+\): error (?<message>.*)$`,
  missingSymbol: ["CS0103", "CS0246", "CS0117"],
};

const compile = (spec: { pattern: string; missingSymbol?: string[] }) => {
  const r = compileBuildErrorSpec(spec);
  if ("error" in r) throw new Error(r.error);
  return r.spec;
};

const SORTIE_CSHARP = [
  "  Determining projects to restore...",
  "/p/Tests/BolusTests.cs(12,9): error CS0103: The name 'plafonner' does not exist in the current context",
  "/p/Tests/BolusTests.cs(14,2): error CS1513: } expected",
  "/p/Sources/Autre.cs(3,1): error CS0246: The type or namespace name 'Manquant' could not be found",
  "Build FAILED.",
].join("\n");

describe("readBuildErrors", () => {
  it("rend un résultat par fichier en erreur, avec son chemin relatif", () => {
    const r = readBuildErrors(SORTIE_CSHARP, compile(CSHARP), "/p");
    expect(r.map((x) => x.file)).toEqual(["Tests/BolusTests.cs", "Sources/Autre.cs"]);
    expect(r.every((x) => x.status === "failed")).toBe(true);
  });

  it("classe un symbole absent en `missing_symbol` : c'est le rouge légitime du cycle TDD", () => {
    const r = readBuildErrors(SORTIE_CSHARP, compile(CSHARP), "/p");
    expect(r.find((x) => x.file === "Tests/BolusTests.cs")?.failureKind).toBe("missing_symbol");
    expect(r.find((x) => x.file === "Sources/Autre.cs")?.failureKind).toBe("missing_symbol");
  });

  it("classe le reste en `other_error` : une erreur de syntaxe ne doit pas franchir la porte RED", () => {
    const sortie = "/p/Tests/A.cs(4,2): error CS1513: } expected";
    expect(readBuildErrors(sortie, compile(CSHARP), "/p")[0]?.failureKind).toBe("other_error");
  });

  it("la première erreur d'un fichier l'emporte : c'est celle qui décrit la cause", () => {
    // Les suivantes en découlent presque toujours (cascade du compilateur).
    const r = readBuildErrors(SORTIE_CSHARP, compile(CSHARP), "/p");
    expect(r.find((x) => x.file === "Tests/BolusTests.cs")?.message).toMatch(/The name 'plafonner'/);
  });

  it("une sortie sans erreur reconnue ne rend rien, plutôt que d'inventer un résultat", () => {
    expect(readBuildErrors("Build succeeded.\n    0 Error(s)", compile(CSHARP), "/p")).toEqual([]);
  });

  it("l'identifiant reste le fichier : c'est tout ce qu'on sait quand la suite n'a pas chargé", () => {
    const r = readBuildErrors(SORTIE_CSHARP, compile(CSHARP), "/p");
    expect(r[0]?.id).toBe("Tests/BolusTests.cs");
  });
});

describe("compileBuildErrorSpec — le motif vient du dépôt, donc d'une source non fiable", () => {
  const refus = (spec: { pattern: string; missingSymbol?: string[] }) => {
    const r = compileBuildErrorSpec(spec);
    return "error" in r ? r.error : null;
  };

  it("les groupes nommés `file` et `message` sont obligatoires", () => {
    expect(refus({ pattern: String.raw`^(.+\.cs): error (.*)$` })).toMatch(/file.*message|groupe/i);
  });

  it("un motif invalide est refusé avec sa raison, pas par une exception", () => {
    // Les deux groupes sont nommés — le contrôle textuel passe — mais la classe `[` reste ouverte.
    expect(refus({ pattern: "^(?<file>[):(?<message>.*)$" })).toMatch(/expression régulière/i);
  });

  it("un quantificateur imbriqué est refusé : c'est la forme qui fait exploser le moteur", () => {
    expect(refus({ pattern: String.raw`^(?<file>(\w+)+):(?<message>.*)$` })).toMatch(/imbriqu/i);
  });

  it("un motif démesuré est refusé", () => {
    expect(refus({ pattern: `^(?<file>${"a|".repeat(200)}x)(?<message>.*)$` })).toMatch(/long/i);
  });

  it("un motif honnête est accepté", () => {
    expect(refus(CSHARP)).toBeNull();
  });
});

describe("Bornes d'exécution, pour qu'un motif hostile ne puisse pas figer l'application", () => {
  it("une ligne démesurée est ignorée plutôt que soumise au moteur", () => {
    const ligne = `/p/${"a".repeat(5000)}.cs(1,1): error CS0103: The name 'x' does not exist`;
    const debut = Date.now();
    expect(readBuildErrors(ligne, compile(CSHARP), "/p")).toEqual([]);
    expect(Date.now() - debut).toBeLessThan(500);
  });

  it("une sortie de dizaines de milliers de lignes reste immédiate", () => {
    const sortie = Array.from({ length: 50_000 }, (_, i) => `/p/F${i}.cs(1,1): error CS0103: The name 'x' does not exist`).join("\n");
    const debut = Date.now();
    const r = readBuildErrors(sortie, compile(CSHARP), "/p");
    expect(Date.now() - debut).toBeLessThan(2000);
    // Bornée : on ne rend pas cinquante mille résultats à une porte.
    expect(r.length).toBeLessThanOrEqual(200);
  });
});
