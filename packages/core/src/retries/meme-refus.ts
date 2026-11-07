/**
 * Disjoncteur des réessais (ADR 0073, repris de l'idée de skraft-plugin v2) : quand un travail est
 * refusé deux fois de suite **de la même façon**, le troisième essai refait presque toujours la même
 * erreur. On escalade alors aussitôt. PUR.
 */
export interface Refus {
  porte: string;
  motifs: readonly string[];
}

/** Début du motif d'une escalade déclenchée par le disjoncteur. */
export const MEME_REFUS = "Même refus deux fois de suite : ";

/** Même porte, et même ensemble de motifs (espaces de début et de fin ignorés, ordre indifférent). */
export function memeRefus(avant: Refus | null | undefined, apres: Refus): boolean {
  if (!avant || avant.porte !== apres.porte || !apres.motifs.length) return false;
  const ensemble = (m: readonly string[]) => [...new Set(m.map((x) => x.trim()))].sort();
  const [a, b] = [ensemble(avant.motifs), ensemble(apres.motifs)];
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Motifs d'une escalade par le disjoncteur : préfixés une fois, même s'ils remontent d'un niveau à l'autre. */
export function disjoncte(motifs: readonly string[]): string[] {
  if (!motifs.length || motifs[0]!.startsWith(MEME_REFUS)) return [...motifs];
  return [`${MEME_REFUS}${motifs[0]}`, ...motifs.slice(1)];
}
