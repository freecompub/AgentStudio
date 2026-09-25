/**
 * Canaris de `/stack doctor` (§8.6). Des tests dont la bonne réponse est connue d'avance : on les
 * écrit, on lance la commande déclarée, et on vérifie que l'échec obtenu est classé comme prévu.
 * Aucun LLM n'est consulté — l'oracle est dans le code.
 *
 * Le canari qui compte le plus est `syntax` : les portes RED tiennent `assertion` et
 * `missing_symbol` pour des rouges légitimes. Si une erreur de syntaxe se range dans l'une des
 * deux, du code qui ne compile pas franchit la porte.
 */
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jugerCanari, runCanaries } from "../src/profile/canaries.js";
import { parseStackProfile } from "../src/profile/stack-profile.js";
import type { ProcessResult, ProcessRunner, TestResult } from "../src/protocols.js";

const AUTORISES = ["pytest"];

const PROFIL = (canaris: string) => `
id: python
detect: [pyproject.toml]
tests:
  command: [pytest, "--junit-xml={rapport}"]
  report: junit-xml
layout:
  acceptanceTests: []
  unitTests: ["tests/**"]
  sources: ["src/**"]
infrastructureModules: []
${canaris}
`;

const CANARIS_VALIDES = `canaries:
  - kind: passed
    file: tests/test_{marque}.py
    content: "def test_{marque}(): assert True"
  - kind: assertion
    file: tests/test_{marque}.py
    content: "def test_{marque}(): assert 1 == 2"
  - kind: missing_symbol
    file: tests/test_{marque}.py
    content: "def test_{marque}(): inexistante()"
  - kind: syntax
    file: tests/test_{marque}.py
    content: "def test_{marque}( :::"`;

const profil = (canaris = CANARIS_VALIDES) => {
  const r = parseStackProfile(PROFIL(canaris), { allowedPrograms: AUTORISES });
  if ("error" in r) throw new Error(r.error);
  return r.profile;
};

const resultat = (over: Partial<TestResult> = {}): TestResult => ({ id: "t", file: "tests/t.py", status: "failed", ...over });

