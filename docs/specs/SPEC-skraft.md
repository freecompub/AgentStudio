# SPEC — Extension `skraft`

> Spécification de l'extension `skraft` pour l'application `agent-studio`.
> Elle complète `SPEC.md` (le cœur de l'application) et fait autorité pour tout ce qui concerne skraft.
> Sources analysées : [skraft-plugin](https://github.com/SebastienDegodez/skraft-plugin), plugin `skraft-framework` version 1.5.2 (branche `main`), puis branche [`refactor/v1.6.0-tracking-substrate`](https://github.com/SebastienDegodez/skraft-plugin/tree/refactor/v1.6.0-tracking-substrate) (version `1.6.0-hooks.1`, 23 septembre 2026). Les chemins du dépôt cités ici sont ceux de la 1.6.0.
> Version : 2026-09-23. Auteur : Samir.

---

## 0. Consignes pour Claude Code

1. **Lis `SPEC.md` avant ce document.** Tout ce qui touche au cœur (moteur de tâches, `ctx`, portes génériques, sessions, interactions, sécurité) y est défini ; ce document ne le répète pas.
2. **Prérequis** : les jalons J2 (moteur de tâches, extension `tdd`), J3 (`run_tests`, interactions persistées) et J4 (isolation, arbitre) de `SPEC.md` sont terminés. Les profils de stack complets (J5, `SPEC.md` section 8) sont requis à partir de S4 ; un profil vérifié par `/stack doctor` est nécessaire pour le projet de démonstration.
3. **Porte bloquante licence** : skraft est sous **GPL-3.0-or-later**. Ne copie aucun prompt, skill ni code du dépôt source tant que la question O9 de `SPEC.md` n'est pas tranchée. En attendant, implémente le réducteur, les portes et les schémas (sections 5 à 11), qui sont notre propre conception, avec des prompts de substitution minimaux.
4. **Ne reproduis pas l'architecture de contrôle de skraft** (orchestrateur LLM + hooks). La section 3 liste ses défauts constatés : chacun doit être impossible par construction dans notre implémentation.
5. **Le scénario US-12 (section 13) est le test d'acceptance de l'extension.** Chaque jalon S1 à S6 a des critères de sortie qui s'y rattachent.

---

## 1. Objectif et périmètre

skraft transforme une story en code livré, à travers quatre phases menées par des agents spécialisés et revues par des reviewers adverses :

```
RESEARCH → DESIGN → DISTILL → DELIVER
```

| Phase | Spécialiste | Reviewer | Produit |
| --- | --- | --- | --- |
| RESEARCH | Solution Researcher | aucun (remplacé par une porte, voir 7.1) | Document de recherche sourcé, recommandation |
| DESIGN | Solution Architect | Solution Architect Reviewer | Modèle d'événements, DDD, ADR, contrats, diagrammes |
| DISTILL | Acceptance Designer | Acceptance Designer Reviewer | Scénarios Gherkin, plans de test et d'implémentation, tests d'acceptance rouges |
| DELIVER | Software Engineer | Software Engineer Reviewer | Code, tests unitaires, preuves de qualité, commits |

**Dans le périmètre** : les quatre phases, la classification de difficulté, la ratification des ADR, les revues par lentilles.

**Hors périmètre du MVP** :
- Backlog Discoverer et Backlog Planner (production des stories à partir des issues GitHub) : restent des agents autonomes (O8). En entrée du pipeline, on attend un fichier de story fourni par l'utilisateur ou produit séparément par Backlog Planner.
- Agents brownfield (Analyst, Harness Builder, Refactorer) et workers (contract-testing, mocking, refactoring).

### 1.1 Entrée attendue

Un fichier de story Markdown contenant : identifiant, titre, énoncé « En tant que… je veux… », critères d'acceptation numérotés, section « Questions ouvertes » (éventuellement vide). Format exact : section 6.1.

---

## 2. Principe : ce qui change par rapport à skraft-plugin

| | skraft-plugin | Extension `skraft` |
| --- | --- | --- |
| Qui enchaîne les phases | Un agent LLM orchestrateur, guidé par un prompt de 2 750 mots | Le réducteur de la section 5 |
| Nature du contrôle | Négatif : des hooks peuvent refuser | Positif : le code lance chaque agent et chaque vérification |
| Écriture de l'état | CLI `state.mjs` + éditions manuelles par le LLM | Uniquement le moteur de tâches |
| Sorties des agents | Markdown, verdict extrait par regex | Outils terminaux à schéma |
| Preuves de qualité | Écrites par l'agent | Écrites par l'outil `run_tests` (notre code) |
| Tests d'acceptance | Scénario 1 en DISTILL, les suivants par l'ingénieur | Tous en DISTILL, gelés par empreinte |
| Synthèse de revue | Table appliquée par un LLM | Même table, appliquée par le code |
| Réessais | Le LLM décide de s'arrêter | Budget du réducteur, rollback, relance ciblée |

---

## 3. Défauts constatés dans skraft-plugin, à rendre impossibles

La colonne « 1.6.0 » donne le statut sur la branche `refactor/v1.6.0-tracking-substrate`. Un défaut corrigé côté skraft reste une garantie à assurer chez nous, par construction.

| Réf. | Défaut constaté | 1.6.0 | Garantie attendue dans notre implémentation |
| --- | --- | --- | --- |
| C1 | G1, G4, G5, G6 ne s'exécutent que si le payload contient `projectSlug`, que les harnais n'envoient jamais | Non corrigé, absent du plan de refonte | Le contexte (slug, rôle, phase) est connu du code qui ouvre la session ; aucune vérification ne dépend d'un payload externe |
| C2 | Deux modèles d'état incompatibles (G1/G6 attendent `specialistDone`, `reviewerVerdict`, `retries`, `skipPhases` ; le CLI écrit `verdicts`, `retryCount`, `phasesCompleted`) | Non corrigé, prévu par le plan | Un seul type `SkraftState` (section 4), un seul validateur |
| C3 | `init` crée l'état en `DISCOVER` ; la machine suit un cycle à cinq phases, la configuration en compte quatre | Non corrigé, prévu par le plan | `phaseOrder` lu depuis une seule source ; état initialisé sur `phaseOrder[0]` ; test qui l'assure |
| C4 | Les outils `Write`/`Edit` ne passent par aucun hook ; noms d'outils Copilot (`bash`, `edit`) non reconnus | Corrigé ; contournable par interpréteur (N2) | Gardes du cœur sur tous les outils d'écriture, noms normalisés ; détection par diff à chaque porte |
| C5 | Sortie des hooks `{decision, message}` non conforme aux formats des harnais | Corrigé | Hooks du SDK typés, en processus ; pas de format à traduire |
| C6 | Verdicts `APPROVED/NEEDS_REWORK/REJECTED` dans les rapports, `APPROVED/CHANGES_REQUESTED` dans l'état ; traduction par le LLM | Non corrigé | Enum unique `APPROVED \| CHANGES_REQUESTED \| REJECTED` imposé par le schéma de `submit_lens_verdict` |
| C7 | Contrôle de lecture des skills en fail-open (transcript attendu inline, champ `path` au lieu de `file_path`) | Corrigé dans le code | Skills obligatoires injectées dans la session ; `load_skill` tracé ; contrôle par les effets |
| E1 | « Commit vérifié » = arbre Git propre, même si rien n'a été fait | Non corrigé | Commits créés par le code à partir du SHA de départ enregistré |
| E2 | L'ordre des phases ne dépend que du prompt | Inchangé : le plan garde un orchestrateur LLM guidé par une projection | Ordre imposé par le réducteur |
| E3 | L'arrêt à budget épuisé dépend du LLM | Inchangé | Budget appliqué par le réducteur |
| E4 | DESIGN et DISTILL exigent les artefacts de DISCUSS, phase supprimée | Non vérifié en 1.6.0 | Dossier de passation construit à partir des phases réellement exécutées |
| E5 | La ratification des ADR se fait par édition manuelle de `adrRatification`, sans blocage | Aggravé : l'édition est désormais refusée par G7 (N1) | État `RATIFICATION` bloquant et persisté |
| E6 | Seul un adaptateur de qualité .NET existe ; sortie DISTILL codée en `*AcceptanceTests.cs` | Partiel : `quality-gates-javascript` ajoutée | Profil de stack du projet (`SPEC.md` section 8) ; chemins, commandes et formats fournis par le profil ; capacité absente = porte non disponible, jamais un échec |
| E7 | La skill de difficulté décrit encore le pipeline à cinq phases et ne donne aucun critère | Niveaux supprimés ; RESEARCH toujours exécutée | Indicateurs calculés et grille explicite (section 8) |
| N1 | Le routage d'entrée (`entryPoint`, écrit à chaque pipeline neuf) et la ratification (`adrRatification`) sont prescrits en édition directe de `state.json`, sans commande CLI ; G7 les refuse désormais | Nouveau en 1.6.0 ; commandes typées prévues par le plan | Aucun champ d'état n'est écrit par un agent : décisions persistées par le moteur de tâches, via les demandes d'interaction |
| N2 | G7 ne détecte pas les écritures par interpréteur (`node -e`, `python3 -c`) | Nouveau en 1.6.0, absent du plan | L'état vit hors du dépôt, dans le moteur de tâches ; les écritures dans le dépôt sont vérifiées par diff et empreinte à chaque porte, quel que soit l'outil |

---

## 4. Plan de reprise du dépôt source

À appliquer **après** la décision de licence (O9). Chemins relatifs à `plugins/skraft-framework/` sur la branche 1.6.0. Les agents y existent en deux surfaces synchronisées, `com.github.copilot/agents/*.agent.md` et `com.anthropic.claude-code/agents/*.md` : partir de la surface Copilot. Les règles d'état données au LLM sont dans `com.github.copilot/rules/` et ne sont pas reprises.

### 4.1 Agents

| Source | Action | Rôle dans l'extension |
| --- | --- | --- |
| `com.github.copilot/agents/skraft-orchestrator.agent.md` | **Ne pas reprendre** | Remplacé par le réducteur. Seules les règles de routage d'entrée sont transposées (section 8.1) |
| `com.github.copilot/agents/solution-researcher.agent.md` | Adapter | `skraft-researcher` |
| `com.github.copilot/agents/solution-architect.agent.md` | Adapter, découper en deux rôles | `skraft-architect-model` (étapes 1 à 6 : lecture, réutilisation, revue des ADR, Event Modeling, DDD) et `skraft-architect-decide` (étapes 7 à 10 : ADR, contrats, réconciliation, synthèse) |
| `com.github.copilot/agents/solution-architect-reviewer.agent.md` | Adapter | Configuration de la revue DESIGN |
| `com.github.copilot/agents/acceptance-designer.agent.md` | Adapter | `skraft-acceptance` ; écrit **tous** les tests d'acceptance |
| `com.github.copilot/agents/acceptance-designer-reviewer.agent.md` | Adapter | Configuration de la revue DISTILL |
| `com.github.copilot/agents/software-engineer.agent.md` | Adapter | `skraft-test` et `skraft-dev` (séparation des rôles, section 7.4) |
| `com.github.copilot/agents/software-engineer-reviewer.agent.md` | Adapter | Configuration de la revue DELIVER |
| `com.github.copilot/agents/cold-reader-lens.agent.md` | Reprendre, sortie JSON | Lentille `cold-reader` |
| `com.github.copilot/agents/test-integrity-lens.agent.md` | Reprendre, sortie JSON | Lentille `test-integrity` |
| `com.github.copilot/agents/architecture-boundaries-lens.agent.md` | Reprendre, recentrer sur le jugement | Lentille `architecture` (la règle de dépendance est vérifiée par le code) |
| `com.github.copilot/agents/quality-gates-lens.agent.md` | **Supprimer** | Ses contrôles sont faits par le code |
| `backlog-*`, `brownfield-*`, `*-worker`, lentilles `discovery-*`, `planning-*`, `contract-fidelity`, `mock-fidelity` | Hors MVP | — |

Adaptation commune à tous les prompts repris :
- supprimer toute instruction d'appel à `state.mjs`, d'édition de `state.json`, de commit, d'exécution directe des tests ou d'écriture de preuves ;
- remplacer la fin de mission par l'appel de l'outil terminal du rôle (section 6.3) ;
- supprimer les références à DISCUSS et DISCOVER (encore présentes en 1.6.0, y compris dans `skraft-entry-point-routing`) ;
- remplacer « escalader vers … » par `report_blocker` ;
- retirer les consignes d'impression de journaux ou de checklists dans le chat.

### 4.2 Skills

| Catégorie | Skills | Action |
| --- | --- | --- |
| Méthode (reprises telles quelles) | `outside-in-tdd`, `bdd-methodology`, `test-design-mandates`, `craft-discipline`, `test-refactoring-catalog`, `clean-architecture-testing`, `architecture-patterns`, `architecture-decisions`, `adr-eligibility-gate`, `mutation-testing` (partie méthode) | Reprendre ; injectées ou chargées selon le rôle (section 6.4) |
| Critères de revue | `acceptance-review-criteria`, `architecture-review-criteria`, `adversarial-review-lenses` | Reprendre ; la table de pondération de `adversarial-review-lenses` est **transcrite en code** (section 9.3) |
| Devenues du code ou des profils | `quality-gates-evidence-contract`, `quality-gates-dotnet`, `quality-gates-javascript` (1.6.0), `resolving-stack-commands`, `skraft-quality-bar` | Ne plus les donner aux agents. Le schéma de preuves devient celui de `run_tests` ; les commandes, formats et options par langage deviennent des **profils de stack** d'exemple (`profiles/`) ou des faits pour `/stack init` ; les seuils deviennent ceux de la porte de fin de scénario et du profil |
| Supprimée en 1.6.0 | `skraft-difficulty-routing` | Remplacée côté skraft par `skraft-entry-point-routing`, dont on reprend la règle (section 8.1) ; notre grille de difficulté ne règle que les moyens (8.4) |
| Hors MVP | `issue-*`, `sprint-planning`, `github-search-protocol`, `discovery-review-criteria`, `planning-review-criteria`, `characterize-*`, `compose-brownfield-prd`, `mikado-method`, `strangler-fig-method`, `contract-testing*`, `mocking-*`, `playwright-evidence`, `qa-reporting` (1.6.0) | — |

### 4.3 Code

| Source | Action |
| --- | --- |
| `src/domain/state-machine.mjs` (invariants I1 à I9) | Transposer les invariants en préconditions du réducteur (section 5.3), **pas** le code tel quel |
| `src/domain/artifact-policy.mjs` | Reprendre la correspondance motifs d'artefacts ; corriger le vocabulaire de verdict (C6) |
| `src/domain/skill-policy.mjs` | Remplacé par la table `mandatorySkills` du manifeste |
| `src/domain/pipeline-policy.mjs` | Ne pas reprendre (calcul de l'agent attendu : le réducteur le sait déjà) |
| `src/domain/session-guard-policy.mjs` | S'en inspirer pour les motifs de détection d'écriture shell des gardes du cœur, en sachant qu'ils ne voient pas les écritures par interpréteur (N2) : la détection par diff reste la garantie |
| `src/adapters/api/hooks/harness-input.mjs` (1.6.0) | Reprendre la table de normalisation des noms d'outils (`bash`, `shell`, `edit`, `str_replace`, `create_file`, `view`, `task`…) pour les gardes du cœur et l'adaptateur `AgentRuntime` |
| Commande `artifact adr` (rendu d'ADR depuis un gabarit, refus si champ manquant) | Reprendre comme outil `render_adr` (section 7.2) |
| Autres adaptateurs de hooks, `src/cli/hook.mjs`, manifestes `hooks.json` | Ne pas reprendre |
| JSON Schemas d'état et de projection annoncés par le plan 1.6.0 (`.specs/plan_todo.md`) | Pas encore livrés ; à réévaluer à leur livraison pour aligner `SkraftState` si c'est compatible |
| `src/cli/state.mjs`, `src/cli/housekeeping.mjs` | Remplacés par le moteur de tâches |
| `skraft-framework.config.json` | Source pour générer le manifeste (`phaseAgents`, `agentSkills`, `agentArtifacts`) |
| `tests/skraft-framework/*` | Reprendre les tests des politiques conservées |

---

## 5. Modèle d'état et réducteur

### 5.1 État unifié

```ts
export type Phase = "RESEARCH" | "DESIGN" | "DISTILL" | "DELIVER";
export type Difficulty = "simple" | "medium" | "medium-hard" | "challenging";
export type Verdict = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

export type Stage =
  | "INIT" | "CLASSIFY" | "CONFIRM_DIFFICULTY" | "ROUTE"
  | "SPECIALIST" | "ARTIFACT_GATE" | "REVIEW" | "VERDICT_GATE"
  | "RATIFICATION" | "COMMIT" | "BLOCKED" | "ESCALATED"
  | "DONE" | "ABORTED";

export interface SkraftState {
  schemaVersion: 1;
  slug: string;                              // dérivé de l'identifiant de la story (ex. "us-12")
  storyPath: string;
  stage: Stage;
  phase: Phase | null;                       // phase courante, null avant ROUTE
  phaseOrder: Phase[];                       // copie de la configuration au démarrage
  skipPhases: Phase[];                       // vide sauf décision humaine (escalade « sauter ») ; jamais déduit de la difficulté
  phasesCompleted: Phase[];                  // append-only
  difficulty: { level: Difficulty; indicators: DifficultyIndicators; confirmedBy: "user" | "auto" } | null; // écrit une fois
  baseSha: string;                           // SHA Git de départ
  branch: string;                            // "skraft/<slug>"
  checkpoints: Partial<Record<Phase, string>>; // SHA au début de chaque phase
  artifacts: Record<Phase, ArtifactRecord[]>;  // append-only
  reviews: Record<Phase, ReviewRecord[]>;      // append-only
  attempts: number;                          // essais dans la phase courante
  budget: { maxAttemptsPerPhase: number };   // 3 par défaut
  lastRejection: { gate: string; reasons: string[] } | null;
  openQuestions: { id: string; text: string; answer?: string }[];
  adrs: { id: string; path: string; status: "Proposed" | "Accepted" | "Rejected"; decisionBy?: string }[];
  pendingInteraction: string | null;         // id de demande d'interaction
  deliver: DeliverState | null;              // sous-machine, section 7.4
}

export interface ArtifactRecord { path: string; sha256: string; producedBy: string; attempt: number }
export interface ReviewRecord { attempt: number; lenses: LensVerdict[]; verdict: Verdict; reportPath: string }
```

Validation par schéma (Zod) à chaque chargement ; un état invalide met la tâche en `ESCALATED` avec motif `ENV_FAILURE: état corrompu`, jamais en exécution.

### 5.2 Transitions

| Stage | Événement | Garde | Stage suivant | Effets |
| --- | --- | --- | --- | --- |
| INIT | `START` (état neuf) | story valide (6.1), précontrôle des tests verts | CLASSIFY | notifier la dette de couverture, enregistrer le checkpoint qualité initial, créer branche, enregistrer `baseSha`, calculer indicateurs, relever un éventuel transfert amont (8.1) |
| INIT | `START` (état existant) | — | stage persisté | reprise (SPEC.md 6.3) |
| CLASSIFY | `DIFFICULTY_PROPOSED` | niveau dans l'enum | CONFIRM_DIFFICULTY | demande d'interaction (mode simple) ou confirmation auto |
| CONFIRM_DIFFICULTY | `HUMAN_DECISION` | — | ROUTE | écrire `difficulty` ; régler budget, granularité et lentilles (8.4) |
| ROUTE | (interne) | reste une phase non sautée | SPECIALIST | checkpoint de phase, construire le dossier de passation, lancer le spécialiste |
| ROUTE | (interne) | plus de phase | DONE | bilan final |
| SPECIALIST | `AGENT_REPORTED` | — | ARTIFACT_GATE | exécuter la porte de la phase |
| SPECIALIST | `BLOCKER_REPORTED` | — | BLOCKED | demande d'interaction avec la question |
| BLOCKED | `HUMAN_DECISION` | — | SPECIALIST | relancer avec la réponse dans le dossier |
| ARTIFACT_GATE | `GATE_OK` | phase avec reviewer | REVIEW | lancer les lentilles |
| ARTIFACT_GATE | `GATE_OK` | phase sans reviewer | COMMIT | — |
| ARTIFACT_GATE | `GATE_FAIL` | `attempts + 1 < max` | SPECIALIST | rollback au checkpoint de phase, relance ciblée |
| ARTIFACT_GATE | `GATE_FAIL` | budget épuisé | ESCALATED | demande d'interaction |
| REVIEW | `LENSES_DONE` | — | VERDICT_GATE | synthèse par le code (9.3) |
| VERDICT_GATE | `APPROVED` | phase = DESIGN | RATIFICATION | une demande d'interaction par ADR `Proposed` |
| VERDICT_GATE | `APPROVED` | autre phase | COMMIT | — |
| VERDICT_GATE | `CHANGES_REQUESTED` | budget restant | SPECIALIST | rollback, relance avec les défauts des lentilles |
| VERDICT_GATE | `REJECTED` ou budget épuisé | — | ESCALATED | demande d'interaction |
| RATIFICATION | `HUMAN_DECISION` | tous les ADR décidés, aucun `amend` | COMMIT | basculer les statuts via `render_adr` |
| RATIFICATION | `HUMAN_DECISION` (`amend`) | — | SPECIALIST | relance de `skraft-architect-decide` avec la demande |
| COMMIT | (interne) | — | ROUTE | commit `docs(skraft):` ou `feat:` selon la phase, `phasesCompleted += phase`, `attempts = 0` |
| ESCALATED | `HUMAN_DECISION` (`retry`) | — | SPECIALIST | `attempts = 0` |
| ESCALATED | `HUMAN_DECISION` (`skip`) | — | ROUTE | rollback au checkpoint de phase, phase ajoutée à `skipPhases` |
| ESCALATED | `HUMAN_DECISION` (`abort`) | — | ABORTED | — |
| tous | `ABORT` | — | ABORTED | — |
| tous | `TIMEOUT` | budget restant | SPECIALIST | comme `GATE_FAIL` |
| tous | `ENV_FAILURE` | — | ESCALATED | escalade immédiate |

### 5.3 Invariants (transposés de skraft I1 à I9)

1. On ne quitte une phase qu'après `APPROVED` (ou `GATE_OK` pour une phase sans reviewer).
2. La phase suivante est toujours la prochaine de `phaseOrder` hors `skipPhases`.
3. `attempts` ne dépasse jamais `budget.maxAttemptsPerPhase`.
4. `phasesCompleted`, `artifacts`, `reviews` sont append-only.
5. `difficulty` n'est écrite qu'une fois.
6. `DONE` et `ABORTED` sont terminaux.
7. `DISTILL` est inatteignable tant qu'un ADR est `Proposed`.
8. Aucun agent n'écrit l'état : seul le moteur le fait.

Chaque invariant a un test unitaire dédié sur le réducteur.

---

## 6. Entrées, sorties, rôles

### 6.1 Format de la story

```markdown
# US-12 — Plafonner le bolus proposé

En tant que patient, quand le calcul propose une dose de bolus supérieure au plafond défini par mon médecin,
je veux que la dose proposée soit limitée à ce plafond et qu'une alerte m'explique pourquoi.

## Critères d'acceptation
1. Plafond de 10 U, calcul à 6 U : dose proposée 6 U, pas d'alerte.
2. Plafond de 10 U, calcul à 12,5 U : dose proposée 10 U, alerte « Dose plafonnée à 10 U ».
3. Aucun plafond configuré : dose proposée égale au calcul, pas d'alerte.

## Questions ouvertes
- Le plafond s'applique-t-il par prise ou par jour ?
```

Validation à INIT : titre avec identifiant, au moins un critère numéroté. Les **littéraux** des critères (nombres, unités, chaînes entre guillemets) sont extraits et stockés : ils alimentent la porte valeurs (7.3). Une référence (« ADR 0069 », « #32 ») n'en est pas un. Un nombre seul, sans unité, est une valeur douteuse : il est soumis à l'humain en ROUTE, avant RESEARCH, qui le garde ou le retire de la porte (ADR 0080).

**Précontrôle avant tout appel LLM (ADR 0060)** : le code exécute les tests existants
(`INIT_BASELINE`). Échec, test ignoré, délai dépassé ou sortie non nulle bloquent le
lancement avec motifs explicites. Une couverture existante sous les seuils déclarés
déclenche un avertissement non bloquant ; une couverture absente est annoncée non mesurée.
Un checkpoint de qualité initial conserve le périmètre de la tâche pour la couverture du diff.

### 6.2 Arborescence des artefacts

Racine : `.skraft/<slug>/` dans le dépôt (OUVERT S-O1 : garder la racine `.copilot-tracking/skraft-plans/` de skraft pour compatibilité ?).

```
.skraft/<slug>/
├── story.md                       # copie de l'entrée
├── research/research.md
├── design/event-model.md
├── design/diagrams.md
├── design/contracts.md
├── design/context-map.md
├── design/consistency-matrix.md
├── distill/features/<feature>.feature
├── distill/test-plan.md
├── distill/impl-plan.md
├── reviews/<phase>-review-<n>.md  # rapport lisible, généré par le code depuis les JSON des lentilles
├── reviews/<phase>-review-<n>.json
└── evidence/<scenario>/…          # preuves écrites par run_tests
docs/adr/adr-<NNN>-<slug>.md       # dans le dépôt, append-only
docs/adr/supersessions.md
```

Les tests d'acceptance et le code vont aux emplacements déclarés dans le profil de stack (`paths.acceptanceTests`, `paths.unitTests`, `paths.sources`), par exemple `tests/acceptance/` pour un projet TypeScript.

### 6.3 Rôles, périmètres, outils terminaux

| Rôle | Phase | Écrit dans | Outils | Outil terminal |
| --- | --- | --- | --- | --- |
| `skraft-classifier` | CLASSIFY | rien | — | `submit_difficulty` |
| `skraft-researcher` | RESEARCH | `.skraft/<slug>/research/**` | lecture, recherche web si autorisée, `load_skill` | `report_phase` |
| `skraft-architect-model` | DESIGN | `.skraft/<slug>/design/**` | lecture, `load_skill` | `report_phase` |
| `skraft-architect-decide` | DESIGN | `.skraft/<slug>/design/**` | `render_adr`, `load_skill` | `report_phase` |
| `skraft-acceptance` | DISTILL | `.skraft/<slug>/distill/**`, dossier des tests d'acceptance | `run_tests`, `load_skill` | `report_phase` |
| `skraft-test` | DELIVER | dossiers de tests unitaires | `run_tests`, `load_skill` | `report_phase` |
| `skraft-dev` | DELIVER | dossiers de production | `run_tests`, `load_skill` | `report_phase` |
| lentilles | revues | rien | lecture | `submit_lens_verdict` |

Tous les rôles disposent aussi de `report_blocker`. Aucun rôle n'écrit dans `docs/adr/` directement : seul `render_adr` le fait.

### 6.4 Skills par rôle

| Rôle | Injectées (obligatoires) | À la demande (`load_skill`) |
| --- | --- | --- |
| `skraft-researcher` | — | — |
| `skraft-architect-model` | `architecture-patterns` | `architecture-decisions` |
| `skraft-architect-decide` | `architecture-decisions`, `adr-eligibility-gate` | `architecture-patterns` |
| `skraft-acceptance` | `bdd-methodology`, `test-design-mandates` | `outside-in-tdd`, `craft-discipline` |
| `skraft-test` | `test-design-mandates`, `outside-in-tdd` (sections RED) | `test-refactoring-catalog`, `clean-architecture-testing` |
| `skraft-dev` | `craft-discipline`, `outside-in-tdd` (sections GREEN/REFACTOR) | `clean-architecture-testing`, `test-refactoring-catalog` |
| lentilles | critères de la phase revue | — |

Injecter une **section** plutôt qu'une skill entière quand c'est possible : c'est l'un des principaux leviers d'économie de tokens.

### 6.5 Outils spécifiques à l'extension

```ts
submit_difficulty({ level: Difficulty, justification: string })           // terminal
render_adr({ number?, title, status: "Proposed", context, decision,
             consequences, alternatives, supersedes?: string[] })          // refus si champ manquant ou numéro en double
submit_lens_verdict({ lens: string, verdict: Verdict,
                      defects: { severity: "blocker" | "major" | "minor", file?: string, line?: number, description: string }[] }) // terminal
```

`report_phase`, `report_blocker`, `run_tests`, `load_skill` sont fournis par le cœur (SPEC.md 6.5).

---

## 7. Phases

Pour chaque phase : ce que reçoit l'agent, ce qu'il produit, la porte exécutée par le code, et l'exemple US-12.

### 7.1 RESEARCH

Toujours exécutée, quelle que soit la difficulté, comme dans skraft 1.6.0.

**Préparation (code)** : présélection des fichiers candidats par mots-clés extraits de la story (noms, termes métier), limitée à vingt fichiers, placée dans le dossier de passation.

**Agent** `skraft-researcher` : enquête sur le code et les sources externes, produit `research/research.md` selon le gabarit : périmètre et critères de succès, fichiers analysés, recherches effectuées, conventions du projet, découvertes clés (chaque affirmation sourcée), approches évaluées, recommandation unique, passage de relais à DESIGN (décisions à valider, questions ouvertes).

**Vérification par le chercheur (ADR 0082)** : le chercheur dispose de l'outil `verifier_recherche`, qui rend ce que la porte des citations dirait de son document ; c'est le même calcul que la porte, rejouée par le code après son tour. Sans vérification depuis sa dernière modification, sa sortie est refusée une fois.

**Porte citations (code), pas de reviewer LLM** :

| Contrôle | Rejet si |
| --- | --- |
| Sections du gabarit | Une section manque |
| Chemins cités (`chemin/fichier.ext` ou `chemin:12-40`) | Le fichier n'existe pas dans le dépôt |
| Plages de lignes | La plage dépasse la longueur du fichier ou est inversée |
| URL | Mal formée |
| Recommandation | Absente ou multiple |
| Questions ouvertes | — (pas de rejet) : extraites, ajoutées à `openQuestions` |

En fin de porte, chaque question ouverte **sans réponse** génère une demande d'interaction ; la phase suivante ne démarre qu'une fois toutes les questions répondues ou explicitement reportées par l'utilisateur.

**US-12** : la citation `Sources/Bolus/BolusCalculator.swift:40-72` est rejetée (fichier de 55 lignes) avec le motif exact ; l'agent corrige. La question « par prise ou par jour ? » est posée ; réponse : « par prise ».

### 7.2 DESIGN

Deux sessions successives, dans la même phase.

**`skraft-architect-model`** : lit la story, la recherche, les ADR existants et le code ; produit `event-model.md` (commandes, événements, vues), `context-map.md`, le modèle DDD tactique (agrégats, value objects, événements de domaine, interfaces de repository) et la liste des ADR existants à reconsidérer.

**`skraft-architect-decide`** : applique le test d'éligibilité aux ADR (une convention déjà imposée par le projet ne mérite pas d'ADR), rédige chaque ADR **uniquement via `render_adr`** en statut `Proposed`, produit `contracts.md`, `diagrams.md`, `consistency-matrix.md`, et met à jour `supersessions.md` via `render_adr`. Refus d'adopter CQRS, Event Sourcing ou microservices sans justification mesurée (règle reprise de skraft).

**Refus routé vers son auteur** : chaque motif d'un refus de DESIGN va à l'agent qui a produit le fichier en cause. Le modèle (`event-model.md`, `domain-model.md`, `context-map.md`) au modélisateur ; les ADR, `contracts.md`, `diagrams.md`, la matrice et `supersessions.md` à l'architecte qui décide ; un motif qui lie les deux, ou ne nomme aucun fichier, aux deux. Après le premier essai, le modélisateur n'est relancé que si un motif le concerne.

**Défaut du modèle signalé** : le modèle appartient au modélisateur. L'architecte qui décide le lit sans pouvoir l'écrire ; s'il lui trouve un défaut, il le décrit dans le champ `modelDefects` de `report_phase`. Le code relance alors le modélisateur avec ces remarques, puis l'architecte qui décide, une seule fois par essai et sans en consommer un ; au-delà, la porte et la revue tranchent.

**Porte cohérence (code)** :

| Contrôle | Rejet si |
| --- | --- |
| En-tête de chaque nouvel ADR | Champ obligatoire absent, statut différent de `Proposed` |
| Numérotation | Trou ou doublon creusé par la story ; un ADR de la story hors convention (`docs/adr/adr-NNN-titre.md`, `# ADR-NNN — Titre`). Les ADR existants comptent par leur numéro, quel que soit leur format, et ne sont pas jugés ; chaque motif nomme le fichier et le numéro attendu (ADR 0079) |
| Événements cités dans `contracts.md` et `diagrams.md` | Absent de `event-model.md` |
| Agrégats cités | Absent du modèle |
| Remplacements | Un ADR remplacé n'apparaît pas à la fois dans le nouvel ADR et dans `supersessions.md` |
| ADR existants | Un ADR existant a été modifié (append-only) |

L'extraction des noms repose sur une convention imposée dans les prompts : identifiants en `PascalCase` entre backticks dans les documents de conception.

**Revue** : lentilles `cold-reader` et `architecture` (section 9).

**Numéro d'un ADR** : calculé par le code, après tous les ADR de `docs/adr/` (ADR 0079) ; `render_adr` le prend lui-même. Dans le workflow, où l'architecte écrit ses fichiers, le dossier de passation le lui donne, et la garde refuse un nom hors convention ou un numéro déjà pris.

**Ratification** : une demande d'interaction par ADR, à laquelle n'importe qui répond (ADR 0087) ; options `accept`, `reject`, `amend` (avec texte). Tant qu'un ADR est `Proposed`, DISTILL est inatteignable (invariant 7).

**US-12** : `contracts.md` cite `BolusLimited`, absent du modèle qui définit `BolusCapped` → rejet « `BolusLimited` cité dans contracts.md n'existe pas dans event-model.md ». Après correction et approbation, l'`ADR-008 — Plafond appliqué dans le domaine` est ratifié.

### 7.3 DISTILL

**Agent** `skraft-acceptance` : associe chaque critère d'acceptation à un ou plusieurs scénarios ; écrit les `.feature` ; rédige `test-plan.md` (couche testée et type de doublure par scénario, stratégie de walking skeleton) et `impl-plan.md` (étapes ordonnées par scénario) ; écrit **les tests d'acceptance de tous les scénarios** avec les signatures minimales nécessaires à la compilation, aux emplacements déclarés dans le profil de stack ; les valeurs sont copiées mot pour mot des critères.

**Vérification par l'agent (ADR 0082)** : l'agent d'acceptance dispose de l'outil `verifier_scenarios`, qui rend ce que les portes gherkin, valeurs et plan de test diraient de ses fichiers ; c'est le même calcul que la porte, rejouée par le code après son tour. Sans vérification depuis sa dernière modification, sa sortie est refusée une fois.

**Porte valeurs (code)** : chaque littéral extrait de la story (6.1) doit apparaître dans le `.feature` du scénario correspondant **et** dans le fichier de test d'acceptance. Normalisation : séparateur décimal `,` ou `.`, espaces insécables. Une valeur douteuse retirée par l'humain (6.1, ADR 0080) n'est pas exigée ; le bilan du run la nomme.

**Porte RED d'acceptance (code)** : exécution des tests d'acceptance selon le profil de stack, classification des échecs par le moteur générique.

| Résultat d'un test | Décision |
| --- | --- |
| Échec sur assertion | Accepté |
| Échec sur symbole manquant (compilation) | Accepté |
| Erreur de syntaxe, crash de setup | Rejeté |
| Réussi | Signalé : requalifié en test de non-régression (champ `role: "regression"` dans `test-plan.md`), visible des lentilles ; rejeté si le scénario était censé piloter un nouveau comportement et qu'aucune justification n'est donnée |

À la sortie de la porte : **empreinte de tous les tests d'acceptance** enregistrée pour la revue
de l'essai courant. Si la revue refuse DISTILL, le gel est levé pour permettre la correction,
y compris l'ajout de tests par `skraft-acceptance` ; les portes sont rejouées et une nouvelle
empreinte est enregistrée. Une interruption, une panne ou un rembobinage de DISTILL invalide
aussi cette empreinte. Après approbation de DISTILL, les tests sont gelés pour toute la suite
du pipeline : un refus de revue en DELIVER ne lève pas ce gel (ADR 0059).

**Revue** : lentilles `cold-reader` et `test-integrity`.

**US-12** : scénario 2 écrit avec « 12 U » → rejet « la valeur 12,5 du critère 2 n'apparaît pas dans le scénario 2 ». Puis : scénario 1 rouge sur `BolusCapPolicy` introuvable (accepté), scénario 2 rouge sur assertion 10 ≠ 12,5 (accepté), scénario 3 vert (requalifié en non-régression, justifié : le comportement « aucun plafond » existe déjà).

### 7.4 DELIVER

Sous-machine exécutée pour chaque scénario de `impl-plan.md`, dans l'ordre.

```ts
export interface DeliverState {
  scenarios: { id: string; acceptanceTestId: string; role: "driver" | "regression"; status: "pending" | "in_progress" | "done" }[];
  current: number;
  granularity: "turn-per-scenario" | "session-per-step";   // SPEC.md D22
  acceptanceHash: string;                                    // empreinte gelée en DISTILL
  unitTestsHash: string | null;                              // empreinte après chaque RED validé
  scenarioCheckpoint: string | null;
}
```

**Granularité par défaut (`turn-per-scenario`)** : `skraft-test` écrit le test unitaire suivant puis rend la main ; `skraft-dev` fait passer au vert et refactore dans le même tour ; chaque exécution de tests passe par `run_tests`, qui enregistre les preuves. Les gardes du cœur refusent toute écriture de `skraft-dev` dans un dossier de tests. La boucle alterne test / dev jusqu'à ce que le test d'acceptance du scénario soit vert.

**Granularité stricte (`session-per-step`)** : identique à l'extension `tdd` (SPEC.md 9.2 et 9.3), avec la vérification d'acceptance en plus. Activée par réglage, pour `challenging`, ou automatiquement après un échec de scénario.

**Vérifications pendant la boucle (code)** : mêmes portes que l'extension `tdd` (SPEC.md 9.3), plus : empreinte des tests d'acceptance toujours égale à `acceptanceHash`.

**Porte de fin de scénario (code)** :

| Contrôle | Seuil ou règle |
| --- | --- |
| Test d'acceptance du scénario | Vert |
| Suite complète | Verte, aucun test ignoré |
| Séquence dans les preuves | Au moins un rouge puis un vert par test unitaire ajouté |
| Couverture | Seuils déclarés par couche sur les seules lignes exécutables ajoutées ou modifiées depuis le checkpoint du scénario ; dette historique inchangée exclue, numéros des lignes non couvertes dans le rejet (ADR 0060) |
| Mutation (profil de stack) | Seuils du profil ; par défaut 100 % domaine et application, 90 % API et infrastructure. Capacité absente : porte non disponible, selon la politique du projet |
| Règle de dépendance | Couches et imports autorisés déclarés dans le profil ; capacité absente : porte non disponible |
| Qualité de forme | Le **linter du projet** (ESLint, ruff…), avec ses propres règles : longueur de méthode, imbrication, taille des types. Capacité absente : porte non disponible, constat « non mesurée » |
| Tests qui ne tuent aucun mutant | Pas de rejet : listés pour le reviewer |

Les seuils de mutation reprennent `skraft-quality-bar` ; ils sont configurables par projet (`ctx.settings`).

La fin de DELIVER revérifie aussi la couverture du diff depuis le checkpoint de qualité
initial de **toute la tâche**, y compris les sources écrites avant DELIVER. Le détail
par ligne ou un fichier absent du rapport est signalé non mesuré, jamais remplacé par
un taux global ni supposé conforme. Le checkpoint initial est conservé au redémarrage ;
un ancien état qui n'en possède pas est vérifié depuis DELIVER avec avertissement explicite.

**Preuves** : on reprend le schéma de `quality-gates-evidence-contract` (sortie, code de sortie, empreintes sha256, instantanés rouge et vert) ; l'écrivain est `run_tests`, jamais l'agent.

**Blocage métier** : une valeur ou une règle manquante → `report_blocker` → stage `BLOCKED` → question à l'utilisateur → relance.

**Revue** : lentilles `cold-reader`, `test-integrity`, `architecture`, après le dernier scénario. OUVERT S-O2 : revue par scénario pour `challenging` ?

**US-12, scénario 2** : `skraft-test` écrit `testCapsDoseAboveMax` ; `run_tests` enregistre l'échec sur `XCTAssertEqual(10, 12.5)` ; `skraft-dev` crée `BolusCapPolicy`, la branche dans `BolusCalculator`, extrait le value object `MaxBolus` ; `run_tests` enregistre le vert ; porte de fin de scénario : acceptance verte, Muter 100 % sur le module Domain, module Domain sans import d'infrastructure. Si `skraft-dev` tente de modifier `testCapsDoseAboveMax`, la garde refuse l'écriture ; si la modification passe par un autre chemin, l'empreinte la détecte et le tour est annulé par rollback.

---

## 8. Routage d'entrée et difficulté

### 8.1 Routage d'entrée

Aligné sur skraft 1.6.0 : **les quatre phases d'ingénierie s'exécutent toujours**, RESEARCH compris. Aucune phase n'est sautée en fonction de la difficulté.

Le routage d'entrée de skraft (skill `skraft-entry-point-routing`) ne concerne que DISCOVER, une phase produit hors du pipeline d'ingénierie : il détecte un transfert amont complet (backlog trié et périmètre de sprint) et demande à l'utilisateur de le confirmer. Dans notre MVP, la story est fournie directement (section 1.1) : le code relève seulement l'éventuelle provenance du transfert (issue, sprint) et l'enregistre dans l'état, pour la traçabilité. Aucune écriture d'état par un agent n'est nécessaire, contrairement à skraft où cette étape est aujourd'hui bloquée (N1).

`skipPhases` ne se remplit que par une décision humaine explicite, lors d'une escalade (« sauter la phase »).

### 8.2 Indicateurs calculés par le code

| Indicateur | Calcul |
| --- | --- |
| `acceptanceCriteria` | Nombre de critères numérotés dans la story |
| `modulesTouched` | Nombre de modules du dépôt dont un nom ou un fichier est cité, ou ressort de la présélection (7.1) |
| `newExternalIntegration` | Mention d'une API, base, file de messages ou service absent du code actuel |
| `openBusinessQuestions` | Nombre de questions ouvertes portant sur une règle métier |

### 8.3 Grille initiale

| Niveau | Condition (la première qui s'applique, du plus élevé au plus bas) |
| --- | --- |
| `challenging` | `newExternalIntegration` et `modulesTouched ≥ 3`, ou `openBusinessQuestions ≥ 2` |
| `medium-hard` | `acceptanceCriteria > 5`, ou `modulesTouched ≥ 3`, ou `openBusinessQuestions ≥ 1` |
| `medium` | `acceptanceCriteria ≥ 3` ou `modulesTouched = 2` |
| `simple` | sinon |

Les seuils sont des réglages ; ils seront ajustés à partir des mesures d'usage (SPEC.md D37).

Le LLM (`skraft-classifier`) reçoit les indicateurs et le niveau proposé par la grille ; il peut proposer un cran de plus ou de moins avec une justification. L'utilisateur confirme en mode simple (SPEC.md O3).

skraft 1.6.0 a supprimé ses niveaux de difficulté. Nous gardons une évaluation, mais elle ne décide plus d'aucun saut de phase : elle ne règle que les moyens (8.4). Son intérêt est à confirmer par les mesures d'usage (S-O7).

### 8.4 Effets du niveau

| Niveau | Granularité DELIVER | Lentilles | Budget de réessais |
| --- | --- | --- | --- |
| `simple` | `turn-per-scenario` | `cold-reader`, `test-integrity` | 2 |
| `medium` | `turn-per-scenario` | toutes | 3 |
| `medium-hard` | `turn-per-scenario` | toutes | 3 |
| `challenging` | `session-per-step` | toutes, revue par scénario si S-O2 | 3 |

**US-12** : 3 critères, 2 modules, pas d'intégration, 1 question métier ouverte → grille `medium-hard` → confirmé par l'utilisateur → granularité `turn-per-scenario`, toutes les lentilles, budget de 3. RESEARCH est exécutée, comme pour toute story.

---

## 9. Revue

### 9.1 Faits établis avant la revue

Le code joint au dossier des lentilles un bloc de faits, présentés comme acquis : résultats de tests, séquences rouge/vert, mutation, règle de dépendance, empreintes, résultats des portes. Les lentilles ne revérifient pas ces faits.

### 9.2 Lentilles

| Lentille | Contexte reçu | Juge |
| --- | --- | --- |
| `cold-reader` | **Aucun contexte du producteur** : seulement les artefacts, le code et les tests | Compréhensibilité, noms, intentions lisibles |
| `test-integrity` | Tests, critères, faits | Pertinence des tests, tests faibles, tests qui ne tuent aucun mutant, requalifications en non-régression |
| `architecture` | ADR ratifiés, code, faits | Fidélité aux ADR et au modèle, découpage, dette introduite |

Chaque lentille tourne dans une session neuve, en parallèle, et rend `submit_lens_verdict`.

### 9.3 Synthèse par le code

La table de pondération de la skill `adversarial-review-lenses` est transcrite dans une fonction pure `synthesize(lenses: LensVerdict[]): Verdict`, couverte par des tests à partir de cas tabulés. Règles minimales en attendant la transcription :
- un défaut `blocker` dans une lentille → `CHANGES_REQUESTED` ;
- deux lentilles `REJECTED` → `REJECTED` ;
- toutes `APPROVED` sans défaut `major` → `APPROVED` ;
- sinon `CHANGES_REQUESTED`.

Hors DELIVER, un `CHANGES_REQUESTED` qui ne laisse aucun défaut bloquant ni majeur à corriger ne fait pas rejouer la phase : la revue est approuvée, ses mineurs restent au rapport ; si une lentille a rendu `REJECTED` ou qu'une question reste sans lentille, l'humain décide, sans qu'un essai soit consommé (ADR 0081). DELIVER suit l'ADR 0062.

Le code génère ensuite le rapport lisible `reviews/<phase>-review-<n>.md` depuis les JSON. Lors d'un réessai, seuls les défauts `blocker` et `major` sont transmis au spécialiste, avec fichier et ligne.

**US-12** : `cold-reader` signale « `MaxBolus` accepte une valeur négative » (`major`) → `CHANGES_REQUESTED` → rollback au dernier commit vert du scénario concerné, relance de `skraft-dev` avec ce seul défaut.

---

## 10. Manifeste de l'extension

```jsonc
{
  "id": "agent-studio.skraft",
  "version": "0.1.0",
  "publisher": "agent-studio",
  "engines": { "appApi": "^0.1" },
  "main": "dist/index.mjs",
  "activationEvents": ["onCommand:skraft"],
  "permissions": [
    "fs:read",
    "fs:write:.skraft/**", "fs:write:docs/adr/**",
    "fs:write:@stack:sources", "fs:write:@stack:unitTests", "fs:write:@stack:acceptanceTests",
    "shell:test", "git:commit", "git:branch", "git:revert",
    "copilot:sessions",
    "net:none"
  ],
  "contributes": {
    "commands": [
      { "name": "skraft", "title": "Livrer une story avec skraft", "handler": "startPipeline" },
      { "name": "skraft-status", "title": "État du pipeline skraft", "handler": "status" }
    ],
    "agents": [
      { "name": "skraft-classifier",       "role": "roles/classifier.md",       "tools": ["submit_difficulty"],                    "write": [] },
      { "name": "skraft-researcher",       "role": "roles/researcher.md",       "tools": ["load_skill", "report_phase", "report_blocker"], "write": [".skraft/*/research/**"] },
      { "name": "skraft-architect-model",  "role": "roles/architect-model.md",  "tools": ["load_skill", "report_phase", "report_blocker"], "write": [".skraft/*/design/**"] },
      { "name": "skraft-architect-decide", "role": "roles/architect-decide.md", "tools": ["render_adr", "load_skill", "report_phase", "report_blocker"], "write": [".skraft/*/design/**"] },
      { "name": "skraft-acceptance",       "role": "roles/acceptance.md",       "tools": ["run_tests", "load_skill", "report_phase", "report_blocker"], "write": [".skraft/*/distill/**", "@stack:acceptanceTests"] },
      { "name": "skraft-test",             "role": "roles/test.md",             "tools": ["run_tests", "load_skill", "report_phase", "report_blocker"], "write": ["@stack:unitTests"] },
      { "name": "skraft-dev",              "role": "roles/dev.md",              "tools": ["run_tests", "load_skill", "report_phase", "report_blocker"], "write": ["@stack:sources"] }
    ],
    "skills": [
      { "name": "architecture-patterns", "path": "skills/architecture-patterns", "mandatoryFor": ["skraft-architect-model"] },
      { "name": "architecture-decisions", "path": "skills/architecture-decisions", "mandatoryFor": ["skraft-architect-decide"] }
      // … table complète en section 6.4
    ],
    "tools": [
      { "name": "submit_difficulty", "handler": "submitDifficulty", "terminal": true },
      { "name": "render_adr", "handler": "renderAdr" },
      { "name": "submit_lens_verdict", "handler": "submitLensVerdict", "terminal": true }
    ],
    "tasks": [{
      "name": "skraft-pipeline",
      "handler": "skraftTask",
      "states": {
        "CLASSIFY": "Évaluation de la difficulté",
        "RESEARCH": "Enquête sur le code existant",
        "DESIGN": "Conception et décisions d'architecture",
        "RATIFICATION": "Décisions d'architecture à valider",
        "DISTILL": "Écriture des scénarios et des tests d'acceptance",
        "DELIVER": "Implémentation en TDD",
        "REVIEW": "Revue"
      },
      "milestones": ["PHASE_APPROVED", "RATIFICATION_REQUIRED", "SCENARIO_DONE", "DONE"],
      "alerts": ["GATE_FAIL", "RETRY", "TIMEOUT", "BLOCKED", "ESCALATED"]
    }]
  }
}
```

Les motifs `@stack:*` sont résolus depuis la section `paths` du profil de stack au moment de l'ouverture de session (`SPEC.md` 8.3). Ce mécanisme est à ajouter au schéma de manifeste du cœur (`SPEC.md` 5.1).

---

## 11. Interactions et progression

| Demande d'interaction | Déclencheur | Profil autorisé | Options |
| --- | --- | --- | --- |
| Confirmer la difficulté | CLASSIFY (mode simple) | tout profil | niveau proposé, un cran au-dessus, un cran au-dessous |
| Répondre à une question ouverte | Fin de RESEARCH | PO / BA, développeur | texte libre, « reporter » |
| Ratifier un ADR | RATIFICATION | architecte | `accept`, `reject`, `amend` + texte |
| Débloquer un agent | `report_blocker` | selon la nature (métier : PO / BA ; technique : développeur) | choix proposés par l'agent + texte libre |
| Décider après escalade | ESCALATED | développeur | `retry`, `skip`, `abort` |

Carte de tâche : `US-12 — Plafonner le bolus` · phase · étape (`Scénario 2 sur 3 : écriture du code`) · progression · durée · usage.

Jalons : phase approuvée, ADR à ratifier, scénario terminé, pipeline terminé. Alertes : porte rejetée (avec motif), réessai n sur m, délai dépassé, blocage, escalade.

Bilan final (carte + résumé injecté dans la session principale) : phases exécutées et sautées, difficulté, ADR ratifiés, scénarios livrés, commits, résultats de tests et de mutation, défauts de revue corrigés, usage par phase.

---

## 12. Usage

Leviers propres à skraft, en plus de ceux de SPEC.md section 14 :
- plus d'orchestrateur LLM (2 750 mots de prompt et l'accumulation de tous les comptes rendus disparaissent) ;
- skills d'exécution de portes retirées des contextes (environ 4 500 mots en moins par session DELIVER) ;
- lentille `quality-gates` supprimée : une session de moins par revue ;
- architecte découpé en deux sessions plus courtes ;
- escalade immédiate des défauts d'environnement (exemple typique : outil de mutation absent pour la stack).

Mesurer par état : tokens, requêtes, réessais. Objectif de S6 : comparer le pipeline sur US-12 et deux autres stories réelles.

---

## 13. Tests

### 13.1 Unitaires (sans LLM, sans disque)

- Réducteur : chaque ligne du tableau 5.2 et chaque invariant de 5.3.
- Grille de difficulté : cas tabulés, dont US-12 → `medium-hard`.
- Synthèse de revue : cas tabulés de 9.3.
- Extraction des littéraux d'une story (6.1), normalisation des nombres.
- Parsing des citations (7.1) et des identifiants `PascalCase` (7.2).

### 13.2 Portes (avec fixtures de fichiers)

| Fixture | Porte | Attendu |
| --- | --- | --- |
| `research.md` citant `BolusCalculator.swift:40-72`, fichier de 55 lignes | citations | Rejet, motif mentionnant la longueur réelle |
| `contracts.md` citant `BolusLimited`, modèle avec `BolusCapped` | cohérence | Rejet nommant les deux fichiers |
| ADR existant modifié | cohérence | Rejet |
| `.feature` avec « 12 U » au lieu de « 12,5 U » | valeurs | Rejet nommant le critère 2 |
| Test d'acceptance déjà vert sans justification | RED d'acceptance | Rejet |
| Test d'acceptance modifié en DELIVER | empreinte | Rollback et réessai |

### 13.3 Bout en bout

Projet de démonstration minimal (un module domain avec `BolusCalculator`, un module de réglages), sur une pile TypeScript simulée depuis le retrait de Swift (ADR 0061), story US-12, agents rejoués depuis des réponses enregistrées (faux `AgentRuntime` scripté) pour la CI ; un run réel manuel par jalon.

Déroulé attendu : difficulté `medium-hard` confirmée → RESEARCH avec un rejet de citation puis question « par prise ou par jour » → DESIGN avec un rejet de cohérence puis ratification d'un ADR → DISTILL avec un rejet de valeur puis scénario 3 requalifié → DELIVER des scénarios 1 et 2, une tentative de modification de test refusée → revue avec un défaut `major` corrigé → DONE avec bilan.

---

## 14. Jalons

| Jalon | Contenu | Critères de sortie |
| --- | --- | --- |
| **S0** | Décision de licence (SPEC.md O9) ; prompts de substitution si la reprise est refusée | Décision consignée en ADR |
| **S1** | Types `SkraftState`, réducteur complet, invariants, grille de difficulté, lecture de la story, INIT / CLASSIFY / ROUTE / COMMIT, agents simulés | Tous les tests 13.1 verts ; pipeline complet à vide avec agents simulés ; les quatre phases toujours enchaînées ; reprise après redémarrage à chaque stage |
| **S2** | RESEARCH : présélection, rôle `skraft-researcher`, porte citations, questions ouvertes | Fixture citations rejetée ; question posée et réponse présente dans le dossier de passation de DESIGN |
| **S3** | DESIGN : deux rôles, `render_adr`, porte cohérence, revue DESIGN, état RATIFICATION | Fixture cohérence rejetée ; DISTILL inatteignable avant ratification ; `amend` relance le bon rôle |
| **S4** | DISTILL : rôle `skraft-acceptance`, porte valeurs, porte RED d'acceptance, gel des tests d'acceptance | Fixtures valeurs et RED traitées ; empreinte enregistrée |
| **S5** | DELIVER : sous-machine, deux granularités, porte de fin de scénario, preuves via `run_tests` | US-12 livrée sur le projet de démonstration ; modification de test refusée puis détectée par empreinte ; même pipeline sur un projet TypeScript sans modifier l'extension, seulement son profil |
| **S6** | Revue : faits, trois lentilles, synthèse par le code, rapports générés ; mesures d'usage | Verdict reproductible depuis les mêmes JSON ; bout en bout 13.3 vert ; mesures sur trois stories |

### État au 2026-10-11

Swift est retiré (ADR 0061). Les critères de S5 (« US-12 livrée ») et de S6 (« bout en bout 13.3
vert ») tenaient à des tests sur une vraie chaîne Swift : ils ne sont plus couverts que par la pile
simulée. Un bout en bout sur une vraie chaîne (TypeScript ou .NET) est à écrire.

### État au 2026-09-24

S0 à S6 sont livrés (bilans dans `docs/jalons/`), avec deux réserves.

- **S5, critère « même pipeline sur un projet TypeScript »** : non couvert. Le pipeline n'a tourné
  que sur le projet Swift de démonstration. La formulation renvoie d'ailleurs à un « profil » de
  stack, notion qui n'existe pas encore (voir l'état des jalons de `SPEC.md` §15).
- **S6, mesures sur trois stories** : le mécanisme est vérifié, mais les mesures proviennent
  d'agents simulés. Le run réel contre Copilot reste à faire ; il n'est plus bloqué.

**S0 est tranché** (ADR 0012, option C : l'auteur autorise la reprise). La reprise n'a pas
commencé : la trace écrite de l'autorisation, la licence de redistribution et l'accès au dépôt
source restent à réunir. Les prompts de substitution sont donc toujours en place, et leur qualité
demeure l'inconnue à surveiller lors des runs réels.

**Distribution** : depuis l'ADR 0021, `skraft` n'est plus livrée avec l'application. Elle se
construit en paquet `.asx` (`pnpm ext:build` puis `pnpm ext:pack`) et s'installe depuis un
fichier. Non signée pour l'instant, elle exige le mode développeur.

---

## 15. Questions ouvertes propres à skraft

| # | Question | Hypothèse provisoire |
| --- | --- | --- |
| S-O1 | Racine des artefacts : `.skraft/<slug>/` ou `.copilot-tracking/skraft-plans/<slug>/` (compatibilité avec skraft-plugin) ? | `.skraft/<slug>/` |
| S-O2 | Revue par scénario en DELIVER pour `challenging` ? | Oui, avec `cold-reader` et `test-integrity` seulement |
| S-O3 | Brancher Backlog Planner en amont du pipeline (story générée depuis une issue GitHub) ? | Plus tard, après S6 |
| S-O4 | Seuils de mutation configurables par module ou globalement ? | Par couche (domaine, application, API, infrastructure) |
| S-O5 | Faut-il proposer à l'auteur de skraft-plugin les corrections des défauts C1 à C7, N1 et N2 ? | Oui, via le document d'analyse, qui couvre aussi la branche 1.6.0 |
| S-O6 | Autoriser la recherche web pour `skraft-researcher` ? | Oui, via une permission `net:` dédiée, désactivée par défaut |
| S-O7 | Garder une évaluation de difficulté, alors que skraft 1.6.0 l'a supprimée ? | Oui pour régler les moyens, à confirmer par les mesures d'usage de S6 |
| S-O8 | Suivre le plan de refonte de skraft (JSON Schemas d'état et de projection, commandes typées) pour aligner nos schémas ? | Oui, à réévaluer à chaque livraison de la branche |
