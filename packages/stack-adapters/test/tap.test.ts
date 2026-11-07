/**
 * Lecteur TAP (ADR 0072, point 3). Le fichier `fixtures/node-test.tap` est la vraie sortie de
 * `node --test --test-reporter=tap` (Node 22.22), racine réécrite en `/projet` : réussite, assertion,
 * symbole absent dans un bloc imbriqué, test sauté, TODO, test hors bloc.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTap } from "../src/reports/tap.js";

const NODE = readFileSync(join(import.meta.dirname, "fixtures/node-test.tap"), "utf8");
const F = "tests/plafond.test.mjs";

describe("Lecteur TAP (ADR 0072)", () => {
  it("node --test : un résultat par test, les blocs `describe` écartés, titres des parents dans l'identifiant", () => {
    expect(parseTap(NODE, "/projet").map((r) => [r.id, r.status])).toEqual([
      ["plafond > garde la dose sous le maximum", "passed"],
      ["plafond > refuse une dose négative", "failed"],
      ["plafond > réglage > lit le maximum", "failed"],
      ["plafond > à venir", "skipped"],
      ["plafond > connu", "skipped"],
      ["hors bloc", "passed"],
    ]);
  });

  it("échecs : message du bloc de diagnostic, classé comme pour JUnit ; fichier tiré de `location`, relatif à la racine", () => {
    const r = parseTap(NODE, "/projet");
    expect(r[1]).toMatchObject({ file: F, failureKind: "assertion", message: expect.stringContaining("Expected values to be strictly equal") });
    expect(r[2]).toMatchObject({ file: F, failureKind: "missing_symbol", message: "lireMaximum is not defined" });
  });

  it("fichier : sans `location` (node ne le donne qu'aux échecs), celui du parent qui le donne ; sinon vide", () => {
    const r = parseTap(NODE, "/projet");
    expect(r[0]!.file).toBe(F);
    expect(r[5]!.file).toBe("");
  });

  it("autres producteurs : sans tiret ni numéro, `# SKIP` en toute casse ; `Bail out!` est un échec de la suite", () => {
    const bats = ["1..3", "ok 1 calcule la dose", "not ok 2 plafonne la dose", "# (in test file tests/dose.bats, line 7)", "ok 3 ignoré # skip plus tard"].join("\n");
    expect(parseTap(bats, "/projet").map((r) => [r.id, r.status])).toEqual([
      ["calcule la dose", "passed"],
      ["plafonne la dose", "failed"],
      ["ignoré", "skipped"],
    ]);
    const bail = ["TAP version 13", "ok 1 - a", "Bail out! la base est injoignable"].join("\n");
    expect(parseTap(bail, "/projet").at(-1)).toMatchObject({ status: "failed", failureKind: "other_error", message: "la base est injoignable" });
  });

  it("un fichier qui ne se charge pas : un échec à son nom, classé selon son erreur", () => {
    const tap = ["TAP version 13", "# Subtest: tests/a.test.mjs", "not ok 1 - tests/a.test.mjs", "  ---", "  location: '/projet/tests/a.test.mjs:1:1'", "  error: 'test failed'", "  ...", "1..1"].join("\n");
    expect(parseTap(tap, "/projet")).toEqual([{ id: "tests/a.test.mjs", file: "tests/a.test.mjs", status: "failed", failureKind: "other_error", message: "test failed" }]);
  });

  it("bloc de diagnostic illisible, fins de ligne Windows : rien ne plante", () => {
    const tap = "TAP version 13\r\nnot ok 1 - x\r\n  ---\r\n  error: [non fermé\r\n  ...\r\n";
    expect(parseTap(tap, "/projet")).toEqual([{ id: "x", file: "", status: "failed", failureKind: "other_error" }]);
  });
});

describe("Lecteur TAP dans un profil (ADR 0072)", async () => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { createProfileAdapter } = await import("../src/profile/profile-adapter.js");
  const { parseStackProfile } = await import("../src/profile/stack-profile.js");
  const profil = (command: string) => {
    const r = parseStackProfile(`id: bats\ndetect: [tests]\ntests:\n  command: ${command}\n  report: tap\nlayout:\n  unitTests: ["tests/**"]\n`, { allowedPrograms: ["bats", "node"] });
    if ("error" in r) throw new Error(r.error);
    return r.profile;
  };
  const sortie = { exitCode: 1, stderr: "", timedOut: false, durationMs: 1 };

  it("sans {rapport} dans la commande : le TAP est lu sur la sortie standard", async () => {
    const racine = await mkdtemp(join(tmpdir(), "tap-"));
    const a = createProfileAdapter(profil("[bats, tests]"), { runner: { run: async () => ({ ...sortie, stdout: "1..2\nok 1 a\nnot ok 2 b\n" }) } });
    expect((await a.runTests({ root: racine })).results.map((r) => [r.id, r.status])).toEqual([["a", "passed"], ["b", "failed"]]);
    await rm(racine, { recursive: true, force: true });
  });

  it("avec {rapport} : lu dans le fichier que l'outil a écrit", async () => {
    const racine = await mkdtemp(join(tmpdir(), "tap-"));
    const a = createProfileAdapter(profil('[node, --test, --test-reporter=tap, "--test-reporter-destination={rapport}"]'), {
      runner: {
        run: async (_cmd, args) => {
          await writeFile(args.find((x) => x.startsWith("--test-reporter-destination="))!.split("=")[1]!, "TAP version 13\nok 1 - c\n");
          return { ...sortie, exitCode: 0, stdout: "rien d'utile" };
        },
      },
    });
    expect((await a.runTests({ root: racine })).results.map((r) => r.id)).toEqual(["c"]);
    await rm(racine, { recursive: true, force: true });
  });

  it("`tap` décrit des tests, pas un lint ni une mutation", () => {
    const r = parseStackProfile(`id: x\ndetect: [a]\ntests:\n  command: [bats, t]\n  report: tap\nlint:\n  command: [eslint]\n  report: tap\nlayout:\n  unitTests: ["t/**"]\n`, { allowedPrograms: ["bats", "eslint"] });
    expect(r).toEqual({ error: expect.stringMatching(/lint\.report — « tap »/) });
  });
});

describe("Lecteur TAP contre le vrai node --test", async () => {
  const { mkdtemp, mkdir, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { createProfileAdapter } = await import("../src/profile/profile-adapter.js");
  const { parseStackProfile } = await import("../src/profile/stack-profile.js");
  const { createNodeProcessRunner } = await import("../src/process/node-process-runner.js");

  it("un profil `node --test` en TAP : réussite, assertion, symbole absent, fichier relatif", async () => {
    const racine = await mkdtemp(join(tmpdir(), "tap-vrai-"));
    await mkdir(join(racine, "tests"));
    await writeFile(
      join(racine, "tests/dose.test.mjs"),
      'import { it } from "node:test";\nimport assert from "node:assert/strict";\nit("passe", () => {});\nit("assertion", () => assert.equal(1, 2));\nit("symbole", () => { absent(); });\n',
    );
    const r = parseStackProfile('id: node\ndetect: [tests]\ntests:\n  command: [node, --test, --test-reporter=tap, "--test-reporter-destination={rapport}"]\n  report: tap\nlayout:\n  unitTests: ["tests/**"]\n', { allowedPrograms: ["node"] });
    if ("error" in r) throw new Error(r.error);
    const run = await createProfileAdapter(r.profile, { runner: createNodeProcessRunner() }).runTests({ root: racine });
    expect(run.results.map((x) => [x.id, x.status, x.failureKind ?? null])).toEqual([
      ["passe", "passed", null],
      ["assertion", "failed", "assertion"],
      ["symbole", "failed", "missing_symbol"],
    ]);
    expect(run.results.filter((x) => x.status === "failed").map((x) => x.file)).toEqual(["tests/dose.test.mjs", "tests/dose.test.mjs"]);
    await rm(racine, { recursive: true, force: true });
  }, 30_000);
});
