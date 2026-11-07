import type { TraceEntry, TurnEnd } from "../protocols/trace.js";

/** Ce qu'une étape d'un run a coûté et rencontré. */
export interface ResumeEtape {
  phase: string;
  /** Rang de l'étape parmi celles de la même phase : 1, puis 2 au premier rejeu, etc. */
  essai: number;
  début: string;
  /** Début de l'étape suivante, ou dernier événement de la trace. */
  fin: string;
  duréeMs: number;
  /** Tours d'agent commencés : chacun est au moins un message envoyé au modèle. */
  tours: number;
  /** Plus grand compteur d'essais vu dans l'étape (convention `attempts` de l'état). */
  essaisMax: number;
  rejets: { porte: string; motifs: string[] }[];
  /** Tours terminés autrement que par une sortie ou un blocage déclaré. */
  finsAnormales: { fin: TurnEnd; raison?: string }[];
  appels: number;
  entrée: number;
  sortie: number;
  nanoAiu: number;
  /** Coût en dollars, quand le runtime le rend (Claude, ADR 0070) ; 0 sinon. */
  coûtUsd: number;
  /** Modèles réellement utilisés par les appels de l'étape (ADR 0048). */
  modèles: string[];
  /** Temps des tours d'agent commencés dans l'étape (du début à la fin de chaque tour). */
  agentsMs: number;
  /** Temps des effets exécutés dans l'étape (agents compris). */
  effetsMs: number;
  /** Temps du code : effets moins tours d'agent (tests, mutation, Git, lectures). */
  codeMs: number;
  /** Temps de calcul des transitions : coût du moteur, rejeu du script compris. */
  moteurMs: number;
}

export interface ResumeRun {
  /** Étapes dans l'ordre chronologique ; une phase qui revient forme une nouvelle étape. */
  etapes: ResumeEtape[];
  /** Les mêmes, additionnées par nom de phase, dans l'ordre de première apparition. */
  parPhase: ResumeEtape[];
  total: Omit<ResumeEtape, "phase" | "essai" | "début" | "fin" | "essaisMax" | "rejets" | "finsAnormales" | "modèles"> & { rejets: number };
}

const NORMALES: readonly TurnEnd[] = ["output", "blocker"];

const vide = (phase: string, essai: number, début: string): ResumeEtape => ({
  phase,
  essai,
  début,
  fin: début,
  duréeMs: 0,
  tours: 0,
  essaisMax: 0,
  rejets: [],
  finsAnormales: [],
  appels: 0,
  entrée: 0,
  sortie: 0,
  nanoAiu: 0,
  coûtUsd: 0,
  modèles: [],
  agentsMs: 0,
  effetsMs: 0,
  codeMs: 0,
  moteurMs: 0,
});

/**
 * Résume une trace par étape (ADR 0032). PURE.
 *
 * Une étape commence quand la phase annoncée par une transition ou un début de tour change, ou
 * quand la phase reprend après un rejet, et dure jusqu'au début de la suivante : **chaque rejeu est
 * une étape**, numérotée par phase (`essai`). Un rejet ne porte pas de phase : il appartient à
 * l'étape en cours, l'essai qui a échoué. L'usage, lui, ne porte que sa session : il est rattaché à
 * l'étape où la session a commencé, même s'il arrive après un changement de phase.
 */
