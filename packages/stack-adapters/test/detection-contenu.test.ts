/**
 * Détection au contenu (ADR 0072, point 1) : un élément de `detect` peut exiger qu'un fichier
 * contienne une sous-chaîne, pas seulement qu'il existe. L'adaptateur TypeScript vérifie que
 * `vitest` figure dans `package.json` ; un profil sait désormais le dire aussi.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProfileAdapter } from "../src/profile/profile-adapter.js";
import { diagnoseProfile } from "../src/profile/stack-doctor.js";
import { parseStackProfile } from "../src/profile/stack-profile.js";

const PROFIL = (detect: string) => `
id: ts
detect: ${detect}
tests:
  command: [vitest, run]
  report: vitest-json
layout:
  unitTests: ["tests/**"]
`;
const lire = (detect: string) => parseStackProfile(PROFIL(detect), { allowedPrograms: ["vitest"] });
const adaptateur = (detect: string) => {
  const r = lire(detect);
  if ("error" in r) throw new Error(r.error);
  return createProfileAdapter(r.profile);
};

let racine: string;
beforeEach(async () => {
  racine = await mkdtemp(join(tmpdir(), "detection-"));
});
afterEach(() => rm(racine, { recursive: true, force: true }));

describe("Détection au contenu (ADR 0072)", () => {
  it("le fichier doit exister ET contenir la sous-chaîne", async () => {
    const a = adaptateur(`[{ fichier: package.json, contient: '"vitest"' }]`);
    expect(await a.detect(racine)).toBe(false);
    await writeFile(join(racine, "package.json"), '{ "dependencies": { "express": "4" } }');
    expect(await a.detect(racine)).toBe(false);
    await writeFile(join(racine, "package.json"), '{ "devDependencies": { "vitest": "4" } }');
    expect(await a.detect(racine)).toBe(true);
  });

  it("un élément qui correspond suffit, nom seul ou contenu, comme avant", async () => {
    const a = adaptateur(`[vitest.config.ts, { fichier: package.json, contient: '"vitest"' }]`);
    await writeFile(join(racine, "vitest.config.ts"), "");
    expect(await a.detect(racine)).toBe(true);
  });

  it("un dossier du même nom, ou un fichier illisible, ne correspond pas", async () => {
    const a = adaptateur(`[{ fichier: package.json, contient: vitest }]`);
    await mkdir(join(racine, "package.json"));
    expect(await a.detect(racine)).toBe(false);
  });

  it("le chemin est relatif à la racine, sans `..` ; la sous-chaîne n'est pas vide", () => {
    expect(lire(`[{ fichier: /etc/passwd, contient: root }]`)).toEqual({ error: expect.stringMatching(/detect\.0\.fichier/) });
    expect(lire(`[{ fichier: ../voisin/package.json, contient: x }]`)).toEqual({ error: expect.stringMatching(/detect\.0\.fichier/) });
    expect(lire(`[{ fichier: package.json, contient: "" }]`)).toEqual({ error: expect.stringMatching(/detect\.0\.contient/) });
    expect(lire(`[{ fichier: package.json, contient: x, autre: y }]`)).toEqual({ error: expect.any(String) });
  });

  it("/stack doctor nomme l'élément au contenu tel qu'il est exigé", () => {
    const r = lire(`[vitest.config.ts, { fichier: package.json, contient: '"vitest"' }]`);
    if ("error" in r) throw new Error(r.error);
    const constats = diagnoseProfile(r.profile, { programmeTrouvable: () => true, cheminExiste: () => true, fichiersDeDetectionPresents: false });
    expect(constats[0]!.message).toBe('Aucun des fichiers de `detect` n\'est présent (vitest.config.ts, package.json contenant « "vitest" ») : ce profil ne reconnaîtrait pas ce projet.');
  });
});
