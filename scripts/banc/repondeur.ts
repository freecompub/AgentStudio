/**
 * Répondeur commun du banc de comparaison (`docs/10` P4). Pur : il ne fait que choisir.
 *
 * L'extension skraft et le workflow skraft posent les mêmes questions avec des identifiants
 * différents (`medium-hard` contre `4:medium-hard`, `accept:ADR-001` contre `12:accept`, `retry`
 * contre `7:relancer`). Une option est donc reconnue par son **action** : l'identifiant tel quel,
 * ou un préfixe `action:…`, ou un suffixe `…:action`. Ainsi, la même question reçoit la même
 * décision dans les deux runs, ce qui est la condition pour les comparer.
 */

export interface Reponses {
  /** Niveau retenu à la confirmation de la difficulté. */
  difficulte: "simple" | "medium" | "medium-hard" | "challenging";
  /** Réponse à une question ouverte, choisie par motif (expression régulière, sans la casse) sur la question. */
  questions: { motif: string; reponse: string }[];
  /** Réponse quand aucun motif ne correspond : jamais vide, pour que les deux runs reçoivent du texte. */
  questionParDefaut: string;
  ratification: "accepter" | "rejeter";
  /** À qui donner raison quand un désaccord de revue persiste. */
  arbitrage: "lentille" | "agent";
  /** Relances d'une même escalade avant d'abandonner. */
  relancesParEscalade: number;
  /** Choix à une question bloquante d'agent, par motif ; sinon le premier choix proposé. */
  blocages: { motif: string; choix: string }[];
}

export interface Demande {
  title: string;
  detail?: string;
  options: { id: string; label: string }[];
}

export type Nature = "difficulte" | "question" | "ratification" | "arbitrage" | "escalade" | "blocage" | "inconnue";

export interface Choix {
  nature: Nature;
  option: string;
  commentaire?: string;
}

const correspond = (id: string, action: string) => id === action || id.startsWith(`${action}:`) || id.endsWith(`:${action}`);
const option = (d: Demande, actions: readonly string[]) => d.options.find((o) => actions.some((a) => correspond(o.id, a)));

/** Nature de la demande, d'après son titre (les deux implémentations, mêmes libellés à peu près). */
function nature(d: Demande): Nature {
  const t = d.title;
  if (/^Difficulté/.test(t)) return "difficulte";
  if (/^Question ouverte/.test(t)) return "question";
  if (/^Ratifier/.test(t)) return "ratification";
  if (/^Arbitrer/.test(t)) return "arbitrage";
  if (/^Question de l'agent/.test(t)) return "blocage";
  if (/^Pipeline skraft bloqué|^Phase [A-ZÉ]+ :/.test(t)) return "escalade";
  return "inconnue";
}

const cherche = <T extends { motif: string }>(motifs: T[], texte: string): T | undefined => motifs.find((m) => new RegExp(m.motif, "i").test(texte));

/**
 * Choisit l'option et le commentaire éventuel. `memoire` compte les escalades par motif,
 * d'une demande à l'autre, pour abandonner après `relancesParEscalade` relances.
 */
export function repondre(d: Demande, r: Reponses, memoire: Map<string, number>): Choix {
  const n = nature(d);
  const premiere = d.options[0]!.id;
  switch (n) {
    case "difficulte":
      return { nature: n, option: option(d, [r.difficulte])?.id ?? premiere };
    case "question": {
      const texte = cherche(r.questions, `${d.title}\n${d.detail ?? ""}`)?.reponse ?? r.questionParDefaut;
      return { nature: n, option: option(d, ["answer"])?.id ?? premiere, commentaire: texte };
    }
    case "ratification":
      return { nature: n, option: option(d, [r.ratification === "accepter" ? "accept" : "reject"])?.id ?? premiere };
    case "arbitrage":
      return { nature: n, option: option(d, [r.arbitrage === "lentille" ? "maintain" : "accept"])?.id ?? premiere };
    case "escalade": {
      // Même escalade : même motif, que le titre le porte (workflow) ou le détail (extension).
      const cle = `${d.title.replace(/^Phase [A-ZÉ]+ : /, "")}\n${d.detail ?? ""}`.trim();
      const vues = (memoire.get(cle) ?? 0) + 1;
      memoire.set(cle, vues);
      const actions = vues > r.relancesParEscalade ? ["abort", "abandonner"] : ["retry", "relancer"];
      return { nature: n, option: option(d, actions)?.id ?? premiere };
    }
    case "blocage": {
      const voulu = cherche(r.blocages, `${d.title}\n${d.detail ?? ""}`)?.choix;
      const o = voulu ? d.options.find((x) => x.label === voulu) : undefined;
      return { nature: n, option: o?.id ?? premiere };
    }
    default:
      return { nature: n, option: premiere };
  }
}
