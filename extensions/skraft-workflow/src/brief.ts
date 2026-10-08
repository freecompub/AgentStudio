// Repris de extensions/skraft/src/brief.ts (2026-10-08), réduit à ce que les phases déjà écrites
// en workflow produisent. Même texte, ligne pour ligne, pour les champs présents.
import type { Difficulty } from "./difficulty.js";
import type { Story } from "./story.js";
import type { Phase } from "./support.js";

/** Ce que le script sait de la story à un instant donné ; tout se recalcule au rejeu. */
export interface Dossier {
  story: Story;
  slug: string;
  niveau: Difficulty;
  phasesFaites: { phase: Phase; fichiers: string[] }[];
  phasesSautees: Phase[];
  questions: { id: string; text: string; answer?: string }[];
  reponses: { question: string; answer: string }[];
  /** ADR de la story, avec leur statut. */
  adrs: { id: string; path: string; status: "Proposed" | "Accepted" | "Rejected" }[];
  /** Tests d'acceptance requalifiés en non-régression à la sortie de DISTILL. */
  regressions: string[];
  /** Empreinte des tests d'acceptance gelés à la sortie de DISTILL. */
  acceptanceHash: string | null;
  /** Dernière exécution des tests par le code, pour les faits de revue. */
  derniereExecution?: string;
}

/**
 * Dossier de passation (SPEC.md §6.6) : construit par le code à partir des phases réellement
 * exécutées ; jamais de transcription. Pur.
 */
export function buildBrief(d: Dossier, phase: Phase, rejet: readonly string[]): string {
  const lines: string[] = [`Story : ${d.story.id} — ${d.story.title}`, d.story.statement, "Critères d'acceptation :"];
  for (const c of d.story.criteria) lines.push(`  ${c.n}. ${c.text}`);
  lines.push(`Difficulté : ${d.niveau}`);
  lines.push(`Dossier de travail : .skraft/${d.slug}/`);
  lines.push(`Phase en cours : ${phase}`);
  if (d.phasesFaites.length) lines.push("Phases terminées :", ...d.phasesFaites.map((p) => `  - ${p.phase}${p.fichiers.length ? ` : ${p.fichiers.join(", ")}` : ""}`));
  if (d.phasesSautees.length) lines.push(`Phases sautées : ${d.phasesSautees.join(", ")}`);
  const decides = d.adrs.filter((a) => a.status !== "Proposed");
  if (decides.length) lines.push("ADR décidés :", ...decides.map((a) => `  - ${a.id} (${a.status}) : ${a.path}`));
  const repondues = [...d.questions.filter((q) => q.answer).map((q) => ({ question: q.text, answer: q.answer! })), ...d.reponses];
  if (repondues.length) lines.push("Réponses de l'utilisateur :", ...repondues.map((a) => `  - ${a.question} → ${a.answer}`));
  if (d.regressions.length) lines.push("Tests d'acceptance requalifiés en non-régression :", ...d.regressions.map((r) => `  - ${r}`));
  if (d.acceptanceHash) lines.push("Les tests d'acceptance sont gelés : ne les modifie jamais.");
  if (rejet.length) lines.push("Rejet précédent :", ...rejet.map((f) => `  - ${f}`));
  return lines.join("\n");
}
