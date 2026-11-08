/**
 * Plusieurs rapports de tests pour une seule commande (jeton `{rapports}`, ADR 0072 révisé le 08/11).
 * Une commande qui lance plusieurs projets de test (une solution .NET, un build multi-module) écrit
 * un rapport par projet : avec un seul fichier `{rapport}`, le dernier écrasait les autres, et les
 * portes jugeaient sans les tests disparus. Le code donne un dossier, et réunit tout ce qu'il y trouve.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCanaries } from "../src/profile/canaries.js";
import { createProfileAdapter } from "../src/profile/profile-adapter.js";
import { parseStackProfile } from "../src/profile/stack-profile.js";
import type { ProcessResult, ProcessRunner } from "../src/protocols.js";

const profil = (commande: string, autres = "") => {
  const r = parseStackProfile(
    `
id: dotnet
detect: [x.sln]
tests:
  command: ${commande}
  report: junit-xml
${autres}
layout:
  acceptanceTests: []
  unitTests: ["tests/**"]
  sources: ["src/**"]
infrastructureModules: []
buildErrors:
  pattern: '^(?<file>[^\\s(]+\\.cs)\\(\\d+,\\d+\\): (?<message>error \\w+: .*)$'
  missingSymbol: ["error CS0103"]
`,
    { allowedPrograms: ["dotnet"] },
  );
  if ("error" in r) throw new Error(r.error);
  return r.profile;
};
const AVEC_RAPPORTS = profil(`[dotnet, test, "--logger", "junit;LogFilePath={rapports}/{assembly}.xml"]`);
const AVEC_RAPPORT = profil(`[dotnet, test, "--logger", "junit;LogFilePath={rapport}"]`);

const junit = (classe: string, ...noms: string[]) =>
  `<?xml version="1.0"?><testsuites><testsuite>${noms.map((n) => `<testcase classname="${classe}" name="${n}"/>`).join("")}</testsuite></testsuites>`;
const sortie = (over: Partial<ProcessResult> = {}): ProcessResult => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1, ...over });
/** Le dossier passé à la place de `{rapports}`, tiré de l'argument `junit;LogFilePath=<dossier>/{assembly}.xml`. */
const dossierDe = (args: readonly string[]) => args.find((a) => a.includes("LogFilePath="))!.replace(/^.*LogFilePath=/, "").replace(/\/\{assembly\}\.xml$/, "");
const ERREUR_CS = "tests/Tarification.Tests/PanierTests.cs(12,9): error CS0103: Le nom 'Remise' n'existe pas dans le contexte actuel";

function runner(agir: (args: readonly string[]) => Promise<ProcessResult>) {
  const appels: string[][] = [];
  const r: ProcessRunner & { appels: string[][] } = {
    appels,
    async run(_cmd, args) {
      appels.push([...args]);
      return agir(args);
    },
  };
  return r;
}

let racine: string;
beforeEach(async () => {
  racine = await mkdtemp(join(tmpdir(), "agent-studio-rapports-"));
});
afterEach(() => rm(racine, { recursive: true, force: true }));

describe("Le jeton {rapports} dans un profil", () => {
  it("est accepté dans la commande de test", () => {
    expect(AVEC_RAPPORTS.tests.command).toContain("junit;LogFilePath={rapports}/{assembly}.xml");
  });

  it("est refusé avec {rapport} dans la même commande : on ne saurait pas lequel lire", () => {
    const r = parseStackProfile(
      `
id: x
detect: [x]
tests:
  command: [dotnet, test, "{rapport}", "{rapports}"]
  report: junit-xml
layout: { acceptanceTests: [], unitTests: ["tests/**"], sources: ["src/**"] }
infrastructureModules: []
`,
      { allowedPrograms: ["dotnet"] },
    );
    expect("error" in r ? r.error : null).toMatch(/\{rapport\}.*\{rapports\}|\{rapports\}.*\{rapport\}/);
  });

  it("est refusé dans le lint, lu sur la sortie standard", () => {
    const r = parseStackProfile(
      `
id: x
detect: [x]
tests: { command: [dotnet, test, "{rapport}"], report: junit-xml }
lint: { command: [dotnet, lint, "{rapports}"], report: eslint-json }
layout: { acceptanceTests: [], unitTests: ["tests/**"], sources: ["src/**"] }
infrastructureModules: []
`,
      { allowedPrograms: ["dotnet"] },
    );
    expect("error" in r ? r.error : null).toMatch(/\{rapports\}/);
  });
});

