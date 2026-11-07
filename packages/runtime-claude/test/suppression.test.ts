/**
 * Suppression d'une session Claude (stratégie du 06/11, `progress.md`). Une session `claude -p` tient
 * dans `<projectsDirectory>/<dossier du projet encodé>/<id>.jsonl` (et parfois un dossier `<id>/`).
 * Ce dossier est **partagé avec l'utilisateur** : ses propres sessions et la mémoire automatique du
 * projet y vivent. On n'y supprime que nos sessions, désignées par un UUID, jamais autre chose.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClaudeRuntime } from "../src/claude-runtime.js";
import type { LanceurClaude } from "../src/protocols.js";

const NOTRE = "5f0c2a8e-1b7d-4c3e-9a6f-2d8b4e1c7a90";
const SIENNE = "0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b";

let racine: string;
let projet: string;
beforeEach(async () => {
  racine = await mkdtemp(join(tmpdir(), "claude-projets-"));
  projet = join(racine, "-home-moi-Projets-x");
  await mkdir(join(projet, "memory"), { recursive: true });
  await writeFile(join(projet, "memory", "MEMORY.md"), "mémoire de l'utilisateur");
  await writeFile(join(projet, `${NOTRE}.jsonl`), "{}");
  await mkdir(join(projet, NOTRE, "subagents"), { recursive: true });
  await writeFile(join(projet, `${SIENNE}.jsonl`), "{}");
});
afterEach(() => rm(racine, { recursive: true, force: true }));

const lanceur = (statut: () => Promise<unknown>): LanceurClaude => ({ version: async () => "2.1.319", lancer: () => { throw new Error("non"); }, statut });

describe("Suppression d'une session Claude", () => {
  it("supprime le fichier et le dossier de la session, rien d'autre : ni les sessions de l'utilisateur, ni la mémoire du projet", async () => {
    const rt = createClaudeRuntime({ lanceur: lanceur(async () => ({ loggedIn: true, projectsDirectory: racine })) });
    await rt.deleteSession(NOTRE);
    expect(existsSync(join(projet, `${NOTRE}.jsonl`))).toBe(false);
    expect(existsSync(join(projet, NOTRE))).toBe(false);
    expect(existsSync(join(projet, `${SIENNE}.jsonl`))).toBe(true);
    expect(existsSync(join(projet, "memory", "MEMORY.md"))).toBe(true);
  });

  it("une session déjà absente compte comme supprimée", async () => {
    const rt = createClaudeRuntime({ lanceur: lanceur(async () => ({ projectsDirectory: racine })) });
    await rt.deleteSession(NOTRE);
    await expect(rt.deleteSession(NOTRE)).resolves.toBeUndefined();
  });

  it("un identifiant qui n'est pas un UUID n'est pas à nous : rien n'est touché", async () => {
    const rt = createClaudeRuntime({ lanceur: lanceur(async () => ({ projectsDirectory: racine })) });
    for (const id of ["memory", "..", "../-home-moi-Projets-x", `${SIENNE}/../memory`, ""]) await rt.deleteSession(id);
    expect(existsSync(join(projet, "memory", "MEMORY.md"))).toBe(true);
    expect(existsSync(join(projet, `${SIENNE}.jsonl`))).toBe(true);
    expect(existsSync(join(projet, `${NOTRE}.jsonl`))).toBe(true);
  });

  it("dossier des sessions inconnu (statut illisible ou sans projectsDirectory) : échec, pour que le registre réessaie", async () => {
    await expect(createClaudeRuntime({ lanceur: lanceur(async () => ({ loggedIn: true })) }).deleteSession(NOTRE)).rejects.toThrow(/dossier des sessions/);
    await expect(createClaudeRuntime({ lanceur: lanceur(async () => { throw new Error("ENOENT"); }) }).deleteSession(NOTRE)).rejects.toThrow(/dossier des sessions/);
    expect(existsSync(join(projet, `${NOTRE}.jsonl`))).toBe(true);
  });
});
