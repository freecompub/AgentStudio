/**
 * Critère de sortie de J6 : une extension tierce s'installe depuis un fichier.
 * Chaîne complète : compilation, empaquetage et signature par l'éditeur → installation depuis le
 * fichier avec accord → chargement dans son propre processus (modèle de permissions) → commande
 * utilisable dans le chat.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixedClock, MemoryEvidenceStore, MemoryInteractionStore, sequentialIds } from "@agent-studio/core/testing";
import { bundle, createNodeLauncher } from "@agent-studio/extension-host";
import { createExtensionInstaller, type ConsentRequest } from "@agent-studio/extension-installer";
import { generateKeyPair, packExtension } from "@agent-studio/extension-packaging";
import { MemoryTaskStore } from "@agent-studio/task-engine";
import type { Workspace } from "@agent-studio/workspace";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { workspaceServicesFactory } from "../src/main/workspace-services.js";
import type { WorkspaceServices } from "../src/main/protocols.js";

const MANIFEST = {
  id: "tiers.lint",
  version: "1.0.0",
  publisher: "tiers",
  engines: { appApi: "^0.1" },
  main: "dist/index.mjs",
  permissions: ["fs:read", "net:none"],
  contributes: { commands: [{ name: "lint", title: "Vérifier le style", description: "Examine les fichiers TypeScript du projet" }] },
};

describe("Extension tierce installée depuis un fichier (J6)", () => {
  let dir: string;
  let services: WorkspaceServices | undefined;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "agent-studio-thirdparty-"));
  });
  afterAll(async () => {
    await services?.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  it("empaquetée et signée par l'éditeur, installée avec accord, isolée, utilisable", async () => {
    // 1. Côté éditeur : compilation, empaquetage, signature.
    const key = generateKeyPair();
    const built = join(dir, "build", "index.mjs");
    await bundle(join(import.meta.dirname, "fixtures/third-party/lint-extension.ts"), built);
    const asx = join(dir, "tiers.lint-1.0.0.asx");
    const enc = (s: string) => new TextEncoder().encode(s);
    await writeFile(asx, packExtension(new Map([["manifest.json", enc(JSON.stringify(MANIFEST))], ["dist/index.mjs", new Uint8Array(await readFile(built))]]), { privateKeyPem: key.privateKeyPem, keyId: key.keyId }));

    // 2. Côté utilisateur : installation depuis le fichier, éditeur approuvé par l'administrateur.
    const consents: ConsentRequest[] = [];
    const installer = createExtensionInstaller({
      installDir: join(dir, "profil", "extensions"),
      appApi: "0.1.0",
      trusted: () => [{ publisher: "tiers", keyId: key.keyId, publicKeyPem: key.publicKeyPem, trustedUpdates: false }],
      devMode: () => false,
      consent: async (req) => (consents.push(req), true),
      revocation: async () => null,
      rootPublicKeyPem: key.publicKeyPem,
      clock: { now: () => new Date() },
    });
    expect(await installer.installFromFile(asx)).toEqual({ status: "installed", id: "tiers.lint", version: "1.0.0" });
    expect(consents[0]?.permissions.map((p) => p.description)).toEqual(["Lire les fichiers du projet", "Aucun accès à Internet"]);

    // 3. Chargement dans son propre processus, comme au démarrage de l'application.
    const runtimeEntry = join(dir, "runtime", "extension-child.mjs");
    await bundle(join(import.meta.dirname, "../../../packages/extension-host/src/child/entry.ts"), runtimeEntry);
    const posts: string[] = [];
    const workspace: Workspace = {
      root: join(dir, "projet"),
      files: { read: async () => "", write: async () => {}, list: async () => ["src/a.ts", "src/b.ts", "README.md"] },
      checkpoints: { create: async (l) => ({ id: "cp", sha: "", head: "", label: l, createdAt: "" }), list: async () => [], diff: async () => ({ files: [], patch: "" }), rollback: async () => {} },
      repo: {
      // Ce double ne sait pas ouvrir de copie isolée : échouer vaut mieux que rendre une racine vide.
      worktree: async () => { throw new Error("copie isolée non fournie par ce double"); },
      head: async () => "h", commit: async () => null, sync: async () => ({ pulled: 0, pushed: 0 }), switchBranch: async () => {} },
    };
    await mkdir(workspace.root, { recursive: true });
    services = await workspaceServicesFactory({
      extensions: async () =>
        (await installer.active()).map((a) => ({ kind: "isolated" as const, manifest: a.manifest, directory: a.directory, entry: join(a.directory, a.manifest.main!) })),
      isolation: { launcher: createNodeLauncher(), runtimeEntry },
      stacks: [{ id: "typescript", layout: { acceptanceTests: ["tests/acceptance/**"], unitTests: ["tests/**"], sources: ["src/**"] }, infrastructureModules: ["Infrastructure"],  detect: async () => true, isTestFile: () => false, testFilePattern: "^tests/", runTests: async () => ({ results: [], exitCode: 0, timedOut: false, output: "", durationMs: 0 }) }],
      tasksDir: join(dir, "taches"),
      taskStore: new MemoryTaskStore(),
      evidenceStore: new MemoryEvidenceStore(),
      interactionStore: new MemoryInteractionStore(),
      clock: fixedClock(),
      ids: sequentialIds("x"),
    })({ workspace, runtime: async () => Promise.reject(new Error("aucun agent")), onTask: () => {}, onInteractions: () => {}, onPost: (ext, md) => void posts.push(`${ext}: ${md}`) });

    // 4. La commande apportée par l'extension est proposée et fonctionne.
    expect(services.commands().map((c) => [c.invocation, c.title])).toEqual([["lint", "Vérifier le style"]]);
    expect(await services.route("/lint")).toEqual({ kind: "handled" });
    for (let i = 0; i < 200 && posts.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(posts).toEqual(["tiers.lint: Vérification du style : 2 fichier(s) TypeScript examiné(s), aucun écart."]);
  }, 60_000);
});
