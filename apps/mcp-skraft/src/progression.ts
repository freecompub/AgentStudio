/**
 * Progression d'un run pour l'utilisateur (09/11). Le serveur ne pousse rien : l'hôte interroge. Pour
 * qu'il n'ait rien à interpréter, le code écrit lui-même la ligne à montrer, et la liste de ce qui a
 * changé entre deux instantanés de l'état (`skraft_attendre`). Pur : mêmes entrées, même texte.
 */

export interface VueTache {
  id: string;
  titre: string;
  status: "running" | "waiting" | "finished";
  /** Identifiant de la phase (`DESIGN`) ; `phaseLabel`, son libellé pour l'utilisateur. */
  phase: string;
  phaseLabel: string;
  etape?: { index: number; total: number };
  dernierRejet?: string;
  /** Rejets du run, comptés dans la trace : un nouveau rejet se voit même si son texte se répète. */
  rejets?: number;
  /** Essai en cours de la phase (1, puis 2 au premier rejeu…), lu dans la trace. */
  essai?: number;
}

export interface VueQuestion {
  id: string;
  tache: string;
  title: string;
  detail?: string;
}

export interface Instantane {
  taches: VueTache[];
  questions: VueQuestion[];
  /** Messages du projet (bilans, avertissements), dans l'ordre. */
  messages: string[];
}

const STATUT: Record<VueTache["status"], string> = { running: "en cours", waiting: "attend une réponse", finished: "terminé" };
/** Un motif plus long est coupé au milieu : son début dit ce qui est jugé, sa fin la cause (run du 09/11). */
const DEBUT_REJET = 120;
const FIN_REJET = 100;

