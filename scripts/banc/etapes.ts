import type { ResumeEtape, ResumeRun } from "@agent-studio/core";

/**
 * Étapes communes du banc de comparaison (`docs/10` §3). Pur : aucune I/O.
 *
 * L'extension skraft nomme ses étapes par son stade (`CLASSIFY`, `REVIEW`…) ou sa phase ; le
 * workflow les annonce par `w.phase` et `w.etape`, avec les mêmes noms. Les deux sont ramenés ici
 * au même découpage, une fois pour toutes. Une revue, un arbitrage, une escalade ou un blocage
 * appartiennent à l'étape en cours : c'est elle qu'ils retardent.
 */

export const ETAPES = ["PRÉPARATION", "DIFFICULTÉ", "RESEARCH", "QUESTIONS", "DESIGN", "DISTILL", "DELIVER", "BILAN"] as const;
export type EtapeCommune = (typeof ETAPES)[number];

export interface Situation {
  etape: EtapeCommune;
  sousEtape?: string;
}

const DIRECTES: Record<string, Situation> = {
  INIT: { etape: "PRÉPARATION" },
  DÉBUT: { etape: "PRÉPARATION" },
  CLASSIFY: { etape: "DIFFICULTÉ", sousEtape: "classifieur" },
  CONFIRM_DIFFICULTY: { etape: "DIFFICULTÉ", sousEtape: "confirmation" },
  ROUTE: { etape: "QUESTIONS" },
  RESEARCH: { etape: "RESEARCH" },
  DESIGN: { etape: "DESIGN" },
  DISTILL: { etape: "DISTILL" },
  DELIVER: { etape: "DELIVER" },
  RATIFICATION: { etape: "DESIGN", sousEtape: "ratification" },
  DONE: { etape: "BILAN" },
  ABORTED: { etape: "BILAN", sousEtape: "abandon" },
};

const DANS_L_ETAPE: Record<string, string> = { REVIEW: "revue", ARBITRATION: "arbitrage", ESCALATED: "escalade", BLOCKED: "blocage" };

/** Étape commune d'un nom d'étape de la trace ; `courante` est l'étape commune en cours. */
export function etapeCommune(nom: string, courante: EtapeCommune = "PRÉPARATION"): Situation {
  const d = DIRECTES[nom];
  if (d) return d;
  const sous = DANS_L_ETAPE[nom];
  return { etape: courante, sousEtape: sous ?? nom };
}

/** Demande d'interaction, réduite à ce que le banc mesure. */
export interface Demande {
  createdAt: string;
  answer?: { answeredAt: string };
}

export interface Rejeu {
  etape: EtapeCommune;
  sousEtape?: string;
  /** Rang du rejet dans l'étape commune, à partir de 1 : l'essai qui a échoué. */
  essai: number;
  nature: "porte" | "revue" | "délai";
  porte: string;
  motifs: string[];
}

export interface LigneEtape {
  etape: EtapeCommune;
  sousEtapes: string[];
  duréeMs: number;
  /** Temps où une question attendait l'humain (création → réponse). */
  attenteHumaineMs: number;
  /** Durée murale moins l'attente humaine : ce qu'on compare entre les automates. */
  horsAttenteMs: number;
  agentsMs: number;
  codeMs: number;
  moteurMs: number;
  tours: number;
  appels: number;
  nanoAiu: number;
  entrée: number;
  sortie: number;
  essaisMax: number;
  rejets: number;
  interventions: number;
}

export interface ResumeComparable {
  etapes: LigneEtape[];
  rejeux: Rejeu[];
  total: Omit<LigneEtape, "etape" | "sousEtapes" | "essaisMax">;
}

const nature = (porte: string): Rejeu["nature"] => (porte === "revue" ? "revue" : porte === "délai" ? "délai" : "porte");