describe("L'oracle d'un canari", () => {
  it("`passed` : un canari qui passe doit passer", () => {
    expect(jugerCanari({ kind: "passed", rapportLu: true, results: [resultat({ status: "passed" })] }).gravite).toBe("ok");
  });

  it("`passed` en échec est un problème : la commande déclarée ne sait pas faire passer un test trivial", () => {
    const c = jugerCanari({ kind: "passed", rapportLu: true, results: [resultat({ failureKind: "assertion" })] });
    expect(c.gravite).toBe("probleme");
  });

  it("`assertion` : une assertion fausse doit être classée `assertion`", () => {
    expect(jugerCanari({ kind: "assertion", rapportLu: true, results: [resultat({ failureKind: "assertion" })] }).gravite).toBe("ok");
  });

  it("`assertion` classée autrement est un problème, et le constat dit ce qui a été obtenu", () => {
    const c = jugerCanari({ kind: "assertion", rapportLu: true, results: [resultat({ failureKind: "other_error" })] });
    expect(c.gravite).toBe("probleme");
    expect(c.message).toMatch(/other_error/);
  });

  it("`missing_symbol` : un appel à une fonction inexistante doit être reconnu", () => {
    expect(jugerCanari({ kind: "missing_symbol", rapportLu: true, results: [resultat({ failureKind: "missing_symbol" })] }).gravite).toBe("ok");
  });

  it("`missing_symbol` tombé en `other_error` est un problème : la porte RED refuserait un rouge légitime", () => {
    const c = jugerCanari({ kind: "missing_symbol", rapportLu: true, results: [resultat({ failureKind: "other_error" })] });
    expect(c.gravite).toBe("probleme");
    expect(c.message).toMatch(/rouge/i);
  });

  it("`missing_symbol` pris pour une assertion n'est qu'un avertissement : la porte accepte les deux", () => {
    expect(jugerCanari({ kind: "missing_symbol", rapportLu: true, results: [resultat({ failureKind: "assertion" })] }).gravite).toBe("avertissement");
  });

  it("`syntax` classée `assertion` est LE problème que ce canari existe pour attraper", () => {
    const c = jugerCanari({ kind: "syntax", rapportLu: true, results: [resultat({ failureKind: "assertion" })] });
    expect(c.gravite).toBe("probleme");
    expect(c.message).toMatch(/syntaxe/i);
    expect(c.message).toMatch(/RED|porte/);
  });

  it("`syntax` classée `missing_symbol` est le même problème : la porte RED accepte aussi ce classement", () => {
    expect(jugerCanari({ kind: "syntax", rapportLu: true, results: [resultat({ failureKind: "missing_symbol" })] }).gravite).toBe("probleme");
  });

  it("`syntax` classée `other_error` est le bon comportement", () => {
    expect(jugerCanari({ kind: "syntax", rapportLu: true, results: [resultat({ failureKind: "other_error" })] }).gravite).toBe("ok");
  });

  it("`syntax` non classée est un problème : la porte RED ne rejette QUE `other_error`", () => {
    // Elle laisse donc passer un échec sans classement — c'est le point que je croyais inverse.
    const c = jugerCanari({ kind: "syntax", rapportLu: true, results: [resultat({})] });
    expect(c.gravite).toBe("probleme");
    expect(c.message).toMatch(/other_error/);
  });

  it("le pire des échecs l'emporte : une assertion cachée derrière un `other_error` est vue", () => {
    // La porte s'arrête sur la première entrée qui l'arrange ; l'oracle doit donc juger toutes
    // les entrées, sans quoi ce rapport passerait pour sain.
    const c = jugerCanari({
      kind: "syntax",
      rapportLu: true,
      results: [resultat({ id: "chargement", failureKind: "other_error" }), resultat({ id: "cas", failureKind: "assertion" })],
    });
    expect(c.gravite).toBe("probleme");
  });

  it("`syntax` que le lanceur ignore en rendant un rapport complet est un problème, pas un avertissement", () => {
    // Une suite « verte » alors qu'un fichier ne compile pas : la porte GREEN ne regarde que
    // `failed === 0` et attesterait un vert sur du code qui ne se construit pas.
    const c = jugerCanari({ kind: "syntax", rapportLu: true, results: [] });
    expect(c.gravite).toBe("probleme");
    expect(c.message).toMatch(/ignore|verte/i);
  });

  it("`missing_symbol` non classé est un problème : le lecteur n'a rien reconnu", () => {
    expect(jugerCanari({ kind: "missing_symbol", rapportLu: true, results: [resultat({})] }).gravite).toBe("probleme");
  });

  it("`syntax` qui empêche toute compilation est acceptable : rien n'a pu être mal classé", () => {
    const c = jugerCanari({ kind: "syntax", rapportLu: false, results: [] });
    expect(c.gravite).toBe("ok");
    expect(c.message).toMatch(/compil|rapport/i);
  });

  it("`missing_symbol` sans aucun rapport dit la vraie cause : un profil ne lit pas les erreurs de compilation", () => {
    const c = jugerCanari({ kind: "missing_symbol", rapportLu: false, results: [] });
    expect(c.gravite).toBe("probleme");
    expect(c.message).toMatch(/compil/i);
    expect(c.message).not.toMatch(/emplacement/);
  });

  it("un canari que le lanceur n'a pas vu est un problème d'emplacement, pas de classement", () => {
    const c = jugerCanari({ kind: "assertion", rapportLu: true, results: [] });
    expect(c.gravite).toBe("probleme");
    expect(c.message).toMatch(/pas .*(vu|découvert|trouvé)/i);
  });
});

describe("Ce qu'un profil a le droit de déclarer comme canari", () => {
  const refus = (canaris: string) => {
    const r = parseStackProfile(PROFIL(canaris), { allowedPrograms: AUTORISES });
    return "error" in r ? r.error : null;
  };

  it("un chemin qui sort du projet est refusé : le canari est écrit sur le disque", () => {
    expect(refus(`canaries:
  - kind: passed
    file: ../../etc/test_x.py
    content: "def test_{marque}(): assert True"`)).toMatch(/\.\.|hors|relatif/i);
  });

  it("un chemin absolu est refusé pour la même raison", () => {
    expect(refus(`canaries:
  - kind: passed
    file: /tmp/test_x.py
    content: "def test_{marque}(): assert True"`)).toBeTruthy();
  });

  it("un canari sans `{marque}` dans son contenu est refusé : on ne saurait pas reconnaître ses résultats", () => {
    expect(refus(`canaries:
  - kind: passed
    file: tests/test_x.py
    content: "def test_x(): assert True"`)).toMatch(/marque/);
  });

  it("le canari `syntax` échappe à la règle sur `content` : il ne produit souvent aucun résultat", () => {
    expect(refus(`canaries:
  - kind: syntax
    file: tests/test_{marque}.py
    content: "def test_x( :::"`)).toBeNull();
  });

  it("un nom de fichier sans `{marque}` est refusé : il écraserait un fichier du projet", () => {
    expect(refus(`canaries:
  - kind: passed
    file: tests/MesTests.py
    content: "def test_{marque}(): assert True"`)).toMatch(/marque/);
  });

  it("un profil sans canaris reste valide : ils sont facultatifs", () => {
    expect(refus("")).toBeNull();
  });
});

