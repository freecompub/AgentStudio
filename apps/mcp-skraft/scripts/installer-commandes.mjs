#!/usr/bin/env node
/**
 * Installe les commandes `/skraft-…` pour Copilot CLI et Claude Code (10/11). Une seule source,
 * `skills/` à côté de ce script ; des liens symboliques vers elle, si bien qu'une correction d'un
 * skill vaut pour les deux clients sans recopie.
 *
 *   node scripts/installer-commandes.mjs                    ~/.claude/skills et ~/.copilot/skills
 *   node scripts/installer-commandes.mjs --projet <dossier> <dossier>/.claude/skills (lu par les deux)
 *   node scripts/installer-commandes.mjs --retirer [...]     retire nos liens, et eux seuls
 *
 * Un skill qui n'est pas un lien vers nos skills n'est jamais remplacé : il est signalé.
 */
import { lstat, mkdir, readdir, readlink, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** @param {{ source: string; home: string; projet?: string; retirer?: boolean }} o */
export async function installerCommandes(o) {
  const source = resolve(o.source);
  const noms = (await readdir(source, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const cibles = o.projet ? [join(o.projet, ".claude", "skills")] : [join(o.home, ".claude", "skills"), join(o.home, ".copilot", "skills")];
  const poses = [];
  const retires = [];
  const refuses = [];
  for (const dossier of cibles) {
    for (const nom of noms) {
      const lien = join(dossier, nom);
      const vers = join(source, nom);
      const existant = await lstat(lien).catch(() => null);
      if (existant && !existant.isSymbolicLink()) {
        refuses.push(`${lien} existe déjà et n'est pas un lien : il n'est pas touché.`);
        continue;
      }
      if (existant && (await readlink(lien)) !== vers) {
        refuses.push(`${lien} pointe ailleurs (${await readlink(lien)}) : il n'est pas touché.`);
        continue;
      }
      if (o.retirer) {
        if (existant) {
          await rm(lien);
          retires.push(lien);
        }
        continue;
      }
      if (existant) await rm(lien);
      await mkdir(dossier, { recursive: true });
      // Sous Windows, une jonction : un lien de dossier ordinaire y demande des droits d'administrateur.
      await symlink(vers, lien, process.platform === "win32" ? "junction" : "dir");
      poses.push(lien);
    }
  }
  return { poses, retires, refuses };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--projet");
  const projet = i >= 0 ? args[i + 1] : undefined;
  if (i >= 0 && !projet) {
    process.stderr.write("--projet attend un dossier.\n");
    process.exit(2);
  }
  const r = await installerCommandes({ source: join(dirname(fileURLToPath(import.meta.url)), "..", "skills"), home: homedir(), ...(projet ? { projet: resolve(projet) } : {}), retirer: args.includes("--retirer") });
  for (const l of r.poses) process.stdout.write(`lien posé : ${l}\n`);
  for (const l of r.retires) process.stdout.write(`lien retiré : ${l}\n`);
  for (const l of r.refuses) process.stderr.write(`${l}\n`);
  if (r.poses.length) process.stdout.write("Redémarre Copilot CLI ou Claude Code : les commandes /skraft-… y apparaissent.\n");
  process.exit(r.refuses.length ? 1 : 0);
}
