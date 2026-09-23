import type { TddState } from "./model.js";

const PHASE_TEXT = {
  RED: "phase rouge : écrire le test",
  GREEN: "phase verte : faire passer le test",
  REFACTOR: "phase de nettoyage : améliorer sans changer le comportement",
} as const;

const STATUS_TEXT = { done: "fait", skipped: "sauté", pending: "à faire" } as const;
const REPORT_PHASE = { RED: "rouge", GREEN: "vert", REFACTOR: "nettoyage" } as const;

/**
 * Dossier de passation construit par le code pour chaque session neuve (§6.6, D17).
 * Seuls des résumés structurés y figurent : jamais de transcription.
 */
export function buildBrief(
  s: TddState,
  opts: { phase: keyof typeof PHASE_TEXT; feedback?: string; testIds?: string[] },
): string {
  const step = s.steps[s.current];
  const lines = [`Tâche : TDD — ${s.feature}`, "Plan :"];
  s.steps.forEach((st, i) => lines.push(`  [${i === s.current ? "en cours" : STATUS_TEXT[st.status]}] ${st.id} — ${st.behavior}`));
  if (step) lines.push(`Étape en cours : ${step.id} — ${step.behavior} (${PHASE_TEXT[opts.phase]})`);
  if (opts.testIds?.length) lines.push(`Tests à faire passer : ${opts.testIds.join(", ")}`);
  if (s.reports.length) {
    lines.push("Déjà fait :");
    for (const r of s.reports.slice(-8)) lines.push(`- ${r.stepId}, ${REPORT_PHASE[r.phase]} : ${r.summary}${r.files.length ? ` (${r.files.join(", ")})` : ""}`);
  }
  if (opts.feedback) lines.push(`Rejet précédent : ${opts.feedback}`);
  return lines.join("\n");
}
