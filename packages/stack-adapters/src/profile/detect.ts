import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Détection d'une pile par un profil (ADR 0072, point 1) : un fichier qui existe, ou qui existe ET
 * contient une sous-chaîne. Un élément qui correspond suffit. La sous-chaîne n'est pas une
 * expression régulière : elle vient du dépôt, et rien ne s'y emballe.
 */
export type ElementDetect = string | { fichier: string; contient: string };

/** Au-delà, ce n'est pas un fichier de configuration : on ne le lit pas. */
const TAILLE_MAX = 1_000_000;

export async function detecte(elements: readonly ElementDetect[], racine: string): Promise<boolean> {
  for (const e of elements) if (await correspond(e, racine)) return true;
  return false;
}

async function correspond(e: ElementDetect, racine: string): Promise<boolean> {
  const chemin = join(racine, typeof e === "string" ? e : e.fichier);
  const s = await stat(chemin).catch(() => null);
  if (!s) return false;
  if (typeof e === "string") return true;
  if (!s.isFile() || s.size > TAILLE_MAX) return false;
  return (await readFile(chemin, "utf8").catch(() => "")).includes(e.contient);
}

/** Libellé d'un élément, pour `/stack doctor`. */
export const libelleDetect = (e: ElementDetect): string => (typeof e === "string" ? e : `${e.fichier} contenant « ${e.contient} »`);
