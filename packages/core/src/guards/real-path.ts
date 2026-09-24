import { realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

/**
 * Chemin absolu, liens symboliques résolus (§10.1).
 *
 * Les gardes de périmètre comparent des chemins : un lien placé **dans** le projet et pointant
 * dehors donne un chemin sans `..`, donc réputé interne alors que l'écriture atterrit ailleurs.
 * L'agent peut créer ce lien lui-même, puisque c'est une écriture dans le projet.
 *
 * Le fichier visé n'existe pas forcément encore : on résout le premier ancêtre existant, puis on
 * lui raccroche le reste. Quand rien n'existe — chemin fictif d'un test de politique — la valeur
 * rendue est celle de `resolve`, si bien que les politiques restent jugeables sans disque.
 */
export function realPath(p: string): string {
  const absolu = resolve(p);
  let existant = absolu;
  const suffixe: string[] = [];
  for (;;) {
    try {
      return suffixe.length === 0 ? realpathSync(existant) : resolve(realpathSync(existant), ...suffixe);
    } catch {
      const parent = dirname(existant);
      if (parent === existant) return absolu; // remonté jusqu'à la racine sans rien trouver
      suffixe.unshift(basename(existant));
      existant = parent;
    }
  }
}
