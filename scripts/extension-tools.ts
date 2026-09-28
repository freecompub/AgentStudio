/**
 * Outils des éditeurs d'extensions (§12) :
 *   pnpm ext:keys <dossier>                         génère une paire de clés Ed25519
 *   pnpm ext:build <dossier-source> <sortie>        compile une extension du dépôt (entrée, manifest.json,
 *                                                   fichiers de rôle et skills déclarés, LICENSE)
 *   pnpm ext:pack <dossier-extension> <sortie.asx> [clé-privée.pem]   empaquette (et signe)
 * Le dossier d'extension contient manifest.json et l'entrée compilée (manifest.main).
 * Sans clé privée, le paquet est NON signé : il exige le mode développeur à l'installation.
 */
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { filesFromDirectory, generateKeyPair, keyIdOf, packExtension } from "@agent-studio/extension-packaging";

const [command, ...args] = process.argv.slice(2);

if (command === "build") {
  const [src, out] = args;
  if (!src || !out) throw new Error("Utilisation : ext:build <dossier-source> <sortie>");
  const { bundle, copyDeclaredFiles } = await import("@agent-studio/extension-host");
  // Le manifeste est du TypeScript : on le compile pour le lire, puis on l'écrit en JSON.
  const tmp = await mkdtemp(join(tmpdir(), "agent-studio-manifest-"));
  try {
    const compiled = join(tmp, "manifest.mjs");
    await bundle(join(src, "src/manifest.ts"), compiled);
    const { manifest } = (await import(pathToFileURL(compiled).href)) as { manifest: { main: string; id: string; version: string } };
    await mkdir(out, { recursive: true });
    await bundle(join(src, "src/entry.ts"), join(out, manifest.main));
    await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
    // Contenu des agents et skills (ADR 0024), et licence que la GPL exige de fournir (ADR 0023).
    await copyDeclaredFiles(manifest as never, src, out);
    await copyFile(join(src, "LICENSE"), join(out, "LICENSE")).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err;
    });
    console.log(`Extension compilée : ${manifest.id} ${manifest.version} → ${out}`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
} else if (command === "keys") {
  const dir = args[0] ?? ".";
  const k = generateKeyPair();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "publisher.key.pem"), k.privateKeyPem, { mode: 0o600 });
  await writeFile(join(dir, "publisher.pub.pem"), k.publicKeyPem);
  console.log(`Clés créées dans ${dir} (identifiant ${k.keyId}). Gardez publisher.key.pem secrète ; transmettez publisher.pub.pem à l'administrateur.`);
} else if (command === "pack") {
  const [dir, out, keyFile] = args;
  if (!dir || !out) throw new Error("Utilisation : ext:pack <dossier-extension> <sortie.asx> [clé-privée.pem]");
  const files = await filesFromDirectory(dir, (rel) => !rel.startsWith("node_modules/") && !rel.startsWith("META-INF/"));
  let key: { privateKeyPem: string; keyId: string } | undefined;
  if (keyFile) {
    const privateKeyPem = await readFile(keyFile, "utf8");
    const { createPublicKey } = await import("node:crypto");
    const publicKeyPem = createPublicKey(privateKeyPem).export({ type: "spki", format: "pem" }).toString();
    key = { privateKeyPem, keyId: keyIdOf(publicKeyPem) };
  }
  await writeFile(out, packExtension(files, key));
  console.log(`Paquet ${key ? `signé (clé ${key.keyId})` : "NON signé"} : ${out} (${files.size} fichiers)`);
} else {
  console.log("Commandes : keys <dossier> | build <dossier-source> <sortie> | pack <dossier-extension> <sortie.asx> [clé-privée.pem]");
}
