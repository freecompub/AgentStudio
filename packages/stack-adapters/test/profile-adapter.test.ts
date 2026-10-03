/**
 * Adaptateur générique (J5, brique 2) : il exécute ce qu'un profil déclare, sans rien savoir du
 * langage. C'est lui qui doit remplacer, à terme, les adaptateurs écrits à la main.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProfileAdapter } from "../src/profile/profile-adapter.js";
import { parseStackProfile } from "../src/profile/stack-profile.js";
import type { ProcessResult, ProcessRunner } from "../src/protocols.js";

const PROFIL = `
id: python
detect: [pyproject.toml]
tests:
  command: [pytest, "--junit-xml={rapport}"]
  report: junit-xml
lint:
  command: [eslint, --format, json, "--", "{fichiers}"]
  report: eslint-json
layout:
  acceptanceTests: ["tests/acceptance/**"]
  unitTests: ["tests/**"]
  sources: ["src/**"]
infrastructureModules: [django]
`;

const profil = () => {
  const r = parseStackProfile(PROFIL, { allowedPrograms: ["pytest", "eslint"] });
  if ("error" in r) throw new Error(r.error);
  return r.profile;
};

const sortie = (over: Partial<ProcessResult> = {}): ProcessResult => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1, ...over });

function runner(reponse: ProcessResult | ((cmd: string, args: readonly string[]) => ProcessResult | Promise<ProcessResult>)) {
  const appels: { cmd: string; args: string[] }[] = [];
  const r: ProcessRunner & { appels: typeof appels } = {
    appels,
    async run(cmd, args) {
      appels.push({ cmd, args: [...args] });
      return typeof reponse === "function" ? reponse(cmd, args) : reponse;
    },
  };
  return r;
}

let racine: string;
beforeEach(async () => {
  racine = await mkdtemp(join(tmpdir(), "agent-studio-profil-"));
});
afterEach(() => rm(racine, { recursive: true, force: true }));

describe("Un profil sans emplacement de test ne peut pas rendre tout le projet testable", () => {
  const SANS_TESTS = `
id: python
detect: [pyproject.toml]
tests:
  command: [pytest, "--junit-xml={rapport}"]
  report: junit-xml
layout:
  sources: ["src/**"]
infrastructureModules: []
`;

  it("le profil est refusé : sans emplacement de test, la porte RED n'a plus de périmètre", () => {
    const r = parseStackProfile(SANS_TESTS, { allowedPrograms: ["pytest"] });
    expect("error" in r ? r.error : null).toMatch(/unitTests|acceptanceTests/);
  });

  it("et si un tel profil passait quand même, son motif ne doit RIEN reconnaître", () => {
    // `[].join("|")` rend la chaîne vide, et `new RegExp("")` reconnaît TOUT : l'extension
    // (extension-host/src/child/runtime.ts) reconstruit un RegExp depuis ce motif, si bien que
    // `isTestFile` y renverrait vrai pour chaque fichier — la garde d'écriture de la phase rouge
    // deviendrait inopérante, et l'adaptateur se contredirait lui-même.
    const a = createProfileAdapter({ ...profil(), layout: { acceptanceTests: [], unitTests: [], sources: ["src/**"] } });
    expect(new RegExp(a.testFilePattern).test("src/domaine.py")).toBe(false);
    expect(a.isTestFile("src/domaine.py")).toBe(false);
  });
});

describe("Adaptateur bâti sur un profil", () => {
  it("reprend l'identité, les emplacements et l'infrastructure déclarés", () => {
    const a = createProfileAdapter(profil(), { runner: runner(sortie()) });
    expect(a.id).toBe("python");
    expect(a.layout.unitTests).toEqual(["tests/**"]);
    expect(a.infrastructureModules).toEqual(["django"]);
  });

  it("reconnaît le projet aux fichiers déclarés", async () => {
    const a = createProfileAdapter(profil(), { runner: runner(sortie()) });
    expect(await a.detect(racine)).toBe(false);
    await writeFile(join(racine, "pyproject.toml"), "");
    expect(await a.detect(racine)).toBe(true);
  });

  it("lance la commande déclarée, en substituant le fichier de rapport", async () => {
    const run = runner(sortie());
    const a = createProfileAdapter(profil(), { runner: run });
    await a.runTests({ root: racine }).catch(() => undefined); // le rapport n'existe pas : peu importe ici
    expect(run.appels[0]?.cmd).toBe("pytest");
    const arg = run.appels[0]!.args[0]!;
    expect(arg.startsWith("--junit-xml=")).toBe(true);
    expect(arg).not.toContain("{rapport}");
  });

  it("lit le rapport au format déclaré", async () => {
    const junit = `<?xml version="1.0"?><testsuites><testsuite name="s"><testcase classname="C" name="a"/><testcase classname="C" name="b"><failure message="boum">x</failure></testcase></testsuite></testsuites>`;
    const run = runner(async (_c, args) => {
      const cible = args.find((x) => x.startsWith("--junit-xml="))!.slice("--junit-xml=".length);
      await writeFile(cible, junit);
      return sortie();
    });
    const a = createProfileAdapter(profil(), { runner: run });
    const r = await a.runTests({ root: racine });
    expect(r.results.map((x) => x.status)).toEqual(["passed", "failed"]);
  });

  it("classe la raison de l'échec : la porte RED en dépend", async () => {
    // `verifyUnitRed` refuse un rouge qui n'est ni une assertion ni un symbole manquant. Sans
    // `failureKind`, sa condition `=== "other_error"` est fausse et une erreur de syntaxe passe
    // pour un rouge valide : la porte devient aveugle.
    const junit = `<?xml version="1.0"?><testsuites><testsuite name="s">
      <testcase classname="C" name="assertion"><failure message="XCTAssertEqual failed: 1 is not equal to 2">x</failure></testcase>
      <testcase classname="C" name="syntaxe"><failure message="expected declaration">y</failure></testcase>
    </testsuite></testsuites>`;
    const run = runner(async (_c, args) => {
      const cible = args.find((x) => x.startsWith("--junit-xml="))!.slice("--junit-xml=".length);
      await writeFile(cible, junit);
      return sortie();
    });
    const r = await createProfileAdapter(profil(), { runner: run }).runTests({ root: racine });
    expect(r.results.map((x) => x.failureKind)).toEqual(["assertion", "other_error"]);
    expect(r.results[0]?.message).toMatch(/XCTAssertEqual/);
  });

  it("le lint substitue les fichiers demandés", async () => {
    const run = runner(sortie({ stdout: "[]" }));
    const a = createProfileAdapter(profil(), { runner: run });
    await a.lint!({ root: racine, files: ["src/a.py", "src/b.py"] });
    expect(run.appels[0]?.args).toEqual(["--format", "json", "--", "src/a.py", "src/b.py"]);
  });

  it("une capacité non déclarée n'existe pas", () => {
    const sansMutation = createProfileAdapter(profil(), { runner: runner(sortie()) });
    expect(sansMutation.mutation).toBeUndefined();
    expect(sansMutation.lint).toBeDefined();
  });

  it("les fichiers de test sont reconnus d'après les emplacements déclarés", () => {
    const a = createProfileAdapter(profil(), { runner: runner(sortie()) });
    expect(a.isTestFile("tests/test_bolus.py")).toBe(true);
    expect(a.isTestFile("src/bolus.py")).toBe(false);
  });
});

/**
 * Mutation avec Stryker.NET : l'outil écrit dans un DOSSIER de sortie (`--output`), sous
 * `reports/mutation-report.json`. Le jeton `{dossier}` lui en donne un, hors du projet.
 */
