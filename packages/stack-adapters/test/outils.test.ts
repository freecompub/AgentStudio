/**
 * Les outils du projet (`outils`, ADR 0075 point 1) : des dossiers du projet où vivent ses programmes
 * (un environnement virtuel, par exemple), mis en tête du PATH de chaque commande du profil. Le
 * programme reste jugé par son nom contre la liste : `pytest` d'un projet uv se lance sans `uv`.
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCanaries } from "../src/profile/canaries.js";
import { createProfileAdapter } from "../src/profile/profile-adapter.js";
import { envDesOutils } from "../src/profile/outils.js";
import { parseStackProfile } from "../src/profile/stack-profile.js";
import type { ProcessOptions, ProcessRunner } from "../src/protocols.js";

const PROFIL = (outils = "outils: [.venv/bin, .venv/Scripts]\n", programme = "pytest") => `
id: python
detect: [pyproject.toml]
${outils}tests:
  command: [${programme}, "--junit-xml={rapport}"]
  report: junit-xml
lint:
  command: [eslint, --format, json]
  report: eslint-json
format:
  command: [ruff, format, --check]
mutation:
  command: [mutmut, run]
  report: stryker-json
layout:
  unitTests: ["tests/**"]
`;
const lire = (yaml: string, programmes = ["pytest", "eslint", "ruff", "mutmut"]) => parseStackProfile(yaml, { allowedPrograms: programmes });
const profil = (yaml = PROFIL()) => {
  const r = lire(yaml);
  if ("error" in r) throw new Error(r.error);
  return r.profile;
};

let racine: string;
beforeEach(async () => {
  racine = await mkdtemp(join(tmpdir(), "outils-"));
});
afterEach(() => rm(racine, { recursive: true, force: true }));

describe("outils : lecture", () => {
  it("des dossiers relatifs au projet ; jamais absolus ni hors du projet", () => {
    expect(profil().outils).toEqual([".venv/bin", ".venv/Scripts"]);
    expect(profil(PROFIL("")).outils).toBeUndefined();
    expect(lire(PROFIL("outils: [/usr/bin]\n"))).toEqual({ error: expect.stringMatching(/outils.*relatif/) });
    expect(lire(PROFIL("outils: [../ailleurs/bin]\n"))).toEqual({ error: expect.stringMatching(/outils.*\.\./) });
  });

  it("le programme reste jugé par son nom : un outil du projet hors de la liste est refusé", () => {
    expect(lire(PROFIL(undefined, "monoutil"))).toEqual({ error: expect.stringMatching(/« monoutil » \(tests\) n'est pas un programme autorisé/) });
  });
});

describe("envDesOutils", () => {
  it("sans outils : rien ; avec : les dossiers, absolus, en tête du PATH", () => {
    expect(envDesOutils(profil(PROFIL("")), "/projet", { PATH: "/usr/bin" })).toEqual({});
    expect(envDesOutils(profil(), "/projet", { PATH: "/usr/bin" })).toEqual({ PATH: [join("/projet", ".venv/bin"), join("/projet", ".venv/Scripts"), "/usr/bin"].join(delimiter) });
  });

  it("garde le nom de la variable tel que le système l'écrit (Windows : Path)", () => {
    expect(envDesOutils(profil(), "/projet", { Path: "C:\\Windows" })).toEqual({ Path: [join("/projet", ".venv/bin"), join("/projet", ".venv/Scripts"), "C:\\Windows"].join(delimiter) });
    expect(envDesOutils(profil(), "/projet", {})).toEqual({ PATH: [join("/projet", ".venv/bin"), join("/projet", ".venv/Scripts")].join(delimiter) });
  });
});

describe("outils : chaque commande du profil les reçoit", () => {
  it("tests, lint, format, mutation", async () => {
    const envs: (Record<string, string> | undefined)[] = [];
    const runner: ProcessRunner = {
      async run(_cmd, _args, opts: ProcessOptions) {
        envs.push(opts.env);
        return { exitCode: 0, stdout: "[]", stderr: "", timedOut: false, durationMs: 1 };
      },
    };
    const a = createProfileAdapter(profil(), { runner });
    await a.runTests({ root: racine }).catch(() => undefined);
    await a.lint?.({ root: racine }).catch(() => undefined);
    await a.format?.({ root: racine }).catch(() => undefined);
    await a.mutation?.({ root: racine, files: ["src/a.py"] } as never).catch(() => undefined);
    expect(envs).toHaveLength(4);
    for (const e of envs) expect(e?.["PATH"] ?? e?.["Path"]).toMatch(new RegExp(`^${join(racine, ".venv/bin").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });

  it.skipIf(process.platform === "win32")("en vrai : un programme du projet, absent du PATH, est lancé par son nom", async () => {
    await mkdir(join(racine, "outils", "bin"), { recursive: true });
    const script = join(racine, "outils", "bin", "montest");
    await writeFile(script, "#!/bin/sh\necho 'TAP version 13'\necho 'ok 1 - tests/a'\necho '1..1'\n");
    await chmod(script, 0o755);
    const yaml = "id: maison\ndetect: [tests]\noutils: [outils/bin]\ntests:\n  command: [montest]\n  report: tap\nlayout:\n  unitTests: [\"tests/**\"]\n";
    const r = parseStackProfile(yaml, { allowedPrograms: ["montest"] });
    if ("error" in r) throw new Error(r.error);
    const res = await createProfileAdapter(r.profile).runTests({ root: racine });
    expect(res.results).toEqual([expect.objectContaining({ id: "tests/a", status: "passed" })]);
  });
});

/**
 * Les canaris tournent dans une copie Git du projet (worktree), où les outils installés — ignorés par
 * Git — n'existent pas (essai Copilot du 09/11 : « aucun rapport lisible » dans un projet uv). Leur PATH
 * désigne donc les outils du projet d'origine.
 */
describe("outils : les canaris prennent ceux du projet d'origine", () => {
  it("le PATH vient de racineDesOutils, le dossier de travail reste la copie", async () => {
    const appels: { cwd: string; path: string | undefined }[] = [];
    const runner: ProcessRunner = {
      async run(_cmd, _args, opts: ProcessOptions) {
        appels.push({ cwd: opts.cwd, path: opts.env?.["PATH"] ?? opts.env?.["Path"] });
        return { exitCode: 1, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
      },
    };
    await runCanaries(profil(), { runner, sandboxRoot: join(racine, "copie"), racineDesOutils: join(racine, "projet") });
    expect(appels.length).toBeGreaterThan(0);
    for (const a of appels) {
      expect(a.cwd).toBe(join(racine, "copie"));
      expect(a.path?.startsWith(join(racine, "projet", ".venv/bin"))).toBe(true);
    }
  });
});
