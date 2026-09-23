import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractPackage, generateKeyPair, packExtension, readPackage, verifyPackage, type TrustedPublisher } from "../src/index.js";

const enc = (s: string) => new TextEncoder().encode(s);
const MANIFEST = { id: "tiers.lint", version: "1.0.0", publisher: "tiers", engines: { appApi: "^0.1" }, main: "dist/index.mjs", permissions: ["fs:read"], contributes: {} };
const files = () =>
  new Map<string, Uint8Array>([
    ["manifest.json", enc(JSON.stringify(MANIFEST))],
    ["dist/index.mjs", enc("export default { activate() {} };")],
    ["README.md", enc("# Lint")],
  ]);

describe("Paquets d'extension signés (D13, §12)", () => {
  const keys = generateKeyPair();
  const trust: TrustedPublisher[] = [{ publisher: "tiers", keyId: keys.keyId, publicKeyPem: keys.publicKeyPem, trustedUpdates: false }];

  it("paquet signé par un éditeur de confiance : valide", () => {
    const pkg = readPackage(packExtension(files(), { privateKeyPem: keys.privateKeyPem, keyId: keys.keyId }));
    expect(pkg.manifest).toEqual(MANIFEST);
    expect(verifyPackage(pkg, trust)).toEqual({ status: "signed", publisher: "tiers", keyId: keys.keyId });
  });

  it("la signature couvre toute l'archive : fichier modifié, ajouté ou retiré = invalide", () => {
    const signed = readPackage(packExtension(files(), { privateKeyPem: keys.privateKeyPem, keyId: keys.keyId }));
    const tamper = (mutate: (m: Map<string, Uint8Array>) => void) => {
      const entries = new Map(signed.entries);
      mutate(entries);
      return verifyPackage({ ...signed, entries }, trust);
    };
    expect(tamper((m) => m.set("dist/index.mjs", enc("export default { activate() { evil(); } };")))).toMatchObject({ status: "invalid", reason: expect.stringMatching(/signature/) });
    expect(tamper((m) => m.set("dist/porte-derobee.mjs", enc("x")))).toMatchObject({ status: "invalid" });
    expect(tamper((m) => m.delete("README.md"))).toMatchObject({ status: "invalid" });
  });

  it("clé inconnue ou éditeur usurpé : invalide", () => {
    const other = generateKeyPair();
    const pkg = readPackage(packExtension(files(), { privateKeyPem: other.privateKeyPem, keyId: other.keyId }));
    expect(verifyPackage(pkg, trust)).toMatchObject({ status: "invalid", reason: expect.stringMatching(/inconnue/) });
    const usurped: TrustedPublisher[] = [{ publisher: "diabeo", keyId: other.keyId, publicKeyPem: other.publicKeyPem, trustedUpdates: false }];
    expect(verifyPackage(pkg, usurped)).toMatchObject({ status: "invalid", reason: expect.stringMatching(/éditeur/) });
  });

  it("paquet sans signature : non signé (installable seulement en mode développeur)", () => {
    const pkg = readPackage(packExtension(files()));
    expect(verifyPackage(pkg, trust)).toEqual({ status: "unsigned" });
  });

  it("archive illisible ou sans manifeste : refusée", () => {
    expect(() => readPackage(enc("pas un zip"))).toThrow(/Archive/);
    expect(() => readPackage(zipSync({ "dist/x.mjs": enc("x") }))).toThrow(/manifest\.json/);
  });

  it.each([
    ["../evasion.mjs", /chemin/],
    ["/etc/passwd", /chemin/],
    ["dist\\..\\x", /chemin/],
    ["dist/../../x", /chemin/],
  ])("refuse une entrée au chemin dangereux : %s", (path, re) => {
    const bytes = zipSync({ "manifest.json": enc(JSON.stringify(MANIFEST)), [path]: enc("x") });
    expect(() => readPackage(bytes)).toThrow(re);
  });

  it("refuse une archive trop grosse une fois décompressée (bombe)", () => {
    const big = new Uint8Array(60 * 1024 * 1024);
    const bytes = zipSync({ "manifest.json": enc(JSON.stringify(MANIFEST)), "dist/big.bin": big });
    expect(() => readPackage(bytes)).toThrow(/trop volumineuse/);
  });

  describe("extraction", () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "agent-studio-pkg-"));
    });
    afterEach(() => rm(dir, { recursive: true, force: true }));

    it("extrait les fichiers dans le dossier cible, sans le dossier de signature", async () => {
      const pkg = readPackage(packExtension(files(), { privateKeyPem: keys.privateKeyPem, keyId: keys.keyId }));
      await extractPackage(pkg, join(dir, "tiers.lint"));
      expect((await readdir(join(dir, "tiers.lint"))).sort()).toEqual(["README.md", "dist", "manifest.json"]);
      expect(await readFile(join(dir, "tiers.lint/dist/index.mjs"), "utf8")).toBe("export default { activate() {} };");
    });
  });
});
