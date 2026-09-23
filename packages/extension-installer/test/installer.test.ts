import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair, packExtension, signRevocationList, type RevocationList } from "@agent-studio/extension-packaging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExtensionInstaller, type ConsentRequest } from "../src/installer.js";

const enc = (s: string) => new TextEncoder().encode(s);
const publisher = generateKeyPair();
const root = generateKeyPair();

function manifest(over: Record<string, unknown> = {}) {
  return {
    id: "tiers.lint",
    version: "1.0.0",
    publisher: "tiers",
    engines: { appApi: "^0.1" },
    main: "dist/index.mjs",
    permissions: ["fs:read"],
    contributes: { commands: [{ name: "lint", title: "Vérifier le style", description: "Signale les écarts de style" }] },
    ...over,
  };
}

function pkg(m: Record<string, unknown> = manifest(), signed = true): Uint8Array {
  const files = new Map([
    ["manifest.json", enc(JSON.stringify(m))],
    ["dist/index.mjs", enc("export default { activate() {} };")],
  ]);
  return packExtension(files, signed ? { privateKeyPem: publisher.privateKeyPem, keyId: publisher.keyId } : undefined);
}

describe("Installation d'extensions depuis un fichier (J6, §5.3, §12)", () => {
  let dir: string;
  let installDir: string;
  let consents: ConsentRequest[];
  let answer: boolean;
  let devMode: boolean;
  let revocation: unknown;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "agent-studio-install-"));
    installDir = join(dir, "extensions");
    consents = [];
    answer = true;
    devMode = false;
    revocation = null;
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  function installer() {
    return createExtensionInstaller({
      installDir,
      appApi: "0.1.0",
      trusted: () => [{ publisher: "tiers", keyId: publisher.keyId, publicKeyPem: publisher.publicKeyPem, trustedUpdates: false }],
      devMode: () => devMode,
      consent: async (req) => (consents.push(req), answer),
      revocation: async () => revocation,
      rootPublicKeyPem: root.publicKeyPem,
      clock: { now: () => new Date("2026-09-23T10:00:00.000Z") },
    });
  }

  async function file(bytes: Uint8Array, name = "lint.asx") {
    const p = join(dir, name);
    await writeFile(p, bytes);
    return p;
  }

  it("paquet signé : permissions présentées en langage clair, accord, extraction, inscription", async () => {
    const r = await installer().installFromFile(await file(pkg()));
    expect(r).toEqual({ status: "installed", id: "tiers.lint", version: "1.0.0" });
    expect(consents).toEqual([
      {
        kind: "install",
        extensionId: "tiers.lint",
        version: "1.0.0",
        publisher: "tiers",
        signed: true,
        commands: ["Vérifier le style : Signale les écarts de style"],
        permissions: [{ permission: "fs:read", description: "Lire les fichiers du projet" }],
        added: [],
        warnings: [],
      },
    ]);
    expect(await readFile(join(installDir, "tiers.lint/dist/index.mjs"), "utf8")).toContain("activate");
    expect(await installer().list()).toEqual([
      { id: "tiers.lint", version: "1.0.0", publisher: "tiers", signed: true, installedAt: "2026-09-23T10:00:00.000Z", disabled: null },
    ]);
  });

  it("refus de l'utilisateur : rien n'est installé", async () => {
    answer = false;
    expect(await installer().installFromFile(await file(pkg()))).toEqual({ status: "declined" });
    expect(existsSync(join(installDir, "tiers.lint"))).toBe(false);
  });

  it("signature invalide ou éditeur non approuvé : refus sans même demander", async () => {
    const other = generateKeyPair();
    const forged = packExtension(new Map([["manifest.json", enc(JSON.stringify(manifest()))]]), { privateKeyPem: other.privateKeyPem, keyId: other.keyId });
    const r = await installer().installFromFile(await file(forged));
    expect(r).toMatchObject({ status: "rejected", reason: expect.stringMatching(/Signature invalide/) });
    expect(consents).toEqual([]);
  });

  it("paquet non signé : refusé hors mode développeur, accepté en mode développeur avec avertissement", async () => {
    expect(await installer().installFromFile(await file(pkg(manifest(), false)))).toMatchObject({ status: "rejected", reason: expect.stringMatching(/mode développeur/) });
    devMode = true;
    expect(await installer().installFromFile(await file(pkg(manifest(), false)))).toMatchObject({ status: "installed" });
    expect(consents[0]?.warnings).toEqual([expect.stringMatching(/non signée/)]);
    expect((await installer().list())[0]?.signed).toBe(false);
  });

  it("manifeste invalide ou incompatible : refusé avec les raisons", async () => {
    const r = await installer().installFromFile(await file(pkg(manifest({ engines: { appApi: "^2.0" } }))));
    expect(r).toMatchObject({ status: "rejected", reason: expect.stringMatching(/incompatible/) });
  });

  it("mise à jour qui élargit les permissions : nouvel accord, avec les ajouts mis en évidence", async () => {
    await installer().installFromFile(await file(pkg()));
    const r = await installer().installFromFile(await file(pkg(manifest({ version: "1.1.0", permissions: ["fs:read", "net:api.example.com"] })), "v2.asx"));
    expect(r).toEqual({ status: "installed", id: "tiers.lint", version: "1.1.0" });
    expect(consents[1]).toMatchObject({ kind: "update", added: [{ permission: "net:api.example.com", description: "Accéder à Internet : api.example.com" }] });
  });

  it("mise à jour sans nouvelle permission : pas de nouvelle question ; retour en arrière de version refusé", async () => {
    await installer().installFromFile(await file(pkg()));
    await installer().installFromFile(await file(pkg(manifest({ version: "1.0.1" })), "v2.asx"));
    expect(consents).toHaveLength(1);
    const r = await installer().installFromFile(await file(pkg(manifest({ version: "0.9.0" })), "old.asx"));
    expect(r).toMatchObject({ status: "rejected", reason: expect.stringMatching(/antérieure/) });
  });

  it("révocation : installation refusée ; extension déjà installée désactivée au lancement suivant, avec la raison", async () => {
    await installer().installFromFile(await file(pkg()));
    const list: RevocationList = { issuedAt: "2026-09-23T11:00:00.000Z", revoked: [{ id: "tiers.lint", reason: "fuite de données" }] };
    revocation = signRevocationList(list, root.privateKeyPem);
    const disabled = await installer().applyRevocations();
    expect(disabled).toEqual([{ id: "tiers.lint", reason: "fuite de données" }]);
    expect((await installer().list())[0]?.disabled).toBe("Révoquée : fuite de données");
    expect(await installer().installFromFile(await file(pkg(manifest({ version: "1.0.1" })), "v2.asx"))).toMatchObject({ status: "rejected", reason: expect.stringMatching(/révoquée/) });
  });

  it("liste de révocation falsifiée : ignorée (rien n'est désactivé)", async () => {
    await installer().installFromFile(await file(pkg()));
    revocation = { ...signRevocationList({ issuedAt: "x", revoked: [] }, root.privateKeyPem), revoked: [{ id: "tiers.lint", reason: "faux" }] };
    await expect(installer().applyRevocations()).rejects.toThrow(/signature/);
    expect((await installer().list())[0]?.disabled).toBeNull();
  });

  it("désinstallation", async () => {
    await installer().installFromFile(await file(pkg()));
    await installer().uninstall("tiers.lint");
    expect(await installer().list()).toEqual([]);
    expect(existsSync(join(installDir, "tiers.lint"))).toBe(false);
  });

  it("fichier illisible : refus explicite", async () => {
    expect(await installer().installFromFile(await file(enc("n'importe quoi")))).toMatchObject({ status: "rejected", reason: expect.stringMatching(/Archive illisible/) });
  });
});