describe("Exécution des canaris", () => {
  let bac: string;
  let projet: string;
  beforeEach(async () => {
    bac = await mkdtemp(join(tmpdir(), "agent-studio-bac-"));
    projet = await mkdtemp(join(tmpdir(), "agent-studio-projet-"));
    await writeFile(join(projet, "pyproject.toml"), "");
  });
  afterEach(() => Promise.all([rm(bac, { recursive: true, force: true }), rm(projet, { recursive: true, force: true })]));

  /** Lanceur doublé : écrit dans `{rapport}` ce que `xml` rend, ou rien du tout si c'est `null`. */
  function runner(xml: () => string | null) {
    const appels: { cmd: string; args: string[]; cwd: string }[] = [];
    const r: ProcessRunner & { appels: typeof appels } = {
      appels,
      async run(cmd, args, opts): Promise<ProcessResult> {
        appels.push({ cmd, args: [...args], cwd: opts.cwd });
        const contenu = xml();
        if (contenu !== null) await writeFile(rapportDe(args), contenu);
        return { exitCode: contenu === null ? 2 : 1, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
      },
    };
    return r;
  }

  /** Le lanceur ne voit pas la marque dans ses arguments : il la lit dans le bac à sable. */
  /** Le chemin du rapport tel que le profil le passe : `--junit-xml=<chemin>`. */
  const rapportDe = (args: readonly string[]) => args.find((a) => a.endsWith(".xml"))!.replace(/^[^=]*=/, "");

  const marqueEcrite = async (bacRoot: string) => {
    const fichiers = await readdir(join(bacRoot, "tests")).catch(() => [] as string[]);
    return fichiers.map((f) => f.match(/c[0-9a-f]{8}/)?.[0]).find(Boolean) ?? null;
  };

  const xunit = (marque: string, kind: string, message: string) =>
    `<?xml version="1.0"?><testsuites><testsuite name="s">` +
    `<testcase classname="tests.test_${marque}" name="test_${marque}">` +
    (kind === "passed" ? "" : `<failure message="${message}"></failure>`) +
    `</testcase>` +
    `<testcase classname="tests.autre" name="test_deja_la"/>` +
    `</testsuite></testsuites>`;

  it("écrit chaque canari dans le bac à sable, jamais dans le projet, et le retire ensuite", async () => {
    const r: ProcessRunner = {
      async run(_cmd, args, opts) {
        const marque = await marqueEcrite(opts.cwd);
        await writeFile(rapportDe(args), xunit(marque ?? "x", "passed", ""));
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
      },
    };
    await runCanaries(profil(), { runner: r, sandboxRoot: bac });
    expect(await readdir(projet)).toEqual(["pyproject.toml"]);
    expect(await readdir(join(bac, "tests")).catch(() => [])).toEqual([]);
  });

  it("chaque commande est lancée dans le bac à sable", async () => {
    const r = runner(() => `<?xml version="1.0"?><testsuites/>`);
    await runCanaries(profil(), { runner: r, sandboxRoot: bac });
    expect(r.appels.length).toBeGreaterThanOrEqual(4);
    for (const a of r.appels) expect(a.cwd).toBe(bac);
  });

  it("une chaîne correcte ne produit aucun problème", async () => {
    const attendu: Record<string, string> = {
      passed: "",
      assertion: "XCTAssertEqual failed: 1 is not 2",
      missing_symbol: "NameError: name 'inexistante' is not defined",
      syntax: "SyntaxError: invalid syntax",
    };
    const r: ProcessRunner = {
      async run(_cmd, args, opts) {
        const marque = await marqueEcrite(opts.cwd);
        if (!marque) {
          // Le relevé initial, sans canari.
          await writeFile(rapportDe(args), `<?xml version="1.0"?><testsuites><testsuite><testcase classname="tests.autre" name="test_deja_la"/></testsuite></testsuites>`);
          return { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
        }
        const src = await readFile(join(opts.cwd, "tests", `test_${marque}.py`), "utf8");
        const lequel = src.includes("assert True") ? "passed" : src.includes("1 == 2") ? "assertion" : src.includes("inexistante") ? "missing_symbol" : "syntax";
        if (lequel === "syntax") return { exitCode: 2, stdout: "", stderr: "SyntaxError", timedOut: false, durationMs: 1 };
        await writeFile(rapportDe(args), xunit(marque, lequel, attendu[lequel]!));
        return { exitCode: lequel === "passed" ? 0 : 1, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
      },
    };
    const { constats } = await runCanaries(profil(), { runner: r, sandboxRoot: bac });
    expect(constats.filter((c) => c.gravite === "probleme"), JSON.stringify(constats, null, 2)).toEqual([]);
  });

  it("dénonce un lecteur qui prend une erreur de syntaxe pour une assertion", async () => {
    const r: ProcessRunner = {
      async run(_cmd, args, opts) {
        const marque = await marqueEcrite(opts.cwd);
        // Tout échec est présenté comme une assertion : le défaut exact cherché.
        await writeFile(rapportDe(args), marque ? xunit(marque, "failed", "XCTAssertEqual failed") : `<?xml version="1.0"?><testsuites/>`);
        return { exitCode: 1, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
      },
    };
    const { constats } = await runCanaries(profil(), { runner: r, sandboxRoot: bac });
    expect(constats.some((c) => c.gravite === "probleme" && /syntaxe/i.test(c.message))).toBe(true);
  });

  it("sans canari déclaré, le rapport dit que la classification n'est pas vérifiée", async () => {
    const { constats } = await runCanaries(profil(""), { runner: runner(() => `<?xml version="1.0"?><testsuites/>`), sandboxRoot: bac });
    expect(constats.some((c) => c.gravite === "avertissement" && /canari/i.test(c.message))).toBe(true);
  });

  it("un relevé initial illisible est un problème : sans rapport, aucune porte ne peut juger", async () => {
    const { constats } = await runCanaries(profil(), { runner: runner(() => null), sandboxRoot: bac });
    expect(constats.some((c) => c.gravite === "probleme" && /rapport/i.test(c.message))).toBe(true);
  });
});

describe("Un canari ne peut pas écrire hors de la copie isolée", () => {
  let bac: string;
  let dehors: string;
  beforeEach(async () => {
    bac = await mkdtemp(join(tmpdir(), "agent-studio-bac-"));
    dehors = await mkdtemp(join(tmpdir(), "agent-studio-dehors-"));
  });
  afterEach(() => Promise.all([rm(bac, { recursive: true, force: true }), rm(dehors, { recursive: true, force: true })]));

  const runnerMuet: ProcessRunner = {
    async run(_cmd, args) {
      await writeFile(args.find((a) => a.endsWith(".xml"))!.replace(/^[^=]*=/, ""), `<?xml version="1.0"?><testsuites/>`);
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
    },
  };

  it("un lien symbolique DANS le dépôt, pointant dehors, ne détourne pas l'écriture", async () => {
    // L'attaque : le dépôt porte `tests` → un dossier de l'utilisateur. Le worktree reproduit
    // fidèlement ce lien, et le chemin `tests/test_x.py` n'a aucun `..` : un contrôle purement
    // textuel le croit interne. Le contenu du canari est entièrement choisi par le profil, et il
    // serait ensuite supprimé — donc écraser puis détruire un fichier de l'utilisateur.
    const precieux = join(dehors, "precieux.txt");
    await writeFile(precieux, "NE PAS PERDRE");
    await symlink(dehors, join(bac, "tests"));

    const profil = (() => {
      const r = parseStackProfile(
        PROFIL(`canaries:
  - kind: passed
    file: tests/test_{marque}.py
    content: "def test_{marque}(): assert True"`),
        { allowedPrograms: AUTORISES },
      );
      if ("error" in r) throw new Error(r.error);
      return r.profile;
    })();

    const { constats } = await runCanaries(profil, { runner: runnerMuet, sandboxRoot: bac });
    // Rien n'a été écrit dans le dossier visé par le lien, et son contenu est intact.
    expect(await readdir(dehors)).toEqual(["precieux.txt"]);
    expect(await readFile(precieux, "utf8")).toBe("NE PAS PERDRE");
    expect(constats.some((c) => c.gravite === "probleme" && /copie isolée|hors/i.test(c.message))).toBe(true);
  });
});
