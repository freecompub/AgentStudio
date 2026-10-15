/**
 * Recalcule « Coût des revues et des corrections » sur un run déjà enregistré dans `docs/runs/`,
 * à partir de sa trace et de ses preuves. Aucune requête au modèle.
 *
 *   pnpm banc:revues docs/runs/2026-10-10-us-2-extension-c4433175
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { mesurerRevues, sectionRevues, type Entree, type Preuve } from "./revues.js";

const dossier = process.argv[2];
if (!dossier) {
  console.error("Utilisation : pnpm banc:revues <dossier d'un run, dans docs/runs/>");
  process.exit(1);
}
const lignes = async <T>(fichier: string): Promise<T[]> =>
  (await readFile(join(dossier, fichier), "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
const requetes = (nanoAiu: number) => Math.round((nanoAiu / 1e9) * 10) / 10;
console.log(sectionRevues(mesurerRevues(await lignes<Entree>("trace.jsonl"), await lignes<Preuve>("preuves.jsonl")), requetes).join("\n"));
