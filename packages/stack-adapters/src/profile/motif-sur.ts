/**
 * Motif d'expression régulière venu d'un profil, donc du dépôt du projet : une source non fiable
 * (`buildErrors.pattern`, `architecture.import`, ADR 0072). Un moteur d'expressions régulières ne
 * s'interrompt pas : la seule protection est de ne jamais lui donner de quoi s'emballer. D'où trois
 * bornes, qui ne relèvent pas du confort : le motif est refusé s'il porte un quantificateur
 * imbriqué ou s'il est démesuré, il est appliqué **ligne à ligne**, et le nombre de lignes comme la
 * longueur de chacune sont plafonnés par ceux qui l'appliquent (`LIGNE_MAX`, `LIGNES_MAX`).
 */

/** Au-delà, une ligne n'est pas un message d'outil ni une ligne de code utile : on ne la soumet pas au moteur. */
export const LIGNE_MAX = 1000;
/** Lignes examinées au plus par texte. */
export const LIGNES_MAX = 20_000;
const MOTIF_MAX = 300;

/**
 * Quantificateur appliqué à un groupe qui en contient déjà un — `(\w+)+`, `(a*)*`, `(.+)*`. C'est
 * la forme qui fait revenir le moteur sur ses pas de façon exponentielle. Heuristique, donc
 * imparfaite : elle écarte les cas connus, elle ne prouve pas l'absence de tout risque. Les bornes
 * d'exécution sont là pour ce qu'elle laisse passer.
 */
const QUANTIFICATEUR_IMBRIQUE = /\([^)]*[+*}][^)]*\)\s*[+*]|\([^)]*[+*][^)]*\)\s*\{\d/;

/** `champ` nomme le motif dans les messages (`buildErrors.pattern`) ; `groupes`, les groupes nommés exigés. */
export function compilerMotifSur(champ: string, motif: string, groupes: readonly string[]): { re: RegExp } | { error: string } {
  if (motif.length > MOTIF_MAX) return { error: `\`${champ}\` est trop long (${motif.length} caractères, maximum ${MOTIF_MAX}).` };
  if (QUANTIFICATEUR_IMBRIQUE.test(motif))
    return {
      error:
        `\`${champ}\` contient un quantificateur imbriqué (de la forme \`(…+)+\`) : ` +
        "cette construction fait revenir le moteur sur ses pas de façon exponentielle et figerait l'application.",
    };
  if (groupes.some((g) => !motif.includes(`(?<${g}>`)))
    return { error: `\`${champ}\` doit comporter ${groupes.length > 1 ? "les groupes nommés" : "le groupe nommé"} ${groupes.map((g) => `\`(?<${g}>…)\``).join(" et ")}.` };
  try {
    return { re: new RegExp(motif) };
  } catch (err) {
    return { error: `\`${champ}\` n'est pas une expression régulière valide : ${err instanceof Error ? err.message : String(err)}` };
  }
}
