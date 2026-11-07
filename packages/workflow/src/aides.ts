/**
 * Aides de bibliothèque (`docs/09` §5.2) : écrites avec les seuls appels `w.*`, en code ordinaire,
 * donc lisibles et remplaçables. Aucune n'a de pouvoir que le script n'aurait pas.
 */
import { Escalade, TourInterrompu } from "./erreurs.js";
import type { OptionsAgent, W } from "./protocols.js";
import { disjoncte, memeRefus, type Refus } from "@agent-studio/core";

/**
 * Rejet d'un essai : des motifs de porte, ou les défauts d'une revue (ADR 0042, 0046). `garanti`
 * donne un essai de plus malgré un budget épuisé : un arbitrage humain a maintenu un défaut, il a
 * droit à sa correction (`docs/09` §13, écart 9).
 */
export type Rejet =
  | readonly string[]
  | {
      motifs: readonly string[];
      revue?: true;
      garanti?: boolean;
      /** Nom de la porte, pour la trace. */
      porte?: string;
      /**
       * Information nouvelle plutôt qu'échec (question de revue tranchée par l'humain, D4 de
       * `docs/12`) : l'essai est rejoué avec ces motifs sans consommer de budget. Le script l'a
       * déjà tracé, avec la réponse.
       */
      nonCompte?: true;
    };

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
 * - un rejet `nonCompte` rejoue l'essai avec ses motifs, sans le compter ;
 * - une panne d'environnement n'est pas comptée et remonte aussitôt (D25).
 */
export async function essayer(
  w: W,
  opts: { max: number; premiereRevueGarantie?: boolean; /** Motifs du premier essai : ceux d'une phase relancée (D15 de docs/12). */ motifs?: readonly string[] },
  fn: (motifs: readonly string[], essai: number) => Promise<Rejet>,
): Promise<void> {
  let motifs: readonly string[] = opts.motifs ?? [];
  let revues = 0;
  /** Dernier refus compté, pour le disjoncteur (ADR 0073). */
  let precedent: Refus | null = null;
  for (let essai = 1; ; essai++) {
    let rejet: Rejet;
    let interrompu = false;
    try {
      rejet = await fn(motifs, essai);
    } catch (e) {
      if (!(e instanceof TourInterrompu)) throw e;
      rejet = motifsInterruption(e.message);
      interrompu = true;
    }
    const objet = Array.isArray(rejet) ? null : (rejet as { motifs: readonly string[]; revue?: true; porte?: string; nonCompte?: true });
    const revue = objet?.revue === true;
    const m = objet ? objet.motifs : (rejet as readonly string[]);
    if (!m.length) return;
    if (objet?.nonCompte) {
      motifs = m;
      essai--;
      continue;
    }
    // Chaque essai refusé est tracé, avec sa cause : c'est ce qui dira, après un run, pourquoi
    // un travail a été refait (docs/10 §4.3).
    const porte = objet?.porte ?? (interrompu ? "délai" : revue ? "revue" : "porte");
    await w.rejet(porte, m);
    if (revue) revues++;
    const demande = Array.isArray(rejet) ? undefined : (rejet as { garanti?: boolean }).garanti;
    const garanti = demande ?? (opts.premiereRevueGarantie === true && revue && revues === 1);
    // Disjoncteur (ADR 0073) : deux refus identiques de suite, le suivant referait la même erreur.
    // Un tour interrompu se réessaie (SPEC §6), et un essai garanti ne compte pas : l'un comme
    // l'autre rompt la suite.
    const refus = interrompu || garanti ? null : { porte, motifs: m };
    if (refus && memeRefus(precedent, refus)) throw new Escalade(disjoncte(m));
    precedent = refus;
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
