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

export function globToRegExp(glob: string): RegExp {
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
  return new RegExp(`^${re}$`);
}

export function matchesAny(globs: readonly string[], path: string): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}
