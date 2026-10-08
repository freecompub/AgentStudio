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
  architectModel: PASSATION,
  architectDecide: `${PASSATION}
Rédige chaque ADR uniquement avec l'outil render_adr, qui applique le gabarit du projet et refuse un champ manquant ;
pour amender un ADR encore proposé, rappelle render_adr avec son numéro. Tu n'as aucun accès direct en écriture à docs/adr.`,
  lens: `Tu fais partie d'une revue à plusieurs lentilles ; chacune travaille isolée et la synthèse est calculée par le code.
Rends ton verdict avec l'outil submit_lens_verdict.
Un comportement vérifié par un test d'acceptance n'appelle pas de test unitaire qui le duplique : avant de signaler un test
manquant, cherche-le dans les tests d'acceptance du projet. S'il y est, ce n'est pas un défaut (choix du projet, ADR 0045).
Donne à chaque défaut sa cible (target) : test, code ou deliverable. Un défaut, un seul sujet : scinde celui qui touche à la fois
un test et le code. Si le dossier liste tes défauts précédents contestés par l'agent, rends pour chacun un arbitrage (rulings) :
accepted si sa raison te convainc, maintained sinon, avec ta raison ; ne les relance pas dans tes défauts.`,
} as const;

/**
 * Lentilles de la revue (provenance : skraft-plugin, voir `extensions/skraft/src/roles.ts`). La
 * consigne de chacune est dans `agents/skraft-lens-<nom>.agent.md`.
 */
export const LENSES = ["cold-reader", "test-integrity", "architecture", "quality-gates"] as const;
export const LENS_MODEL_CLASS = { "cold-reader": "standard", "test-integrity": "standard", architecture: "standard", "quality-gates": "light" } as const;

/** Skills par rôle : injectées dans la session, ou chargées à la demande par `load_skill`. */
export const ROLE_SKILLS = {
  architectModel: { mandatory: ["architecture-patterns"], onDemand: ["architecture-decisions"] },
  architectDecide: { mandatory: ["architecture-decisions", "adr-eligibility-gate"], onDemand: ["architecture-patterns"] },
  lens: { onDemand: ["adversarial-review-lenses", "acceptance-review-criteria", "architecture-review-criteria"] },
};

export const SKILLS = [
  "architecture-patterns",
  "architecture-decisions",
  "adr-eligibility-gate",
  "adversarial-review-lenses",
  "acceptance-review-criteria",
  "architecture-review-criteria",
] as const;
