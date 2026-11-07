/**
 * Coût des revues et des corrections, mesuré sur la trace d'un run et ses preuves (docs/15 §5).
 * Pur : aucune I/O. Trois mesures, une par évolution de skraft-plugin v1.15.1 à décider :
 * - **patch partagé** : lectures de fichiers par les lentilles, et part de leurs tokens d'entrée ;
 * - **re-revue sélective** : coût des lentilles relancées alors qu'elles avaient approuvé sans
 *   défaut au tour précédent (borne haute : on ne sait pas si leurs fichiers avaient changé) ;
 * - **mode rework** : après la première revue de DELIVER, ce que les corrections font relancer
 *   (exécutions de tests par le code, revues complètes).
 * Le verdict d'une lentille vient de sa sortie, dans l'événement `tour-fin` de la trace.
 */

/** Ce que le module lit d'une entrée de trace : la forme de `TraceEntry`, sans en dépendre. */
export interface Entree {
  at: string;
  kind: string;
  sessionId?: string;
  role?: string;
  prompt?: string;
  sortie?: unknown;
  nom?: string;
  entrée?: number;
  nanoAiu?: number;
}

/** Ce que le module lit d'une preuve d'exécution des tests. */
export interface Preuve {
  phase?: string;
  source?: string;
  at: string;
  durationMs?: number;
}

export type Gravites = { blocker: number; major: number; minor: number };

export interface LigneLentille {
  phase: string;
  tour: number;
  lentille: string;
  appels: number;
  nanoAiu: number;
  entrée: number;
  lectures: number;
  verdict: string;
  défauts: Gravites;
}

export interface MesuresRevues {
  lentilles: LigneLentille[];
  reRevue: { relances: { phase: string; tour: number; lentille: string; nanoAiu: number }[]; nanoAiu: number; revuesNanoAiu: number };
  lectures: { lectures: number; lentillesEntrée: number; totalEntrée: number };
  corrections: { executions: number; duréeMs: number; étiquettes: string[]; revuesRelancées: number; revuesNanoAiu: number };
}

const LENTILLE = /skraft-lens-([\w-]+)$/;
/** Outils qui ne lisent pas le dépôt : la sortie de la lentille, sa question, le chargement d'une skill. */
const PAS_UNE_LECTURE = new Set(["submit_lens_verdict", "report_blocker", "load_skill"]);

