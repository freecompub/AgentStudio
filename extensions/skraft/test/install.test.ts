/**
 * skraft est distribuée à part (elle n'est plus livrée avec l'application) : elle s'empaquette en
 * `.asx` et s'installe depuis un fichier, comme n'importe quelle extension tierce.
 *
 * Elle n'est pas signée pour l'instant : elle exige donc le mode développeur, et l'installation
 * est refusée sans lui.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle, copyDeclaredFiles, extensionFileReader, loadAgentPrompts } from "@agent-studio/extension-host";
import { createExtensionInstaller, type ConsentRequest } from "@agent-studio/extension-installer";
import { filesFromDirectory, packExtension } from "@agent-studio/extension-packaging";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { manifest } from "../src/manifest.js";

let dir: string;
let asx: string;
/** Chemin de l'entrée compilée, tel que le manifeste le déclare (facultatif dans le type). */
if (!manifest.main) throw new Error("Le manifeste de skraft doit déclarer `main`.");
const ENTREE: string = manifest.main;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "agent-studio-skraft-asx-"));
  // Côté éditeur : compilation puis empaquetage, sans signature.
  // Comme `pnpm ext:build` : entrée compilée, manifeste, fichiers de rôle et skills (ADR 0024).
  const build = join(dir, "build");
  await bundle(join(import.meta.dirname, "../src/entry.ts"), join(build, ENTREE));
  await writeFile(join(build, "manifest.json"), JSON.stringify(manifest));
  await copyDeclaredFiles(manifest, join(import.meta.dirname, ".."), build);
  asx = join(dir, `${manifest.id}-${manifest.version}.asx`);
  await writeFile(asx, packExtension(await filesFromDirectory(build)));
}, 120_000);

afterAll(() => rm(dir, { recursive: true, force: true }));

let profils = 0;

function installer(opts: { devMode: boolean; consent?: (r: ConsentRequest) => Promise<boolean> }) {
  const demandes: ConsentRequest[] = [];
  const inst = createExtensionInstaller({
    // Un profil neuf par cas : une installation ne doit pas en influencer une autre.
    installDir: join(dir, `profil-${++profils}`, "extensions"),
    appApi: "0.1.0",
    trusted: () => [],
    devMode: () => opts.devMode,
    consent: async (r) => (demandes.push(r), (await opts.consent?.(r)) ?? true),
    revocation: async () => null,
    // Aucune liste de révocation en jeu ici : la clé racine n'est jamais consultée.
    rootPublicKeyPem: "",
    clock: { now: () => new Date() },
  });
  return { inst, demandes };
}

describe("skraft distribuée en paquet .asx", () => {
  it("non signée : refusée hors mode développeur", async () => {
    const { inst, demandes } = installer({ devMode: false });
    const r = await inst.installFromFile(asx);
    expect(r.status).toBe("rejected");
    expect(r.status === "rejected" && r.reason).toMatch(/non signée/i);
    // Rien n'est demandé à l'utilisateur : le refus est antérieur à l'accord.
    expect(demandes).toEqual([]);
  });

  it("en mode développeur : installée avec accord, et son origine est signalée comme non garantie", async () => {
    const { inst, demandes } = installer({ devMode: true });
    const r = await inst.installFromFile(asx);

    expect(r).toMatchObject({ status: "installed", id: manifest.id, version: manifest.version });
    expect(demandes).toHaveLength(1);
    expect(demandes[0]?.warnings.join(" ")).toMatch(/non signée/i);

    // Les permissions sont présentées en langage clair avant l'accord, pas après.
    const descriptions = demandes[0]!.permissions.map((p) => p.description);
    expect(descriptions.length).toBeGreaterThan(0);
    expect(descriptions.every((d) => d.trim().length > 0)).toBe(true);
    expect(demandes[0]?.signed).toBe(false);

    expect((await inst.list()).map((e) => e.id)).toContain(manifest.id);
    const installed = (await inst.active()).find((e) => e.manifest.id === manifest.id);
    expect(installed).toBeDefined();
    // Les rôles et les skills sont livrés dans le paquet : chaque agent se compose depuis le dossier installé.
    const composed = await loadAgentPrompts(manifest, extensionFileReader(installed!.directory));
    expect(composed.get("skraft-dev")?.systemPrompt).toContain("### Skill outside-in-tdd#SYNTHESIZE-GREEN");
  });

  it("refuser l'accord n'installe rien", async () => {
    const { inst } = installer({ devMode: true, consent: async () => false });
    expect(await inst.installFromFile(asx)).toMatchObject({ status: "declined" });
    expect((await inst.list()).map((e) => e.id)).not.toContain(manifest.id);
  });

  it("le paquet apporte bien la commande de skraft", () => {
    expect(manifest.contributes?.commands?.map((c) => c.name)).toContain("skraft");
  });
});