describe("L'adaptateur avec {rapports}", () => {
  it("donne un dossier vide, hors du projet, et laisse intact ce que le profil met autour", async () => {
    let vu = "";
    const r = runner(async (args) => {
      vu = dossierDe(args);
      expect(existsSync(vu)).toBe(true);
      expect(await readdir(vu)).toEqual([]);
      await writeFile(join(vu, "A.xml"), junit("A", "t"));
      return sortie();
    });
    await createProfileAdapter(AVEC_RAPPORTS, { runner: r }).runTests({ root: racine });
    expect(r.appels[0]!.at(-1)).toBe(`junit;LogFilePath=${vu}/{assembly}.xml`);
    expect(vu.startsWith(racine)).toBe(false);
    // Retiré après la lecture : il ne doit rien laisser derrière lui.
    expect(existsSync(vu)).toBe(false);
  });

  it("réunit tous les rapports écrits dans le dossier, y compris dans un sous-dossier", async () => {
    const r = runner(async (args) => {
      const d = dossierDe(args);
      await writeFile(join(d, "Tarification.UnitTests.xml"), junit("Features.PanierFeature", "AC_1LeClientChiffre", "AC_2LeClientChiffre"));
      await mkdir(join(d, "net10.0"));
      await writeFile(join(d, "net10.0", "Tarification.Tests.xml"), junit("Tarification.Tests.CalculDuPanierTests", "Une_quantite_nulle"));
      return sortie();
    });
    const run = await createProfileAdapter(AVEC_RAPPORTS, { runner: r }).runTests({ root: racine });
    expect(run.results.map((x) => x.id).sort()).toEqual([
      "Features.PanierFeature.AC_1LeClientChiffre",
      "Features.PanierFeature.AC_2LeClientChiffre",
      "Tarification.Tests.CalculDuPanierTests.Une_quantite_nulle",
    ]);
  });

  it("un dossier resté vide vaut un rapport absent : les erreurs de compilation sont lues", async () => {
    const r = runner(async () => sortie({ exitCode: 1, stdout: `${ERREUR_CS}\n` }));
    const run = await createProfileAdapter(AVEC_RAPPORTS, { runner: r }).runTests({ root: racine });
    expect(run.results).toHaveLength(1);
    expect(run.results[0]!.failureKind).toBe("missing_symbol");
  });

  it("un dossier resté vide, sans erreur de compilation lisible, est une erreur qui nomme {rapports}", async () => {
    const r = runner(async () => sortie({ exitCode: 1 }));
    await expect(createProfileAdapter(AVEC_RAPPORTS, { runner: r }).runTests({ root: racine })).rejects.toThrow(/\{rapports\}/);
  });
});

describe("Un projet qui ne compile pas à côté d'un projet qui a tourné", () => {
  // Un symbole absent arrête la compilation d'UN projet : lui seul ne produit pas de rapport, l'autre
  // si. Lire les erreurs de compilation seulement en l'absence de tout rapport effaçait ce rouge,
  // le plus courant du pas RED.
  it("avec {rapports}, les erreurs de compilation s'ajoutent aux rapports présents", async () => {
    const r = runner(async (args) => {
      await writeFile(join(dossierDe(args), "Tarification.UnitTests.xml"), junit("Features.PanierFeature", "AC_1LeClientChiffre"));
      return sortie({ exitCode: 1, stdout: `${ERREUR_CS}\n` });
    });
    const run = await createProfileAdapter(AVEC_RAPPORTS, { runner: r }).runTests({ root: racine });
    expect(run.results.map((x) => x.status)).toEqual(["passed", "failed"]);
    expect(run.results[1]!.failureKind).toBe("missing_symbol");
  });

  it("avec {rapport}, de même", async () => {
    const r = runner(async (args) => {
      const fichier = args.find((a) => a.includes("LogFilePath="))!.replace(/^.*LogFilePath=/, "");
      await writeFile(fichier, junit("Features.PanierFeature", "AC_1LeClientChiffre"));
      return sortie({ exitCode: 1, stdout: `${ERREUR_CS}\n` });
    });
    const run = await createProfileAdapter(AVEC_RAPPORT, { runner: r }).runTests({ root: racine });
    expect(run.results.map((x) => x.status)).toEqual(["passed", "failed"]);
  });
});