export function resumerTrace(entries: readonly TraceEntry[]): ResumeRun {
  const etapes: ResumeEtape[] = [];
  const etapeDeSession = new Map<string, ResumeEtape>();
  const debutDeSession = new Map<string, number>();
  let courante: ResumeEtape | undefined;
  let dernier = "";

  // Après un rejet, la prochaine activité de la phase ouvre un nouvel essai.
  let rejouer = false;
  const entrer = (phase: string, at: string): ResumeEtape => {
    if (courante?.phase === phase && !rejouer) return courante;
    rejouer = false;
    courante = vide(phase, etapes.filter((x) => x.phase === phase).length + 1, at);
    etapes.push(courante);
    return courante;
  };

  for (const e of entries) {
    dernier = e.at;
    if (e.kind === "transition") {
      const et = entrer(e.phase ?? courante?.phase ?? "?", e.at);
      if (typeof e.essais === "number") et.essaisMax = Math.max(et.essaisMax, e.essais);
      if (typeof e.duréeMs === "number") et.moteurMs += e.duréeMs;
    } else if (e.kind === "tour-début") {
      const et = entrer(e.phase ?? courante?.phase ?? "?", e.at);
      et.tours++;
      if (e.sessionId) {
        etapeDeSession.set(e.sessionId, et);
        debutDeSession.set(e.sessionId, Date.parse(e.at));
      }
    } else if (e.kind === "rejet") {
      (courante ?? entrer("?", e.at)).rejets.push({ porte: e.porte, motifs: e.motifs });
      rejouer = true;
    } else if (e.kind === "effet") {
      entrer(e.phase ?? courante?.phase ?? "?", e.at).effetsMs += e.duréeMs;
    } else if (e.kind === "tour-fin") {
      const debut = e.sessionId ? debutDeSession.get(e.sessionId) : undefined;
      if (e.sessionId && debut !== undefined) {
        const et = etapeDeSession.get(e.sessionId) ?? entrer(courante?.phase ?? "?", e.at);
        et.agentsMs += Math.max(0, Date.parse(e.at) - debut);
        debutDeSession.delete(e.sessionId);
      }
      if (!NORMALES.includes(e.fin)) {
        const et = (e.sessionId && etapeDeSession.get(e.sessionId)) || entrer(courante?.phase ?? "?", e.at);
        et.finsAnormales.push({ fin: e.fin, ...(e.raison ? { raison: e.raison } : {}) });
      }
    } else if (e.kind === "usage") {
      const et = (e.sessionId && etapeDeSession.get(e.sessionId)) || entrer(courante?.phase ?? "?", e.at);
      et.appels++;
      et.entrée += e.entrée ?? 0;
      et.sortie += e.sortie ?? 0;
      et.nanoAiu += e.nanoAiu ?? 0;
      et.coûtUsd += e.coûtUsd ?? 0;
      if (e.modèle && !et.modèles.includes(e.modèle)) et.modèles.push(e.modèle);
    }
  }

  etapes.forEach((et, i) => {
    const fin = etapes[i + 1]?.début ?? dernier;
    et.fin = fin;
    et.duréeMs = Math.max(0, Date.parse(fin) - Date.parse(et.début));
    et.codeMs = Math.max(0, et.effetsMs - et.agentsMs);
  });

  const parPhase: ResumeEtape[] = [];
  for (const et of etapes) {
    const p = parPhase.find((x) => x.phase === et.phase);
    if (!p) {
      parPhase.push({ ...et, rejets: [...et.rejets], finsAnormales: [...et.finsAnormales], modèles: [...et.modèles] });
      continue;
    }
    p.duréeMs += et.duréeMs;
    p.fin = et.fin;
    p.tours += et.tours;
    p.essaisMax = Math.max(p.essaisMax, et.essaisMax);
    p.rejets.push(...et.rejets);
    p.finsAnormales.push(...et.finsAnormales);
    p.appels += et.appels;
    p.entrée += et.entrée;
    p.sortie += et.sortie;
    p.nanoAiu += et.nanoAiu;
    p.coûtUsd += et.coûtUsd;
    p.agentsMs += et.agentsMs;
    p.effetsMs += et.effetsMs;
    p.codeMs += et.codeMs;
    p.moteurMs += et.moteurMs;
    for (const m of et.modèles) if (!p.modèles.includes(m)) p.modèles.push(m);
  }

  const somme = (k: "duréeMs" | "tours" | "appels" | "entrée" | "sortie" | "nanoAiu" | "coûtUsd" | "agentsMs" | "effetsMs" | "codeMs" | "moteurMs") => etapes.reduce((n, et) => n + et[k], 0);
  return {
    etapes,
    parPhase,
    total: {
      duréeMs: somme("duréeMs"),
      tours: somme("tours"),
      appels: somme("appels"),
      entrée: somme("entrée"),
      sortie: somme("sortie"),
      nanoAiu: somme("nanoAiu"),
      coûtUsd: somme("coûtUsd"),
      agentsMs: somme("agentsMs"),
      effetsMs: somme("effetsMs"),
      codeMs: somme("codeMs"),
      moteurMs: somme("moteurMs"),
      rejets: etapes.reduce((n, et) => n + et.rejets.length, 0),
    },
  };
}
