import type { Phase, SkraftState } from "./model.js";
import { artifactsDuRun } from "./review-brief.js";

/**
 * Dossier de passation (SPEC.md §6.6, SPEC-skraft E4) : construit par le code à partir des phases
 * réellement exécutées ; jamais de transcription. Pur.
 */
export function buildBrief(s: SkraftState, phase: Phase, feedback: string[]): string {
  const story = s.story;
  const lines: string[] = [];
  if (story) {
    lines.push(`Story : ${story.id} — ${story.title}`, story.statement, "Critères d'acceptation :");
    for (const c of story.criteria) lines.push(`  ${c.n}. ${c.text}`);
  }
  lines.push(`Difficulté : ${s.difficulty?.level ?? "non évaluée"}`);
  lines.push(`Dossier de travail : .skraft/${s.slug}/`);
  lines.push(`Phase en cours : ${phase}`);
  const done = s.phasesCompleted.map((p) => {
    const files = artifactsDuRun(s, p).map((a) => a.path);
    return `  - ${p}${files.length ? ` : ${files.join(", ")}` : ""}`;
  });
  if (done.length) lines.push("Phases terminées :", ...done);
  if (s.skipPhases.length) lines.push(`Phases sautées : ${s.skipPhases.join(", ")}`);
  const decided = s.adrs.filter((a) => a.status !== "Proposed");
  if (decided.length) lines.push("ADR décidés :", ...decided.map((a) => `  - ${a.id} (${a.status}) : ${a.path}`));
  const answered = [...s.openQuestions.filter((q) => q.answer).map((q) => ({ question: q.text, answer: q.answer! })), ...s.answers];
  if (answered.length) lines.push("Réponses de l'utilisateur :", ...answered.map((a) => `  - ${a.question} → ${a.answer}`));
  if (s.regressions.length) lines.push("Tests d'acceptance requalifiés en non-régression :", ...s.regressions.map((r) => `  - ${r}`));
  if (s.acceptanceHash) lines.push("Les tests d'acceptance sont gelés : ne les modifie jamais.");
  if (s.deliver) {
    const done = s.deliver.scenarios.filter((x) => x.status === "done").map((x) => `${x.id}${x.role === "regression" ? " (non-régression)" : ""}`);
    if (done.length) lines.push(`Scénarios livrés : ${done.join(", ")}`);
    if (s.deliver.notes.length) lines.push("Constats de DELIVER :", ...s.deliver.notes.map((n) => `  - ${n}`));
  }
  if (feedback.length) lines.push("Rejet précédent :", ...feedback.map((f) => `  - ${f}`));
  return lines.join("\n");
}