const ligne = (etape: EtapeCommune): LigneEtape => ({
  etape,
  sousEtapes: [],
  duréeMs: 0,
  attenteHumaineMs: 0,
  horsAttenteMs: 0,
  agentsMs: 0,
  codeMs: 0,
  moteurMs: 0,
  tours: 0,
  appels: 0,
  nanoAiu: 0,
  entrée: 0,
  sortie: 0,
  essaisMax: 0,
  rejets: 0,
  interventions: 0,
});

/**
 * Regroupe le résumé d'une trace (`resumerTrace`) par étape commune, dans l'ordre de première
 * apparition, et y ajoute l'attente humaine : chaque demande est comptée dans l'étape de la trace
 * où elle a été créée. Une demande restée sans réponse attend jusqu'à `fin`.
 */
export function resumerParEtape(resume: ResumeRun, demandes: readonly Demande[], fin?: string): ResumeComparable {
  const lignes: LigneEtape[] = [];
  const rejeux: Rejeu[] = [];
  const situations: Situation[] = [];
  let courante: EtapeCommune = "PRÉPARATION";
  for (const et of resume.etapes) {
    const s = etapeCommune(et.phase, courante);
    courante = s.etape;
    situations.push(s);
  }

  const borne = (et: ResumeEtape) => Date.parse(et.début) + et.duréeMs;
  const fin_ = fin ? Date.parse(fin) : Math.max(0, ...resume.etapes.map(borne));
  const attente = new Array<number>(resume.etapes.length).fill(0);
  const interventions = new Array<number>(resume.etapes.length).fill(0);
  for (const d of demandes) {
    const debut = Date.parse(d.createdAt);
    let i = resume.etapes.findLastIndex((et) => Date.parse(et.début) <= debut);
    if (i < 0) i = 0;
    if (!resume.etapes.length) break;
    attente[i]! += Math.max(0, (d.answer ? Date.parse(d.answer.answeredAt) : fin_) - debut);
    interventions[i]!++;
  }

  resume.etapes.forEach((et, i) => {
    const s = situations[i]!;
    let l = lignes.find((x) => x.etape === s.etape);
    if (!l) lignes.push((l = ligne(s.etape)));
    if (s.sousEtape && !l.sousEtapes.includes(s.sousEtape)) l.sousEtapes.push(s.sousEtape);
    l.duréeMs += et.duréeMs;
    l.attenteHumaineMs += attente[i]!;
    l.interventions += interventions[i]!;
    l.agentsMs += et.agentsMs;
    l.codeMs += et.codeMs;
    l.moteurMs += et.moteurMs;
    l.tours += et.tours;
    l.appels += et.appels;
    l.nanoAiu += et.nanoAiu;
    l.entrée += et.entrée;
    l.sortie += et.sortie;
    l.essaisMax = Math.max(l.essaisMax, et.essaisMax);
    for (const r of et.rejets) {
      l.rejets++;
      rejeux.push({ etape: s.etape, ...(s.sousEtape ? { sousEtape: s.sousEtape } : {}), essai: l.rejets, nature: nature(r.porte), porte: r.porte, motifs: r.motifs });
    }
  });
  for (const l of lignes) l.horsAttenteMs = Math.max(0, l.duréeMs - l.attenteHumaineMs);

  const somme = (k: keyof ResumeComparable["total"]) => lignes.reduce((n, l) => n + l[k], 0);
  return {
    etapes: lignes,
    rejeux,
    total: {
      duréeMs: somme("duréeMs"),
      attenteHumaineMs: somme("attenteHumaineMs"),
      horsAttenteMs: somme("horsAttenteMs"),
      agentsMs: somme("agentsMs"),
      codeMs: somme("codeMs"),
      moteurMs: somme("moteurMs"),
      tours: somme("tours"),
      appels: somme("appels"),
      nanoAiu: somme("nanoAiu"),
      entrée: somme("entrée"),
      sortie: somme("sortie"),
      rejets: somme("rejets"),
      interventions: somme("interventions"),
    },
  };
}
