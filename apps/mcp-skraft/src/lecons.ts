/**
 * Les leçons d'un projet (LEC-2, freecompub/AgentStudio#33), vues par le serveur MCP : le fichier que le
 * workflow tient à la fin de chaque run, lu et présenté par statut ; ratifier ou retirer une leçon n'en
 * change qu'un champ, après l'accord de l'utilisateur obtenu par le client.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Le fichier des leçons du projet, écrit par le code seulement (le workflow, ou ce serveur). */
export const FICHIER_DES_LECONS = ".agent-studio/lecons/lecons.jsonl";

export type StatutDeLecon = "candidate" | "validee" | "retiree";

export interface Lecon {
  id: string;
  groupe: string;
  regle: string;
  quand: string;
  aFaire: string;
  exemple: string;
  sources: string[];
  catalogue: { skill: string; section: string } | { nouvelle: { skill: string; titre: string } };
  role: string;
  phase: string;
  statut: StatutDeLecon;
  ratifiee?: boolean;
}

const TITRES: Record<StatutDeLecon, string> = { validee: "Validées", candidate: "Candidates", retiree: "Retirées" };

export async function lireLecons(root: string): Promise<Lecon[]> {
  try {
    return (await readFile(join(root, FICHIER_DES_LECONS), "utf8"))
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Lecon);
  } catch {
    return [];
  }
}

export async function ecrireLecons(root: string, lecons: readonly Lecon[]): Promise<void> {
  const fichier = join(root, FICHIER_DES_LECONS);
  await mkdir(dirname(fichier), { recursive: true });
  const tmp = `${fichier}.${process.pid}.tmp`;
  await writeFile(tmp, lecons.length ? `${lecons.map((l) => JSON.stringify(l)).join("\n")}\n` : "");
  await rename(tmp, fichier);
}

const entree = (l: Lecon) => ("nouvelle" in l.catalogue ? `nouvelle entrée « ${l.catalogue.nouvelle.titre} » proposée pour ${l.catalogue.nouvelle.skill}` : `${l.catalogue.skill}, section « ${l.catalogue.section} »`);

/** Une leçon, telle que l'utilisateur la lit. */
export function decrireLecon(l: Lecon): string {
  return [
    `- **${l.id}** — ${l.regle}`,
    `  Quand : ${l.quand} À faire : ${l.aFaire}`,
    `  Catalogue : ${entree(l)}${"nouvelle" in l.catalogue ? (l.ratifiee ? " (ratifiée)" : " (à ratifier)") : ""}.`,
    `  Rôle : ${l.role}, phase ${l.phase}. Sources : ${l.sources.join(", ")} ; exemple : ${l.exemple}.`,
  ].join("\n");
}

/** Les leçons par statut ; un statut donné filtre la liste. */
export function listeDesLecons(lecons: readonly Lecon[], statut?: StatutDeLecon): string {
  const statuts = statut ? [statut] : (["validee", "candidate", "retiree"] as const);
  const sections = statuts.map((s) => {
    const du = lecons.filter((l) => l.statut === s);
    return `## ${TITRES[s]} (${du.length})\n${du.length ? du.map(decrireLecon).join("\n") : "(aucune)"}`;
  });
  return lecons.length ? sections.join("\n\n") : `Aucune leçon dans ce projet (${FICHIER_DES_LECONS}) : elles naissent à la fin des runs qui ont des erreurs.`;
}
