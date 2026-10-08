/**
 * Consignes d'orchestration des rôles, propres à agent-studio (ADR 0024). Reprises de
 * `extensions/skraft/src/roles.ts` (2026-10-08) pour les rôles que le workflow emploie déjà. Le
 * contenu des rôles est dans `agents/*.agent.md`, copié de skraft.
 */
const PASSATION = "Le dossier de passation, construit par l'orchestrateur, donne la story, le dossier de travail (`.skraft/<slug>/`) et le résultat des phases précédentes.";

export const ROLES = {
  classifier: `${PASSATION}
Rends le niveau et sa justification avec l'outil submit_difficulty.`,
  researcher: PASSATION,
} as const;