describe("Mutation par Stryker (rapport stryker-json, jeton {dossier})", () => {
  const STRYKER = `
id: dotnet
detect: [Tarification.sln]
tests:
  command: [dotnet, test, "--logger", "junit;LogFilePath={rapport}"]
  report: junit-xml
mutation:
  command: [dotnet, stryker, --solution, Tarification.sln, --reporter, json, --output, "{dossier}"]
  report: stryker-json
layout:
  unitTests: ["tests/**/*.cs"]
  sources: ["src/**/*.cs"]
`;

  it("le profil accepte stryker-json pour la mutation", () => {
    const r = parseStackProfile(STRYKER, { allowedPrograms: ["dotnet"] });
    expect("error" in r ? r.error : "ok").toBe("ok");
  });

  it("l'adaptateur donne un dossier hors du projet et lit le rapport que l'outil y range", async () => {
    const r = parseStackProfile(STRYKER, { allowedPrograms: ["dotnet"] });
    if ("error" in r) throw new Error(r.error);
    const { mkdir } = await import("node:fs/promises");
    const run = runner(async (_cmd, args) => {
      const dossier = args[args.indexOf("--output") + 1]!;
      await mkdir(join(dossier, "reports"), { recursive: true });
      const rapport = { schemaVersion: "2", thresholds: { high: 80, low: 60 }, files: { [join(racine, "src/Montant.cs")]: { language: "cs", source: "", mutants: [
        { id: "1", mutatorName: "Arithmetic mutation", location: { start: { line: 25, column: 1 }, end: { line: 25, column: 9 } }, status: "Survived" },
        { id: "2", mutatorName: "Equality mutation", location: { start: { line: 14, column: 1 }, end: { line: 14, column: 9 } }, status: "Killed" },
      ] } } };
      await writeFile(join(dossier, "reports", "mutation-report.json"), JSON.stringify(rapport));
      return sortie();
    });
    const m = await createProfileAdapter(r.profile, { runner: run }).mutation!({ root: racine });
    const dossier = run.appels[0]!.args[run.appels[0]!.args.indexOf("--output") + 1]!;
    expect(dossier.startsWith(racine)).toBe(false);
    expect(m).toEqual({ score: 50, files: [{ file: "src/Montant.cs", score: 50, survived: [{ line: 25, operator: "Arithmetic mutation" }] }] });
  });
});

