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
const LONGUEUR_REJET = 160;

function duree(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

// Sous le centime, « 0,00 $ » laisserait croire que rien n'a été dépensé (run du 09/11).
const cout = (usd: number) => (usd < 0.005 ? "< 0,01 $" : `${usd.toFixed(2).replace(".", ",")} $`);

/** Première ligne d'un motif, coupée : la ligne de progression doit se lire d'un coup d'œil. */
function court(texte: string): string {
  const l = texte.split("\n")[0]!.trim();
  return l.length > LONGUEUR_REJET ? `${l.slice(0, LONGUEUR_REJET)}…` : l;
}

const questions = (n: number) => (n === 0 ? "aucune question en attente" : `${n} question${n > 1 ? "s" : ""} en attente`);

/** La ligne à montrer : « US-2 · Conception, étape 2/5 · en cours · 6 min 34 s · 2,94 $ · … ». */
export function ligneDeProgression(t: VueTache, o: { questions: number; dureeMs?: number; coutUsd?: number }): string {
  return [
    t.titre,
    `${t.phaseLabel}${t.etape ? `, étape ${t.etape.index}/${t.etape.total}` : ""}`,
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
    if (t.dernierRejet && t.dernierRejet !== a.dernierRejet) out.push(`Rejet, la phase recommence : ${court(t.dernierRejet)}.`);
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
