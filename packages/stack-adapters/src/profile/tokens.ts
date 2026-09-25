/**
 * Les deux seuls jetons substitués dans les arguments d'une commande de profil : `{rapport}`,
 * remplacé par un fichier temporaire hors du projet, et `{fichiers}`, développé en autant
 * d'arguments que de fichiers. Tout le reste passe tel quel, sans shell — un profil vient du
 * dépôt du projet et ne doit pas pouvoir fabriquer une commande par interpolation.
 */
export const JETON_RAPPORT = "{rapport}";
export const JETON_FICHIERS = "{fichiers}";

export function substituer(args: readonly string[], rapport: string, fichiers: readonly string[]): string[] {
  const out: string[] = [];
  for (const a of args) {
    if (a === JETON_FICHIERS) out.push(...fichiers);
    else out.push(a.replaceAll(JETON_RAPPORT, rapport));
  }
  return out;
}
