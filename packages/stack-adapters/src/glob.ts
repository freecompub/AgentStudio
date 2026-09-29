/**
 * Motif glob minimal (`**`, `*`, `?`) converti en expression régulière ancrée, chemins en `/`.
 *
 * Vit ici parce que `stack-adapters` est le paquet le plus bas qui en ait besoin : les
 * emplacements d'une stack sont des globs. `extension-api` le réexporte, de sorte qu'une
 * extension n'ait toujours qu'un seul paquet à connaître (D10).
 */
// Suites de globstars repliées en une seule : un globstar répété désigne exactement la même
// chose qu'un seul, mais produisait autant de `(?:.*/)?` consécutifs — et deux quantificateurs
// `.*` qui se suivent font revenir le moteur sur ses pas de façon exponentielle. Mesuré sur ce
// code : quatorze globstars contre un chemin de vingt segments prenaient 170 SECONDES pour un
// seul `test()`, dans le processus principal, sur un motif venu du dépôt du projet.
const replier = (glob: string) => glob.replace(/(?:\*\*\/)+/g, "**/");

/**
 * `drapeaux` permet la comparaison **insensible à la casse**, nécessaire pour tout ce qui *refuse*
 * (ADR 0035) : Windows et macOS ont un système de fichiers insensible par défaut, et sans cela un
 * gel se contourne par une majuscule — `.skraft/QUALITY.JSON` est le même fichier que
 * `.skraft/quality.json`. Voir `matchesAny` et `matchesAnyIgnoringCase` pour le partage des rôles.
 */
export function globToRegExp(glob: string, drapeaux = ""): RegExp {
  glob = replier(glob);
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      re += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, drapeaux);
}

/**
 * Pour **accorder** : sensible à la casse, afin d'accorder le moins possible. Sur un système
 * sensible — Linux —, `.SKRAFT/` est un autre dossier que `.skraft/`, qu'on n'a aucune raison
 * d'ouvrir parce qu'ailleurs les deux se confondraient.
 */
export function matchesAny(globs: readonly string[], path: string): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}

/**
 * Pour **refuser** : insensible à la casse, afin d'attraper le plus possible.
 *
 * Les deux moitiés de la règle vont dans le même sens — refuser par défaut. Un gel qui ne
 * reconnaîtrait pas `.skraft/QUALITY.JSON` laisserait réécrire la barre de qualité sur les deux
 * systèmes de fichiers que ce projet vise majoritairement.
 */
export function matchesAnyIgnoringCase(globs: readonly string[], path: string): boolean {
  return globs.some((g) => globToRegExp(g, "i").test(path));
}
