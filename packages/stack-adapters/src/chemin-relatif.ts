import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";

/**
 * Chemin d'un fichier **relatif à la racine du projet**, tel que les portes et les preuves
 * l'attendent.
 *
 * La racine est résolue : un outil rapporte les chemins réels, et sous macOS `tmpdir()` passe par
 * `/var`, lien vers `/private/var`. Comparer sans résoudre donnait
 * `../../../../private/var/…/src/a.js` au lieu de `src/a.js` — et comme les portes rapprochent
 * `analyzed` des fichiers qu'elles ont demandés, plus rien ne correspondait : la porte concluait
 * « rien n'a été jugé » alors que le linter avait parfaitement travaillé. Trouvé en faisant tourner
 * un vrai ESLint ; trois lecteurs sur quatre avaient ce défaut, seul `parseVitestReport` résolvait.
 *
 * Tolérant à une racine inexistante — les tests de politiques travaillent sur des chemins fictifs —,
 * auquel cas la racine est prise telle quelle. Mise en cache : un rapport porte des centaines de
 * fichiers pour une seule racine.
 */
const cache = new Map<string, string>();

function racineReelle(root: string): string {
  const connu = cache.get(root);
  if (connu !== undefined) return connu;
  let reelle = root;
  try {
    reelle = realpathSync(root);
  } catch {
    /* racine inexistante : on garde le chemin fourni */
  }
  if (cache.size > 64) cache.clear(); // borne : ce cache ne doit pas croître avec les projets ouverts
  cache.set(root, reelle);
  return reelle;
}

export function relatifDepuis(root: string, fichier: string): string {
  if (!isAbsolute(fichier)) return fichier.replaceAll("\\", "/");
  return relative(racineReelle(root), fichier).replaceAll("\\", "/");
}