export function mesurerRevues(trace: readonly Entree[], preuves: readonly Preuve[]): MesuresRevues {
  const entrees = [...trace].sort((a, b) => a.at.localeCompare(b.at));
  // Sessions de lentille, rattachées à leur phase (le dossier le dit) et à leur tour de revue : un
  // nouveau tour commence quand un autre agent a travaillé depuis le début du tour courant.
  // Une lentille garde sa session d'une revue à l'autre : chaque `tour-début` ouvre une nouvelle
  // mesure, et les entrées suivantes de la session s'y rattachent jusqu'au prochain.
  const tours: (LigneLentille & { fin: string })[] = [];
  const enCours = new Map<string, LigneLentille & { fin: string }>();
  const tourDe = new Map<string, number>();
  let autreAgentDepuis = true;
  const totalEntrée = entrees.filter((e) => e.kind === "usage").reduce((n, e) => n + (e.entrée ?? 0), 0);
  for (const e of entrees) {
    if (e.kind === "tour-début" && e.sessionId) {
      const lentille = LENTILLE.exec(e.role ?? "")?.[1];
      if (!lentille) {
        autreAgentDepuis = true;
        enCours.delete(e.sessionId);
        continue;
      }
      const phase = /Revue de la phase (\w+)/.exec(e.prompt ?? "")?.[1] ?? "?";
      if (autreAgentDepuis || !tourDe.has(phase)) tourDe.set(phase, (tourDe.get(phase) ?? 0) + 1);
      autreAgentDepuis = false;
      const l = { phase, tour: tourDe.get(phase)!, lentille, appels: 0, nanoAiu: 0, entrée: 0, lectures: 0, verdict: "?", défauts: { blocker: 0, major: 0, minor: 0 }, fin: e.at };
      tours.push(l);
      enCours.set(e.sessionId, l);
      continue;
    }
    const l = e.sessionId ? enCours.get(e.sessionId) : undefined;
    if (!l) continue;
    if (e.kind === "usage") {
      l.appels++;
      l.nanoAiu += e.nanoAiu ?? 0;
      l.entrée += e.entrée ?? 0;
    } else if (e.kind === "outil" && e.nom && !PAS_UNE_LECTURE.has(e.nom)) l.lectures++;
    else if (e.kind === "tour-fin") {
      l.fin = e.at;
      const s = e.sortie as { verdict?: string; defects?: { severity?: string }[] } | undefined;
      if (s?.verdict) l.verdict = s.verdict;
      for (const d of s?.defects ?? []) if (d.severity === "blocker" || d.severity === "major" || d.severity === "minor") l.défauts[d.severity]++;
    }
  }
  // Une lentille relancée dans le même tour (silence, délai) : une seule ligne, coûts cumulés.
  const lignes: (LigneLentille & { fin: string })[] = [];
  for (const l of tours) {
    const meme = lignes.find((x) => x.phase === l.phase && x.tour === l.tour && x.lentille === l.lentille);
    if (!meme) lignes.push({ ...l, défauts: { ...l.défauts } });
    else Object.assign(meme, { appels: meme.appels + l.appels, nanoAiu: meme.nanoAiu + l.nanoAiu, entrée: meme.entrée + l.entrée, lectures: meme.lectures + l.lectures, verdict: l.verdict, défauts: l.défauts, fin: l.fin });
  }
  const propre = (l: LigneLentille) => l.verdict === "APPROVED" && l.défauts.blocker + l.défauts.major + l.défauts.minor === 0;
  const relances = lignes
    .filter((l) => l.tour > 1 && lignes.some((p) => p.phase === l.phase && p.tour === l.tour - 1 && p.lentille === l.lentille && propre(p)))
    .map((l) => ({ phase: l.phase, tour: l.tour, lentille: l.lentille, nanoAiu: l.nanoAiu }));
  const livraison = lignes.filter((l) => l.phase === "DELIVER");
  const finPremiere = livraison.filter((l) => l.tour === 1).map((l) => l.fin).sort().at(-1);
  const apres = finPremiere ? preuves.filter((p) => p.source === "gate" && p.at > finPremiere) : [];
  const relancees = livraison.filter((l) => l.tour > 1);
  return {
    lentilles: lignes.map(({ fin: _fin, ...l }) => l),
    reRevue: { relances, nanoAiu: relances.reduce((n, r) => n + r.nanoAiu, 0), revuesNanoAiu: lignes.reduce((n, l) => n + l.nanoAiu, 0) },
    lectures: { lectures: lignes.reduce((n, l) => n + l.lectures, 0), lentillesEntrée: lignes.reduce((n, l) => n + l.entrée, 0), totalEntrée },
    corrections: {
      executions: apres.length,
      duréeMs: apres.reduce((n, p) => n + (p.durationMs ?? 0), 0),
      étiquettes: [...new Set(apres.map((p) => p.phase ?? "?"))],
      revuesRelancées: new Set(relancees.map((l) => l.tour)).size,
      revuesNanoAiu: relancees.reduce((n, l) => n + l.nanoAiu, 0),
    },
  };
}

/** La section du rapport de run ; `requetes` convertit les nanoAiu en requêtes premium, comme le reste du rapport. */
export function sectionRevues(m: MesuresRevues, requetes: (nanoAiu: number) => number): string[] {
  const sec = Math.round(m.corrections.duréeMs / 1000);
  const duree = `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, "0")}`;
  return [
    "## Coût des revues et des corrections",
    "",
    "Mesures pour décider des évolutions de skraft-plugin v1.15.1 (docs/15 §5) : patch partagé, re-revue sélective, mode rework.",
    "",
    "| Phase | Tour | Lentille | Appels | Requêtes premium | Tokens entrée | Lectures | Verdict | Défauts (bloquants/majeurs/mineurs) |",
    "|---|---|---|---|---|---|---|---|---|",
    ...m.lentilles.map((l) => `| ${l.phase} | ${l.tour} | ${l.lentille} | ${l.appels} | ${requetes(l.nanoAiu)} | ${l.entrée} | ${l.lectures} | ${l.verdict} | ${l.défauts.blocker}/${l.défauts.major}/${l.défauts.minor} |`),
    "",
    `- Re-revue sélective : au plus ${requetes(m.reRevue.nanoAiu)} requêtes premium sur ${requetes(m.reRevue.revuesNanoAiu)} consacrées aux revues, pour ${m.reRevue.relances.length} lentille(s) relancée(s) après avoir approuvé sans défaut (borne haute : leurs fichiers ont pu changer).`,
    `- Patch partagé : ${m.lectures.lectures} lectures de fichiers par les lentilles ; leurs tokens d'entrée : ${m.lectures.lentillesEntrée} sur ${m.lectures.totalEntrée} pour tout le run.`,
    `- Mode rework : après la première revue de DELIVER, ${m.corrections.executions} exécutions de tests par le code (${duree}${m.corrections.étiquettes.length ? ` : ${m.corrections.étiquettes.join(", ")}` : ""}), ${m.corrections.revuesRelancées} revue relancée (${requetes(m.corrections.revuesNanoAiu)} requêtes premium).`,
    "",
  ];
}