function duree(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

// Sous le centime, « 0,00 $ » laisserait croire que rien n'a été dépensé (run du 09/11).
const cout = (usd: number) => (usd < 0.005 ? "< 0,01 $" : `${usd.toFixed(2).replace(".", ",")} $`);

/** Première ligne d'un motif, coupée au milieu s'il est long : la ligne doit se lire d'un coup d'œil. */
function court(texte: string): string {
  const l = texte.split("\n")[0]!.trim();
  return l.length > DEBUT_REJET + FIN_REJET ? `${l.slice(0, DEBUT_REJET).trimEnd()} … ${l.slice(-FIN_REJET).trimStart()}` : l;
}

/** Une phrase finit par un seul point, même si le motif qu'elle cite en porte déjà un. */
const finDePhrase = (texte: string) => (/[.!?…]$/.test(texte) ? texte : `${texte}.`);

const questions = (n: number) => (n === 0 ? "aucune question en attente" : `${n} question${n > 1 ? "s" : ""} en attente`);

/** La ligne à montrer : « US-2 · Conception, étape 2/5 · en cours · 6 min 34 s · 2,94 $ · … ». */
export function ligneDeProgression(t: VueTache, o: { questions: number; dureeMs?: number; coutUsd?: number }): string {
  return [
    t.titre,
    `${t.phaseLabel}${t.etape ? `, étape ${t.etape.index}/${t.etape.total}` : ""}${t.essai && t.essai > 1 ? `, essai ${t.essai}` : ""}`,
    STATUT[t.status],
    ...(o.dureeMs !== undefined ? [duree(o.dureeMs)] : []),
    // Copilot ne donne pas de coût en dollars : rien plutôt qu'un zéro trompeur.
    ...(o.coutUsd ? [cout(o.coutUsd)] : []),
    ...(t.dernierRejet ? [`dernier rejet : ${court(t.dernierRejet)}`] : []),
    questions(o.questions),
  ].join(" · ");
}

/** Ce qui a changé, une phrase par changement, dans l'ordre où l'utilisateur doit l'apprendre. */
export function changements(avant: Instantane, apres: Instantane, tache?: string): string[] {
  const out: string[] = [];
  const garde = (id: string) => tache === undefined || id === tache;
  for (const t of apres.taches.filter((x) => garde(x.id))) {
    const a = avant.taches.find((x) => x.id === t.id);
    if (!a) {
      out.push(`Run lancé : ${t.titre}.`);
      continue;
    }
    if (t.phase !== a.phase) out.push(`Phase : ${t.phaseLabel} (${t.phase}).`);
    if (t.etape && (t.etape.index !== a.etape?.index || t.etape.total !== a.etape?.total)) out.push(`Étape ${t.etape.index}/${t.etape.total}.`);
    // Compté dans la trace quand on l'a (workflow), sinon au changement de texte (carte d'une extension).
    const nouveauRejet = t.rejets !== undefined ? t.rejets > (a.rejets ?? 0) : t.dernierRejet !== undefined && t.dernierRejet !== a.dernierRejet;
    if (nouveauRejet && t.dernierRejet) out.push(finDePhrase(`Rejet, ${t.phaseLabel} recommence${t.essai ? ` (essai ${t.essai})` : ""} : ${court(t.dernierRejet)}`));
    if (t.status === "finished" && a.status !== "finished") out.push(`Run terminé : ${t.titre}.`);
  }
  const avantQ = avant.questions.filter((q) => garde(q.tache));
  const apresQ = apres.questions.filter((q) => garde(q.tache));
  for (const q of apresQ.filter((x) => !avantQ.some((y) => y.id === x.id)))
    out.push(`Question à poser à l'utilisateur : ${q.title}${q.detail ? ` — ${q.detail}` : ""}`);
  if (avantQ.some((x) => !apresQ.some((y) => y.id === x.id))) out.push("Réponse reçue : le run reprend.");
  for (const m of apres.messages.filter((x) => !avant.messages.includes(x))) out.push(`Message : ${m}`);
  return out;
}

/** Ce que la carte d'une tâche porte (`TaskCardDto`), réduit à ce dont la progression a besoin. */
export interface CarteDeTache {
  id: string;
  title: string;
  status: VueTache["status"];
  phase: string;
  phaseLabel: string;
  step?: { index: number; total: number } | undefined;
  feedback?: string | undefined;
}

/** Une étape de la trace du run (`ResumeEtape`), réduite à ce dont la progression a besoin. */
export interface EtapeDeTrace {
  phase: string;
  essai: number;
  début: string;
  fin: string;
  rejets: { porte: string; motifs: string[] }[];
  coûtUsd: number;
}

/**
 * La vue d'une tâche : sa carte, complétée par la trace du run (09/11). Une tâche de workflow ne porte
 * dans sa carte ni son dernier rejet ni son essai ; la trace, si, comme pour `skraft_rapport`. La story
 * donnée au lancement remplace le nom du workflow comme titre.
 */
export function vueDeTache(carte: CarteDeTache, etapes: readonly EtapeDeTrace[], story: string | undefined, maintenant = Date.now()): { vue: VueTache; dureeMs?: number; coutUsd: number } {
  const rejets = etapes.flatMap((e) => e.rejets);
  const dernier = rejets.at(-1);
  const courante = etapes.at(-1);
  const vue: VueTache = {
    id: carte.id,
    titre: story ?? carte.title,
    status: carte.status,
    phase: carte.phase,
    phaseLabel: carte.phaseLabel,
    ...(carte.step ? { etape: { index: carte.step.index, total: carte.step.total } } : {}),
    ...(dernier ? { dernierRejet: `${dernier.porte} : ${dernier.motifs[0] ?? ""}` } : carte.feedback ? { dernierRejet: carte.feedback } : {}),
    ...(etapes.length ? { rejets: rejets.length } : {}),
    // Les revues de toutes les phases portent l'étiquette REVIEW : leur compteur n'est pas un essai de phase.
    ...(courante && courante.phase === carte.phase && carte.phase !== "REVIEW" ? { essai: courante.essai } : {}),
  };
  const debut = etapes.length ? Date.parse(etapes[0]!.début) : NaN;
  const fin = carte.status === "finished" && courante ? Date.parse(courante.fin) : maintenant;
  const dureeMs = Number.isNaN(debut) || Number.isNaN(fin) || fin < debut ? undefined : fin - debut;
  return { vue, ...(dureeMs !== undefined ? { dureeMs } : {}), coutUsd: etapes.reduce((n, e) => n + e.coûtUsd, 0) };
}
