import type { TraceEntry, TurnEnd } from "../protocols/trace.js";

/** Ce qu'une étape d'un run a coûté et rencontré. */
export interface ResumeEtape {
  phase: string;
  début: string;
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
  total: Omit<ResumeEtape, "phase" | "début" | "essaisMax" | "rejets" | "finsAnormales" | "modèles"> & { rejets: number };
}

const NORMALES: readonly TurnEnd[] = ["output", "blocker"];

const vide = (phase: string, début: string): ResumeEtape => ({
  phase,
  début,
  duréeMs: 0,
  tours: 0,
  essaisMax: 0,
  rejets: [],
  finsAnormales: [],
  appels: 0,
  entrée: 0,
  sortie: 0,
  nanoAiu: 0,
  modèles: [],
  agentsMs: 0,
  effetsMs: 0,
  codeMs: 0,
  moteurMs: 0,
});

/**
 * Résume une trace par étape (ADR 0032). PURE.
 *
 * Une étape commence quand la phase annoncée par une transition ou un début de tour change, et
 * dure jusqu'au début de la suivante. Un rejet ne porte pas de phase : il est compté dans l'étape
 * en cours, c'est-à-dire celle qu'on va rejouer. L'usage, lui, ne porte que sa session : il est
 * rattaché à l'étape où la session a commencé, même s'il arrive après un changement de phase.
 */
export function resumerTrace(entries: readonly TraceEntry[]): ResumeRun {
  const etapes: ResumeEtape[] = [];
  const etapeDeSession = new Map<string, ResumeEtape>();
  const debutDeSession = new Map<string, number>();
  let courante: ResumeEtape | undefined;
  let dernier = "";

  const entrer = (phase: string, at: string): ResumeEtape => {
    if (courante?.phase === phase) return courante;
    courante = vide(phase, at);
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
      entrer(courante?.phase ?? "?", e.at).rejets.push({ porte: e.porte, motifs: e.motifs });
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
      if (e.modèle && !et.modèles.includes(e.modèle)) et.modèles.push(e.modèle);
    }
  }

  etapes.forEach((et, i) => {
    const fin = etapes[i + 1]?.début ?? dernier;
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
    p.tours += et.tours;
    p.essaisMax = Math.max(p.essaisMax, et.essaisMax);
    p.rejets.push(...et.rejets);
    p.finsAnormales.push(...et.finsAnormales);
    p.appels += et.appels;
    p.entrée += et.entrée;
    p.sortie += et.sortie;
    p.nanoAiu += et.nanoAiu;
    p.agentsMs += et.agentsMs;
    p.effetsMs += et.effetsMs;
    p.codeMs += et.codeMs;
    p.moteurMs += et.moteurMs;
    for (const m of et.modèles) if (!p.modèles.includes(m)) p.modèles.push(m);
  }

  const somme = (k: "duréeMs" | "tours" | "appels" | "entrée" | "sortie" | "nanoAiu" | "agentsMs" | "effetsMs" | "codeMs" | "moteurMs") => etapes.reduce((n, et) => n + et[k], 0);
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
      agentsMs: somme("agentsMs"),
      effetsMs: somme("effetsMs"),
      codeMs: somme("codeMs"),
      moteurMs: somme("moteurMs"),
      rejets: etapes.reduce((n, et) => n + et.rejets.length, 0),
    },
  };
}
