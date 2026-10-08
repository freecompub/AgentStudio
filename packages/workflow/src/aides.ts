/**
 * Aides de bibliothèque (`docs/09` §5.2) : écrites avec les seuls appels `w.*`, en code ordinaire,
 * donc lisibles et remplaçables. Aucune n'a de pouvoir que le script n'aurait pas.
 */
import { Escalade, TourInterrompu } from "./erreurs.js";
import type { OptionsAgent, W } from "./protocols.js";

/** Rejet d'un essai : des motifs de porte, ou les défauts d'une revue (ADR 0042, 0046). */
export type Rejet = readonly string[] | { motifs: readonly string[]; revue: true };

/**
 * Motifs rendus après un tour interrompu (ADR 0029, 0040). La seconde phrase compte autant que la
 * première : sans elle, l'agent relit des fichiers à moitié écrits en les croyant finis.
 */
export const motifsInterruption = (raison: string): string[] => [
  `Le tour précédent a été interrompu (${raison}) : aucune porte n'a jugé ton travail.`,
  "Ce que tu avais écrit est resté sur le disque, possiblement incomplet. Reprends-le et termine-le ; ne recommence pas de zéro, et ne considère aucun fichier comme fini sans l'avoir relu.",
];

/**
 * Relance `fn` tant qu'elle rend des motifs et que le budget le permet, **sans rembobiner**
 * (ADR 0040) : les motifs d'un essai passent au suivant. À épuisement, lève `Escalade`.
 *
 * - le budget est partagé entre portes et revue (ADR 0042) ; avec `premiereRevueGarantie`, la
 *   première revue défavorable obtient un essai même si le budget est épuisé, une seule fois ;
 * - un tour interrompu compte comme un rejet, avec la consigne de reprendre ;
 * - une panne d'environnement n'est pas comptée et remonte aussitôt (D25).
 */
export async function essayer(_w: W, opts: { max: number; premiereRevueGarantie?: boolean }, fn: (motifs: readonly string[], essai: number) => Promise<Rejet>): Promise<void> {
  let motifs: readonly string[] = [];
  let revues = 0;
  for (let essai = 1; ; essai++) {
    let rejet: Rejet;
    try {
      rejet = await fn(motifs, essai);
    } catch (e) {
      if (!(e instanceof TourInterrompu)) throw e;
      rejet = motifsInterruption(e.message);
    }
    const revue = !Array.isArray(rejet) && "revue" in rejet;
    const m = Array.isArray(rejet) ? (rejet as readonly string[]) : (rejet as { motifs: readonly string[] }).motifs;
    if (!m.length) return;
    if (revue) revues++;
    const garanti = opts.premiereRevueGarantie === true && revue && revues === 1;
    if (essai >= opts.max && !garanti) throw new Escalade(m);
    motifs = m;
  }
}

/**
 * Un tour d'agent mené jusqu'à sa sortie : si l'agent pose une question bloquante
 * (`report_blocker`, D31), elle part à l'humain (question `blocage`), puis le **même** agent est
 * relancé avec la réponse.
 */
export async function agir<S = Record<string, unknown>>(w: W, nom: string, consigne: string, opts: OptionsAgent = {}): Promise<S> {
  let texte = consigne;
  for (;;) {
    const r = await w.agent<S>(nom, texte, opts);
    if (!r.blocage) return r.sortie as S;
    const { question, choix } = r.blocage;
    const d = await w.humain("blocage", question, choix.map((c, i) => ({ id: String(i), label: c })));
    const reponse = choix[Number(d.decision)] ?? d.commentaire ?? d.decision;
    texte = `${consigne}\n\nRéponse de l'utilisateur à ta question « ${question} » : ${reponse}`;
  }
}
