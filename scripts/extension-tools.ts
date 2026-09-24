/**
 * Outils des éditeurs d'extensions (§12) :
 *   pnpm ext:keys <dossier>                         génère une paire de clés Ed25519
 *   pnpm ext:pack <dossier-extension> <sortie.asx> [clé-privée.pem]   empaquette (et signe)
 * Le dossier d'extension contient manifest.json et l'entrée compilée (manifest.main).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { filesFromDirectory, generateKeyPair, keyIdOf, packExtension } from "@agent-studio/extension-packaging";

const [command, ...args] = process.argv.slice(2);

if (command === "keys") {
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
  console.log("Commandes : keys <dossier> | pack <dossier-extension> <sortie.asx> [clé-privée.pem]");
}
