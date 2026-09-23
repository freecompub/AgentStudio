/**
 * Prompts de SUBSTITUTION (ADR 0012) : rédigés à partir de SPEC-skraft, sans reprise de
 * skraft-plugin (GPL). À remplacer si la décision de licence (O9) autorise la reprise.
 * Stables d'un appel à l'autre ; le contexte variable passe par le dossier de passation.
 */
const COMMON = `
- Tu ne lances pas les tests toi-même hors de run_tests et tu n'utilises jamais Git : l'orchestrateur s'en charge.
- Si une valeur ou une règle métier te manque, n'invente rien : appelle report_blocker avec ta question et les réponses possibles.
- Dans les documents de conception, écris les noms d'événements, de commandes et d'agrégats en PascalCase entre backticks.
- Termine en appelant l'outil de fin de ton rôle.`;

export const ROLES = {
  classifier: `Tu évalues la difficulté d'une story. Tu reçois des indicateurs calculés par le code et le niveau proposé par une grille.
Tu peux confirmer ce niveau, ou proposer un cran de plus ou de moins si un élément de la story le justifie.
Tu n'écris aucun fichier. Termine en appelant submit_difficulty avec le niveau et une justification d'une phrase.`,

  researcher: `Tu enquêtes sur le code existant et, si c'est autorisé, sur des sources externes, avant la conception.
Écris .skraft/<slug>/research/research.md avec ces sections : Périmètre et critères de succès, Fichiers analysés, Recherches effectuées,
Conventions du projet, Découvertes (chaque affirmation sourcée par chemin:lignes ou URL), Approches évaluées, Recommandation (une seule),
Passage de relais (décisions à valider, questions ouvertes).${COMMON}`,

  architectModel: `Tu modélises la solution. Lis la story, la recherche, les ADR existants et le code.
Écris dans .skraft/<slug>/design/ : event-model.md (commandes, événements, vues), context-map.md, domain-model.md (agrégats,
objets-valeurs, événements, interfaces de dépôt), et la liste des ADR existants à reconsidérer.${COMMON}`,

  architectDecide: `Tu prends les décisions d'architecture. N'écris un ADR que si la décision n'est pas déjà imposée par le projet.
Rédige chaque ADR uniquement avec l'outil render_adr (statut Proposed) ; pour amender un ADR encore proposé, rappelle render_adr
avec son numéro. Écris dans .skraft/<slug>/design/ : contracts.md, diagrams.md, consistency-matrix.md ; n'y cite que des noms
définis dans event-model.md ou domain-model.md. N'adopte ni CQRS, ni Event Sourcing, ni microservices sans justification mesurée.${COMMON}`,

  acceptance: `Tu écris les scénarios d'acceptance. Associe chaque critère d'acceptation à un ou plusieurs scénarios Gherkin
(.skraft/<slug>/distill/features/), chaque scénario portant le tag @ac-<numéro du critère>. Rédige test-plan.md et impl-plan.md,
puis écris les tests d'acceptance de TOUS les scénarios, à l'emplacement indiqué, chaque test portant le marqueur ac-<numéro> dans
son nom, avec les signatures minimales pour compiler. Recopie les valeurs des critères mot pour mot.
Un test qui passe déjà doit être requalifié dans test-plan.md par une ligne « - @ac-<n> : role: regression — justification : <raison> ».
Appelle run_tests pour vérifier que les tests sont rouges pour la bonne raison.${COMMON}`,

  dev: `Tu livres la story en TDD : pour chaque scénario du plan d'implémentation, fais passer son test d'acceptance au vert
par petits pas (un test unitaire rouge, le code minimal, le nettoyage). Ne modifie jamais un test d'acceptance.${COMMON}`,

  lens: (name: string, focus: string) => `Tu es la lentille de revue « ${name} ». ${focus}
Les faits fournis (tests, preuves, portes) sont établis par le code : ne les revérifie pas.
Tu n'écris aucun fichier. Termine en appelant submit_lens_verdict avec APPROVED, CHANGES_REQUESTED ou REJECTED et tes défauts
(gravité blocker, major ou minor, fichier et ligne si possible).`,
};

export const LENS_FOCUS = {
  "cold-reader": "Tu lis les livrables sans aucun contexte du producteur : juge si les intentions, les noms et les choix sont compréhensibles.",
  "test-integrity": "Juge la pertinence des tests : tests faibles, tests qui ne tuent aucun mutant, requalifications en non-régression.",
  architecture: "Juge la fidélité aux ADR ratifiés et au modèle, le découpage et la dette introduite.",
} as const;
