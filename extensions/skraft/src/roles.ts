/**
 * Consignes d'orchestration des rôles, propres à agent-studio (ADR 0024). Le **contenu** des rôles
 * est dans `agents/*.agent.md` et la méthode dans `skills/` : ces fichiers se partagent avec d'autres
 * harnais (Copilot CLI, Claude Code). Ici ne figure que ce qui n'a de sens que sous l'orchestrateur ;
 * le contrat général (outil de fin, `run_tests`, pas de Git, `report_blocker`, `load_skill`) est
 * ajouté par le cœur. Stables d'un appel à l'autre ; le contexte variable passe par le dossier de
 * passation construit par le code.
 *
 * PROVENANCE — la substance des lentilles (`agents/skraft-lens-*.agent.md`) est reprise de
 * **skraft-plugin** (GPL-3.0-or-later), fichiers
 * `com.anthropic.claude-code/agents/{cold-reader,test-integrity,architecture-boundaries,quality-gates}-lens.md` ;
 * les skills de `skills/` sont reprises du tag `v1.6.1`, sauf `architecture-patterns`,
 * `clean-architecture-testing` et les `clean-architecture-<langage>`, du tag `v1.15.1`. Voir
 * `docs/licences/autorisation-skraft.md`.
 *
 * ADAPTATION — les portes et seuils de l'original sont nommés là-bas dans le prompt (G4, G7, G11…) ;
 * ici ce sont **le code qui les exécute** et `ctx.stack` qui les mesure, de sorte qu'une lentille
 * ne puisse pas attester ce qu'elle n'a pas vu. Les lentilles propres à .NET du dépôt d'origine
 * (`contract-fidelity`, `mock-fidelity`) ne sont pas reprises : elles sont conditionnelles et liées
 * à une pile précise, ce que l'extension ne doit pas être.
 */
import { SKILLS_D_ARCHITECTURE } from "./architecture.js";

// Écarts au plan de test (ADR 0067) : le contenu partagé dit la règle, la consigne dit l'outil.
const ECARTS_AU_PLAN = "Le plan de test est `.skraft/<slug>/distill/test-plan.md`. Un écart à sa matrice se déclare dans le champ planDeviations de report_phase (ADR 0067) : le code le vérifie contre la matrice et refuse le pas s'il ne reprend pas la ligne du critère.";
const PASSATION = "Le dossier de passation, construit par l'orchestrateur, donne la story, le dossier de travail (`.skraft/<slug>/`) et le résultat des phases précédentes.";

/**
 * Les skills sont reprises telles quelles ; là où elles contredisent une décision du projet, la
 * consigne d'orchestration tranche. Forme du code : le linter du projet fait foi (ADR 0022), pas les
 * seuils d'Object Calisthenics de `craft-discipline`. Commits, portes et mutation : le code (contrat du cœur).
 */
const SKILLS_ARBITRATION = `Les skills décrivent aussi des étapes que l'orchestrateur exécute lui-même (commits, portes, mutation) : ne les fais pas.
Pour la forme du code, le linter du projet fait foi : en cas d'écart avec les seuils d'une skill (Object Calisthenics), suis le linter.`;

export const ROLES = {
  classifier: `${PASSATION}
Rends le niveau et sa justification avec l'outil submit_difficulty.`,

  researcher: PASSATION,

  architectModel: PASSATION,

  architectDecide: `${PASSATION}
Rédige chaque ADR uniquement avec l'outil render_adr, qui applique le gabarit du projet et refuse un champ manquant ;
pour amender un ADR encore proposé, rappelle render_adr avec son numéro. Tu n'as aucun accès direct en écriture à docs/adr.`,

  acceptance: `${PASSATION}
${SKILLS_ARBITRATION}
L'emplacement des tests d'acceptance du projet est indiqué dans le dossier de passation. Le code vérifie ensuite chaque valeur
recopiée et la raison de chaque rouge : un écart est rejeté avec son motif.`,

  test: `${PASSATION}
${SKILLS_ARBITRATION}
Le scénario en cours, son test d'acceptance et les tests déjà écrits sont dans le dossier de passation. Les tests d'acceptance
sont gelés : toute écriture y est refusée.
${ECARTS_AU_PLAN}`,

  dev: `${PASSATION}
${SKILLS_ARBITRATION}
Le test à faire passer est indiqué dans le dossier de passation. Tous les tests sont gelés pendant ton tour : une modification,
même hors des outils d'écriture, est détectée par empreinte et annule le tour.
${ECARTS_AU_PLAN}`,

  lens: `Tu fais partie d'une revue à plusieurs lentilles ; chacune travaille isolée et la synthèse est calculée par le code.
Rends ton verdict avec l'outil submit_lens_verdict.
Un comportement vérifié par un test d'acceptance n'appelle pas de test unitaire qui le duplique : avant de signaler un test
manquant, cherche-le dans les tests d'acceptance du projet. S'il y est, ce n'est pas un défaut (choix du projet, ADR 0045).
Donne à chaque défaut sa cible (target) : test, code ou deliverable. Un défaut, un seul sujet : scinde celui qui touche à la fois
un test et le code. Si le dossier liste tes défauts précédents contestés par l'agent, rends pour chacun un arbitrage (rulings) :
accepted si sa raison te convainc, maintained sinon, avec ta raison ; ne les relance pas dans tes défauts.
Si juger demande une décision métier que ni la story ni les réponses de l'utilisateur ne tranchent, pose la question avec
report_blocker au lieu de deviner. Une question déjà tranchée te sera renvoyée avec sa réponse.`,

  mutationArbiter: `Rends ta décision avec l'outil submit_lens_verdict : lens « mutation-arbiter », verdict APPROVED, aucun défaut, et pour
chaque défaut de mutation listé un arbitrage (rulings) : accepted si le mutant est équivalent, maintained sinon, avec ta raison.`,

  findingRefuter: `Rends ta décision avec l'outil submit_lens_verdict : lens « finding-refuter », verdict APPROVED, aucun défaut, et pour
chaque défaut listé un arbitrage (rulings) : accepted s'il est réfuté, avec le passage \`chemin:ligne\` qui le montre dans ta raison ;
maintained sinon, avec ta raison.`,
};