describe("Les canaris de /stack doctor lancent la commande comme l'adaptateur", () => {
  it("avec {rapports}, le relevé initial compte les tests de tous les rapports", async () => {
    const r = runner(async (args) => {
      const d = dossierDe(args);
      await writeFile(join(d, "A.xml"), junit("A", "un", "deux", "trois"));
      await writeFile(join(d, "B.xml"), junit("B", "quatre", "cinq"));
      return sortie();
    });
    const { constats } = await runCanaries(AVEC_RAPPORTS, { runner: r, sandboxRoot: racine });
    expect(constats[0]!.message).toContain("5 test(s) relevé(s)");
  });

  it("`{couverture}` reçoit un vrai dossier : vide, `dotnet test --results-directory \"\"` plante", async () => {
    const p = profil(`[dotnet, test, "--logger", "junit;LogFilePath={rapport}", --results-directory, "{couverture}"]`, "");
    const avecCouverture = { ...p, tests: { ...p.tests, coverage: "cobertura-xml" as const } };
    const r = runner(async (args) => {
      const fichier = args.find((a) => a.includes("LogFilePath="))!.replace(/^.*LogFilePath=/, "");
      await writeFile(fichier, junit("A", "un"));
      return sortie();
    });
    await runCanaries(avecCouverture, { runner: r, sandboxRoot: racine });
    const couverture = r.appels[0]![r.appels[0]!.indexOf("--results-directory") + 1];
    expect(couverture).not.toBe("");
  });
});

describe("Plusieurs rapports de couverture pour une seule commande", () => {
  // `dotnet test --collect` écrit un rapport Cobertura par projet de test. Ne lire que le premier
  // faisait voir à la porte de couverture la moitié des lignes couvertes.
  const cobertura = (fichier: string, lignes: [number, number][]) =>
    `<?xml version="1.0"?><coverage><packages><package name="p"><classes><class name="C" filename="${fichier}"><lines>${lignes
      .map(([n, hits]) => `<line number="${n}" hits="${hits}"/>`)
      .join("")}</lines></class></classes></package></packages></coverage>`;

  it("réunit les lignes : une ligne est couverte si l'un des rapports la couvre", async () => {
    const p = profil(`[dotnet, test, "--logger", "junit;LogFilePath={rapports}/{assembly}.xml", --results-directory, "{couverture}"]`);
    const avecCouverture = { ...p, tests: { ...p.tests, coverage: "cobertura-xml" as const } };
    const r = runner(async (args) => {
      await writeFile(join(dossierDe(args), "A.xml"), junit("A", "un"));
      const c = args[args.indexOf("--results-directory") + 1]!;
      await mkdir(join(c, "guid-1"));
      await mkdir(join(c, "guid-2"));
      await writeFile(join(c, "guid-1", "coverage.cobertura.xml"), cobertura("src/Panier.cs", [[1, 1], [2, 0], [3, 0]]));
      await writeFile(join(c, "guid-2", "coverage.cobertura.xml"), cobertura("src/Panier.cs", [[1, 0], [2, 3], [3, 0]]));
      return sortie();
    });
    const run = await createProfileAdapter(avecCouverture, { runner: r }).runTests({ root: racine });
    const panier = run.coverage!.files.find((f) => f.file.endsWith("Panier.cs"))!;
    expect({ covered: panier.covered, total: panier.total, score: panier.score }).toEqual({ covered: 2, total: 3, score: 66.7 });
  });
});
