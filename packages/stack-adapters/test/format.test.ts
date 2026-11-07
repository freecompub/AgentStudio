/**
 * Porte de format (ADR 0071, point 6) : une commande facultative du profil de pile, qui vérifie la
 * mise en forme sans rien modifier (`dotnet format --verify-no-changes`, `prettier --check`). Le
 * code de sortie suffit : 0, au format ; autre, pas au format. Outil absent ou muet : non mesuré.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProfileAdapter } from "../src/profile/profile-adapter.js";
import { parseStackProfile } from "../src/profile/stack-profile.js";
import type { ProcessResult, ProcessRunner } from "../src/protocols.js";

const PROFIL = (format = `format:\n  command: [prettier, --check, "{fichiers}"]\n`) => `
id: ts
detect: [package.json]
tests:
  command: [vitest, run, "--reporter=junit", "--outputFile={rapport}"]
  report: junit-xml
${format}
layout:
  unitTests: ["tests/**"]
  sources: ["src/**"]
`;
const sortie = (over: Partial<ProcessResult> = {}): ProcessResult => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1, ...over });
function runner(reponse: ProcessResult | (() => never)) {
  const appels: { cmd: string; args: string[] }[] = [];
  const r: ProcessRunner & { appels: typeof appels } = {
    appels,
    async run(cmd, args) {
      appels.push({ cmd, args: [...args] });
      return typeof reponse === "function" ? reponse() : reponse;
    },
  };
  return r;
}
const profil = (texte = PROFIL()) => {
  const r = parseStackProfile(texte, { allowedPrograms: ["vitest", "prettier"] });
  if ("error" in r) throw new Error(r.error);
  return r.profile;
};

let racine: string;
beforeEach(async () => {
  racine = await mkdtemp(join(tmpdir(), "format-"));
});

describe("Porte de format : profil", () => {
  it("commande facultative, sans rapport ; son programme doit être autorisé, comme les autres", () => {
    expect(profil().format).toEqual({ command: ["prettier", "--check", "{fichiers}"] });
    expect(profil(PROFIL("")).format).toBeUndefined();
    expect(parseStackProfile(PROFIL(), { allowedPrograms: ["vitest"] })).toEqual({ error: expect.stringMatching(/« prettier » \(format\) n'est pas un programme autorisé/) });
    expect(parseStackProfile(PROFIL(`format:\n  command: [prettier]\n  report: eslint-json\n`), { allowedPrograms: ["vitest", "prettier"] })).toMatchObject({ error: expect.any(String) });
  });
});

describe("Porte de format : adaptateur", () => {
  it("code de sortie 0 : au format ; autre : pas au format, avec la sortie de l'outil", async () => {
    const ok = createProfileAdapter(profil(), { runner: runner(sortie()) });
    expect(await ok.format!({ root: racine, files: ["src/a.ts"] })).toEqual({ available: true, ok: true, tool: "prettier" });
    const ko = createProfileAdapter(profil(), { runner: runner(sortie({ exitCode: 1, stdout: "[warn] src/a.ts\n" })) });
    expect(await ko.format!({ root: racine })).toEqual({ available: true, ok: false, tool: "prettier", sortie: "[warn] src/a.ts" });
  });

  it("les fichiers demandés remplacent {fichiers} ; sans fichiers, rien", async () => {
    const r = runner(sortie());
    await createProfileAdapter(profil(), { runner: r }).format!({ root: racine, files: ["src/a.ts", "src/b.ts"] });
    expect(r.appels[0]).toEqual({ cmd: "prettier", args: ["--check", "src/a.ts", "src/b.ts"] });
  });

  it("outil absent ou délai dépassé : non mesuré, jamais « au format »", async () => {
    const absent = createProfileAdapter(profil(), { runner: runner(() => { throw new Error("ENOENT"); }) });
    expect(await absent.format!({ root: racine })).toEqual({ available: false, ok: false });
    const lent = createProfileAdapter(profil(), { runner: runner(sortie({ timedOut: true })) });
    expect(await lent.format!({ root: racine })).toEqual({ available: false, ok: false });
  });

  it("sans commande déclarée, la capacité n'existe pas", () => {
    expect(createProfileAdapter(profil(PROFIL("")), { runner: runner(sortie()) }).format).toBeUndefined();
  });
});
