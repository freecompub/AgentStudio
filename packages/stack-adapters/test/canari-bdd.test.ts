/**
 * Canari BDD de `/stack doctor` (ADR 0074 §3). Le faux rouge propre au BDD est le scénario dont une
 * étape n'a pas de définition : il n'a rien vérifié. La porte de DISTILL refuse `other_error` et les
 * tests ignorés ; si le lanceur rend ce scénario réussi, ou classé `assertion` ou `missing_symbol`,
 * il franchit la porte. Le code écrit lui-même ce `.feature` — Gherkin ne dépend d'aucun langage —
 * dans le dossier `features` de chaque couple déclaré.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jugerCanariBdd, runCanaries } from "../src/profile/canaries.js";
import { parseStackProfile } from "../src/profile/stack-profile.js";
import type { ProcessRunner, TestResult } from "../src/protocols.js";

const resultat = (over: Partial<TestResult> = {}): TestResult => ({ id: "t", file: "f", status: "failed", ...over });
const juger = (results: TestResult[], rapportLu = true) => jugerCanariBdd({ rapportLu, results, features: "Features" });

describe("L'oracle du canari BDD : une étape sans définition", () => {
  it("classée `other_error`, elle est refusée par la porte : c'est le bon comportement", () => {
    expect(juger([resultat({ failureKind: "other_error" })]).gravite).toBe("ok");
  });

  it("rendue ignorée, elle est aussi refusée par la porte de DISTILL", () => {
    expect(juger([resultat({ status: "skipped" })]).gravite).toBe("ok");
  });

  it("rendue réussie, c'est le pire : un scénario qui n'a rien vérifié passerait pour vert", () => {
    const c = juger([resultat({ status: "passed" })]);
    expect(c.gravite).toBe("probleme");
    expect(c.message).toMatch(/réussi/);
  });

  it.each(["assertion", "missing_symbol"] as const)("classée `%s`, elle franchit la porte comme un rouge légitime", (k) => {
    const c = juger([resultat({ failureKind: k })]);
    expect(c.gravite).toBe("probleme");
    expect(c.message).toContain(`\`${k}\``);
  });

  it("non classée, elle franchit aussi la porte, qui ne refuse que `other_error`", () => {
    expect(juger([resultat()]).gravite).toBe("probleme");
  });

  it("le pire des résultats l'emporte : un `other_error` ne cache pas un résultat réussi", () => {
    expect(juger([resultat({ failureKind: "other_error" }), resultat({ status: "passed" })]).gravite).toBe("probleme");
  });

  it("absente du rapport, elle n'est pas éprouvée : le dossier n'est pas découvert, ou le lanceur veut que les étapes chargent le .feature", () => {
    const c = juger([]);
    expect(c.gravite).toBe("avertissement");
    expect(c.message).toContain("Features");
  });

  it("sans aucun rapport, rien n'a pu passer, mais la porte ne saura pas dire quelle étape manque", () => {
    expect(juger([], false).gravite).toBe("avertissement");
  });
});

describe("Exécution du canari BDD", () => {
  let bac: string;
  beforeEach(async () => {
    bac = await mkdtemp(join(tmpdir(), "agent-studio-bac-bdd-"));
  });
  afterEach(() => rm(bac, { recursive: true, force: true }));

  const PROFIL = (bdd: string) => {
    const r = parseStackProfile(
      `
id: dotnet
detect: [x.sln]
tests:
  command: [dotnet, test, "--logger=junit;LogFilePath={rapport}"]
  report: junit-xml
layout:
  acceptanceTests: []
  unitTests: ["tests/**"]
  sources: ["src/**"]
infrastructureModules: []
${bdd}
`,
      { allowedPrograms: ["dotnet"] },
    );
    if ("error" in r) throw new Error(r.error);
    return r.profile;
  };
  const AVEC_BDD = PROFIL(`bdd:
  - { lanceur: reqnroll, features: tests/Acceptance/Features, etapes: tests/Acceptance/Steps }`);

  const rapportDe = (args: readonly string[]) => args.find((a) => a.includes(".xml"))!.replace(/^.*LogFilePath=/, "");
  const vide = `<?xml version="1.0"?><testsuites><testsuite><testcase classname="Deja.La" name="Test"/></testsuite></testsuites>`;

  /** Lanceur doublé : rend, pour le `.feature` du canari, un test nommé comme le ferait un lanceur qui met les mots en capitales. */
  function lanceur(rendu: (marque: string) => string) {
    const vus: string[] = [];
    const r: ProcessRunner & { vus: string[] } = {
      vus,
      async run(_cmd, args, opts) {
        const dossier = join(opts.cwd, "tests/Acceptance/Features");
        const feature = (await readdir(dossier).catch(() => [] as string[])).find((f) => f.endsWith(".feature"));
        if (!feature) {
          await writeFile(rapportDe(args), vide);
          return { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
        }
        const texte = await readFile(join(dossier, feature), "utf8");
        vus.push(texte);
        const marque = texte.match(/c[0-9a-f]{8}/)![0];
        await writeFile(rapportDe(args), `<?xml version="1.0"?><testsuites><testsuite>${rendu(marque.toUpperCase())}</testsuite></testsuites>`);
        return { exitCode: 1, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
      },
    };
    return r;
  }

  it("écrit un .feature dans le dossier `features` de chaque couple, avec une étape que rien ne définit, puis le retire", async () => {
    const r = lanceur((m) => `<testcase classname="Canari${m}Feature" name="${m}Canari"><failure message="No matching step definition found"/></testcase>`);
    await runCanaries(AVEC_BDD, { runner: r, sandboxRoot: bac });
    expect(r.vus).toHaveLength(1);
    // La langue est imposée : un projet dont la langue Gherkin par défaut est une autre ne lirait pas ces mots-clés.
    expect(r.vus[0]).toMatch(/^# language: en\n/);
    expect(r.vus[0]).toMatch(/Scenario: c[0-9a-f]{8}/);
    expect(await readdir(join(bac, "tests/Acceptance/Features"))).toEqual([]);
  });

  it("reconnaît le résultat du canari même si le lanceur a changé la casse du titre", async () => {
    const r = lanceur((m) => `<testcase classname="Canari${m}Feature" name="${m}Canari"><skipped/></testcase>`);
    const { constats } = await runCanaries(AVEC_BDD, { runner: r, sandboxRoot: bac });
    const bdd = constats.find((c) => /étape sans définition/.test(c.message));
    expect(bdd?.gravite, JSON.stringify(constats, null, 2)).toBe("ok");
  });

  it("dénonce un lanceur qui rend réussi un scénario dont une étape n'a pas de définition", async () => {
    const r = lanceur((m) => `<testcase classname="Canari${m}Feature" name="${m}Canari"/>`);
    const { constats } = await runCanaries(AVEC_BDD, { runner: r, sandboxRoot: bac });
    expect(constats.some((c) => c.gravite === "probleme" && /étape sans définition/.test(c.message))).toBe(true);
  });

  it("un profil sans BDD n'écrit aucun .feature", async () => {
    const r = lanceur(() => "");
    const { constats } = await runCanaries(PROFIL(""), { runner: r, sandboxRoot: bac });
    expect(r.vus).toEqual([]);
    expect(constats.some((c) => /étape sans définition/.test(c.message))).toBe(false);
  });
});
