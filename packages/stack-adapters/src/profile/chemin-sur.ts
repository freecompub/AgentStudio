import { realpath } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";

/**
 * Résolution d'un chemin destiné à être **écrit**, liens symboliques compris.
 *
 * Un contrôle textuel ne suffit pas. Le dépôt d'un projet peut porter un lien symbolique — et
 * l'agent peut l'y créer, puisque c'est une écriture dans le projet —, et `git worktree` le
 * reproduit fidèlement dans la copie isolée. Le chemin `tests/x.py` ne contient alors aucun `..`,
 * donc `resolve` puis `relative` le croient interne, alors que l'écriture atterrit où pointe le
 * lien. Le contenu écrit étant choisi par le profil, et le fichier étant ensuite supprimé, la
 * conséquence serait d'écraser puis de détruire un fichier de l'utilisateur.
 *
 * Le fichier visé n'existe pas encore : on résout le premier ancêtre existant, puis on lui
 * raccroche le reste. Même algorithme que `realPath` du cœur, réécrit ici parce que
 * `stack-adapters` ne dépend que de `yaml` et `zod` — l'y faire dépendre du cœur inverserait le
 * sens des dépendances. Toute correction à l'un doit être portée à l'autre.
 */
async function reel(chemin: string): Promise<string> {
  const absolu = resolve(chemin);
  let existant = absolu;
  const suffixe: string[] = [];
  for (;;) {
    try {
      const r = await realpath(existant);
      return suffixe.length === 0 ? r : resolve(r, ...suffixe);
    } catch {
      const parent = dirname(existant);
      if (parent === existant) return absolu; // rien n'existe : le chemin tel quel
      suffixe.unshift(basename(existant));
      existant = parent;
    }
  }
}

/**
 * Chemin absolu où écrire `relatif` sous `base`, ou `null` si la cible sort de `base` une fois
 * les liens résolus. La base elle-même est résolue : sous macOS, `tmpdir()` passe par `/var`,
 * qui est un lien vers `/private/var`.
 */
export async function cheminSous(base: string, relatif: string): Promise<string | null> {
  const baseReelle = await reel(base);
  const cible = await reel(resolve(baseReelle, relatif));
  const ecart = relative(baseReelle, cible);
  if (ecart === "" || ecart.startsWith("..") || resolve(baseReelle, ecart) !== cible) return null;
  return cible;
}
