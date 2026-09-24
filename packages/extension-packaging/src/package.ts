import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { unzipSync, zipSync } from "fflate";

/**
 * Paquet d'extension (§12) : archive ZIP contenant le manifeste, le code compilé et les ressources,
 * plus `META-INF/signature.json`. La signature Ed25519 porte sur l'empreinte de **toutes** les
 * autres entrées (chemin et SHA-256 du contenu, triés) : rien ne peut être ajouté, retiré ni modifié.
 */
export const SIGNATURE_PATH = "META-INF/signature.json";

const LIMITS = { entries: 2_000, totalBytes: 50 * 1024 * 1024 };

export interface ExtensionPackage {
  entries: Map<string, Uint8Array>;
  manifest: unknown;
  signature: PackageSignature | null;
}

export interface PackageSignature {
  version: 1;
  algorithm: "ed25519";
  keyId: string;
  signature: string;
}

export interface TrustedPublisher {
  publisher: string;
  keyId: string;
  publicKeyPem: string;
  /** Mises à jour automatiques autorisées pour cet éditeur (§12). */
  trustedUpdates: boolean;
}

export type Verification =
  | { status: "signed"; publisher: string; keyId: string }
  | { status: "unsigned" }
  | { status: "invalid"; reason: string };

export interface KeyPair {
  keyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export function keyIdOf(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  return { keyId: keyIdOf(publicKeyPem), publicKeyPem, privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}

/** Empreinte canonique des entrées signées (hors `META-INF/`). */
export function packageDigest(entries: Map<string, Uint8Array>): string {
  const lines = [...entries.keys()]
    .filter((p) => !p.startsWith("META-INF/"))
    .sort()
    .map((p) => `${p}\n${createHash("sha256").update(entries.get(p)!).digest("hex")}\n`);
  return createHash("sha256").update(lines.join("")).digest("hex");
}

function assertSafePath(p: string): void {
  const bad = p.startsWith("/") || p.includes("\\") || p.includes("\0") || /^[A-Za-z]:/.test(p) || p.split("/").some((s) => s === ".." || s === ".");
  if (bad || !p) throw new Error(`Archive refusée : chemin dangereux « ${p} »`);
}

/** Construit l'archive ; signée si une clé est fournie (outil pour les éditeurs). */
export function packExtension(files: Map<string, Uint8Array>, key?: { privateKeyPem: string; keyId: string }): Uint8Array {
  const entries = new Map(files);
  for (const p of entries.keys()) assertSafePath(p);
  if (!entries.has("manifest.json")) throw new Error("Le paquet doit contenir manifest.json");
  if (key) {
    const sig: PackageSignature = {
      version: 1,
      algorithm: "ed25519",
      keyId: key.keyId,
      signature: sign(null, Buffer.from(packageDigest(entries)), createPrivateKey(key.privateKeyPem)).toString("base64"),
    };
    entries.set(SIGNATURE_PATH, encoder.encode(JSON.stringify(sig)));
  }
  return zipSync(Object.fromEntries(entries), { level: 9 });
}

/** Lit l'archive avec des garde-fous : chemins, nombre d'entrées, taille décompressée. */
export function readPackage(bytes: Uint8Array): ExtensionPackage {
  let count = 0;
  let total = 0;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes, {
      filter(file) {
        if (file.name.endsWith("/")) return false;
        assertSafePath(file.name);
        count++;
        total += file.originalSize;
        if (count > LIMITS.entries) throw new Error("Archive refusée : trop d'entrées");
        if (total > LIMITS.totalBytes) throw new Error("Archive refusée : trop volumineuse une fois décompressée");
        return true;
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Archive refusée")) throw err;
    throw new Error("Archive illisible : ce n'est pas un paquet d'extension", { cause: err });
  }
  const entries = new Map(Object.entries(raw));
  const manifestBytes = entries.get("manifest.json");
  if (!manifestBytes) throw new Error("Paquet invalide : manifest.json absent");
  let manifest: unknown;
  try {
    manifest = JSON.parse(decoder.decode(manifestBytes));
  } catch {
    throw new Error("Paquet invalide : manifest.json illisible");
  }
  let signature: PackageSignature | null = null;
  const sigBytes = entries.get(SIGNATURE_PATH);
  if (sigBytes) {
    try {
      signature = JSON.parse(decoder.decode(sigBytes)) as PackageSignature;
    } catch {
      signature = { version: 1, algorithm: "ed25519", keyId: "", signature: "" };
    }
  }
  return { entries, manifest, signature };
}

/** Vérifie la signature contre les éditeurs de confiance (installation et chaque mise à jour, §12). */
export function verifyPackage(pkg: ExtensionPackage, trusted: TrustedPublisher[]): Verification {
  if (!pkg.signature) return { status: "unsigned" };
  const s = pkg.signature;
  if (s.version !== 1 || s.algorithm !== "ed25519" || !s.signature) return { status: "invalid", reason: "Format de signature inconnu" };
  const key = trusted.find((k) => k.keyId === s.keyId);
  if (!key) return { status: "invalid", reason: `Clé de signature inconnue (${s.keyId || "absente"}) : éditeur non approuvé` };
  const publisher = (pkg.manifest as { publisher?: unknown } | null)?.publisher;
  if (publisher !== key.publisher) return { status: "invalid", reason: `La clé appartient à l'éditeur « ${key.publisher} », pas à « ${String(publisher)} »` };
  let ok = false;
  try {
    ok = verify(null, Buffer.from(packageDigest(pkg.entries)), createPublicKey(key.publicKeyPem), Buffer.from(s.signature, "base64"));
  } catch {
    ok = false;
  }
  return ok ? { status: "signed", publisher: key.publisher, keyId: key.keyId } : { status: "invalid", reason: "La signature ne correspond pas au contenu du paquet" };
}

/** Extrait les fichiers (hors `META-INF/`) dans `dest`, en revérifiant que chaque chemin y reste. */
export async function extractPackage(pkg: ExtensionPackage, dest: string): Promise<void> {
  const root = resolve(dest);
  for (const [p, bytes] of pkg.entries) {
    if (p.startsWith("META-INF/")) continue;
    assertSafePath(p);
    const target = resolve(root, p);
    if (!target.startsWith(root + sep)) throw new Error(`Extraction refusée : ${p}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

/** Lit un dossier d'extension compilée en table de fichiers (outil d'empaquetage). */
export async function filesFromDirectory(dir: string, include: (rel: string) => boolean = () => true): Promise<Map<string, Uint8Array>> {
  const { readdir, readFile } = await import("node:fs/promises");
  const out = new Map<string, Uint8Array>();
  async function walk(rel: string): Promise<void> {
    for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(r);
      else if (e.isFile() && include(r)) out.set(r, new Uint8Array(await readFile(join(dir, r))));
    }
  }
  await walk("");
  return out;
}