/**
 * Les quatre lentilles de la revue de livraison. Chacune travaille **isolée** : elle ne voit ni
 * les constats des autres, ni le journal du producteur. Leur répartition sur les quatre questions
 * de `review.ts` vient de skraft-plugin (voir la provenance en tête de ce fichier) ; retirer une
 * lentille laisse une question sans réponse, et la synthèse refuse alors d'approuver.
 * La consigne de chaque lentille est dans `agents/skraft-lens-<nom>.agent.md`.
 */
export const LENS_FOCUS = {
  "cold-reader": "Vocabulaire métier, clarté des noms et visibilité de l'intention, sans contexte du producteur.",
  "test-integrity": "Théâtre de test : tests tautologiques, assertions qui ne peuvent pas échouer, tests modifiés pour passer.",
  architecture: "Sens des dépendances entre couches, domaine sans doublure, fidélité aux ADR ratifiés et au modèle.",
  "quality-gates": "Cohérence des livrables avec les faits mesurés par le code, sans rien exécuter ni rejuger.",
} as const;

/**
 * Classe de modèle par rôle (ADR 0048). Le projet associe chaque classe à un modèle réel ; skraft ne
 * nomme jamais un modèle. Concevoir demande le plus de jugement ; produire, un bon modèle courant ;
 * classer une story ou confronter des livrables à des faits déjà mesurés, un modèle léger.
 */
export const ROLE_MODEL_CLASS = {
  classifier: "light",
  researcher: "standard",
  architectModel: "strong",
  architectDecide: "strong",
  acceptance: "standard",
  test: "standard",
  dev: "standard",
  mutationArbiter: "standard",
  // Juger un défaut demande au moins la capacité de la lentille qui l'a trouvé (ADR 0069).
  findingRefuter: "strong",
} as const;

/** `quality-gates` ne rejuge rien : elle confronte les livrables aux faits établis par le code (ADR 0028). */
export const LENS_MODEL_CLASS = {
  "cold-reader": "standard",
  "test-integrity": "standard",
  architecture: "standard",
  "quality-gates": "light",
} as const satisfies Record<keyof typeof LENS_FOCUS, "strong" | "standard" | "light">;

/**
 * Skills par rôle (SPEC-skraft §6.4) : injectées dans la session, ou chargées à la demande par
 * `load_skill`. `nom#Titre` injecte une seule section (économie de tokens).
 */
export const ROLE_SKILLS = {
  researcher: {},
  architectModel: { mandatory: ["architecture-patterns"], onDemand: ["architecture-decisions", ...SKILLS_D_ARCHITECTURE] },
  architectDecide: { mandatory: ["architecture-decisions", "adr-eligibility-gate"], onDemand: ["architecture-patterns", ...SKILLS_D_ARCHITECTURE] },
  acceptance: { mandatory: ["bdd-methodology", "test-design-mandates"], onDemand: ["outside-in-tdd", "craft-discipline", "clean-architecture-testing"] },
  test: { mandatory: ["test-design-mandates", "outside-in-tdd#RED"], onDemand: ["test-refactoring-catalog", "clean-architecture-testing", ...SKILLS_D_ARCHITECTURE] },
  dev: { mandatory: ["craft-discipline", "outside-in-tdd#SYNTHESIZE-GREEN"], onDemand: ["clean-architecture-testing", "test-refactoring-catalog", ...SKILLS_D_ARCHITECTURE] },
  lens: { onDemand: ["adversarial-review-lenses", "acceptance-review-criteria", "architecture-review-criteria"] },
} as const;

/**
 * Skills reprises de skraft-plugin (catégories « méthode » et « critères de revue », SPEC-skraft §4.2) :
 * v1.6.1, sauf `architecture-patterns`, `clean-architecture-testing` et les `clean-architecture-<langage>`,
 * de v1.15.1 (docs/licences/autorisation-skraft.md).
 */
export const SKILLS = [
  "architecture-patterns",
  "architecture-decisions",
  "adr-eligibility-gate",
  "bdd-methodology",
  "test-design-mandates",
  "outside-in-tdd",
  "craft-discipline",
  "test-refactoring-catalog",
  "clean-architecture-testing",
  // Reprises de v1.15.1 : l'appel de skraft désigne laquelle charger (`--archi`, `architecture.ts`).
  ...SKILLS_D_ARCHITECTURE,
  "adversarial-review-lenses",
  "acceptance-review-criteria",
  "architecture-review-criteria",
] as const;
