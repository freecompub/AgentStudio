# skraft-plugin v2 : évolution des agents, des skills, des lentilles et de la revue

- Date : 2026-11-05, branche `feat/mcp-skraft`.
- Statut : **analyse**. Rien n'est repris ni décidé ici ; le §9 propose des suites.
- Source : `github.com/SebastienDegodez/skraft-plugin`, branche `integration/v2-next`, commit
  `0425f031` (`chore(release): 2.0.0-alpha.63`), comparé au tag `v1.15.1` (`1e41a98`) — 243 commits,
  2 258 fichiers, du 2026-10-11 au 2026-11-05. Lu en lecture seule (`git show`, `git grep`).
  Chemins relatifs à `plugins/skraft-framework/` sauf mention contraire.
- Comparé à AgentStudio : `workflows/skraft/` (workflow) et `extensions/skraft/` (extension), qui
  partagent les mêmes agents et skills (`docs/15` §1).
- **Licence et autorisation** : l'autorisation de reprise (`docs/licences/autorisation-skraft.md`)
  couvre les versions **antérieures à v2.0.0**. La v2 est analysée ici ; en reprendre un élément
  (prompt, skill, code) demande que l'autorisation soit étendue et consignée. Le responsable du
  projet est contributeur de skraft-plugin depuis le 2026-11-05 : les propositions du §9.3 peuvent
  aller en amont.

---

## 1. En une page

La v2 n'est pas une mise à jour des prompts : **c'est un changement d'architecture**, dans la
direction qu'AgentStudio a prise dès le départ (« le LLM propose, le code décide »).

| | v1.15.1 | v2 (alpha.63) |
|---|---|---|
| Qui conduit le pipeline | Un **prompt** (`skraft-orchestrator`, 359 lignes) qui appelle des CLI (`src/cli/state.mjs`…) | Un **moteur** JavaScript (`engine/`, hexagonal, 262 fichiers) qui parcourt un **graphe DOT** (`workflows/pipeline.skraft.dot`) |
| État du run | `state.json` mutable, écrit par le LLM via la CLI | `events.jsonl` : journal d'événements **chaîné (SHA-256) et signé (HMAC)**, état dérivé |
| Revue | 3 agents `*-reviewer` qui lancent les lentilles et **calculent le verdict** dans leur prompt | Fan-out de lentilles **en code**, chaque finding vérifié par un **`finding-refuter`**, verdict **calculé** (`engine/domain/review/verdict.mjs`) |
| Portes (gates) | Lancées par l'agent, qui écrit un journal de preuves ; `qg-verify` vérifie ce journal après coup | Le moteur **exécute** les commandes de `skraft-config.json` (`build, format, lint, test, architecture, coverage`), puis la mutation |
| TDD | Convention de commits vérifiée | Convention vérifiée **et chaque commit rouge rejoué** dans un worktree jetable |
| Agents | Longs, procéduraux, avec relecteurs et workers | Courts (−60 %), exécutants d'un **brief** composé par le moteur, sortie `{status, summary}` |
| Skills | Procédures, scripts de preuve, seuils | Règles de jugement et recettes par stack ; « the engine already checks… » |
| Hôtes | Prompts pour Copilot et Claude Code | **Un pilote par hôte** : mod Claude Code, workflow dynamique Copilot CLI, SDK VS Code, boucle CLI |

Ce que la v2 a et qu'AgentStudio n'a pas : un **réfutateur** de findings, une **re-revue
incrémentale** en code, un **rejeu réel des commits rouges**, un **journal signé**, des workflows
**personnalisables mais verrouillés**, des **paliers de modèle** par rôle, la **publication** (PR,
captures). Ce qu'AgentStudio a et que la v2 n'a pas (au commit lu) : le **gel des tests
d'acceptance par empreinte**, une **porte de cohérence** et une matrice **calculées par le code**,
la **couverture du diff** avec seuil, un **arbitre de mutants** borné, des **gardes d'écriture
au niveau de l'outil** (avant l'écriture, pas après), et l'**isolation** du script.

---

## 2. Architecture d'exécution (cadre des §3 à §6)

### 2.1 Moteur

`engine/` (paquet `skraft-engine` 2.0.0-alpha.63, Node ≥ 22, ESM typé JSDoc, testé par mutation) :

| Couche | Règle | Contenu principal |
|---|---|---|
| `domain/` | Règles pures, aucun import `node:` (le code tourne aussi dans le mod Claude Code, sans Node) | `workflow/` (lecture DOT, validation, nœuds obligatoires), `pipeline/` (`next-step`, `roles`, `commits`, `dispatch-brief`), `review/` (lentilles, réponses, verdict), `gates/` (`gate-plan`, `mutation-bar`), `journal/` (`run-state`, `hash-chain`, `signature`), `decisions/` (ADR, questions) |
| `application/` | Cas d'usage, I/O par 29 ports | `run-pipeline-usecase.mjs` (cœur), `step-checks.mjs`, `review-runs.mjs`, `gate-runs.mjs`, `adr-checks.mjs` |
| `infrastructure/` | Adaptateurs | suivi (`.copilot-tracking/skraft-plans/<slug>/`), clés du journal (`~/.skraft/`), forges `gh` et `az`, rejeu des commits |
| `drivers/` | Un dossier par hôte | `claude-mod/`, `copilot-workflow/`, `copilot-sdk/`, `cli/` |

`nextStep` (`domain/pipeline/next-step.mjs`) est une **fonction pure** : reprendre une tentative
ouverte, appliquer une décision humaine, sinon commencer, réessayer ou avancer. Un réessai bloque
dans trois cas : l'agent a rendu `blocked`, deux échecs identiques de suite (`breaker`), ou
`max_attempts` atteint (3 par défaut). Une arête prise `max_visits` fois (`loop-ceiling`) pose une
question à l'humain.

### 2.2 Workflows DOT

Le moteur lit un sous-ensemble de Graphviz ; **la forme d'un nœud donne son type** :

| Forme | Type | Exemple |
|---|---|---|
| `box` | agent | `design [agent="solution-architect"]` |
| `parallelogram` | porte ou publication | `gates [gate="build,format,lint,test,architecture,coverage", goal_gate=true, locked=true]` |
| `component` / `note` / `octagon` / `tripleoctagon` | fan-out / lentille / réfutateur / fan-in (verdict) | `design_review_refuter [shape=octagon, mandatory=true]` |
| `hexagon` | question humaine | `adr [question="adr-ratification"]` |
| `house` | appel d'un autre workflow | `deliver_review [workflow="review", mandatory=true]` |

Validé avant tout run (`domain/workflow/workflow.mjs`) : une seule entrée, aucun nœud inaccessible,
**toute boucle sans `max_visits` refusée**, pas de retour à une phase antérieure. Une équipe peut
« éjecter » le workflow (`skraft workflow eject` → `.skraft/pipeline.skraft.dot`) et le modifier,
mais **un nœud `mandatory=true` du plugin ne peut être ni retiré ni contourné**, et un nœud
`locked=true` (les portes) ne se retire qu'avec `unlock="<raison>"` (`mandatory.mjs`,
`checkLocks`).

Le pipeline (`workflows/pipeline.skraft.dot`), en résumé :

```
consentements → research → design → revue DESIGN (max 3) → adr (humain : RATIFIED | REJECTED, max 1)
→ distill → revue DISTILL (max 3) → deliver → gates (FAIL → deliver, max 3)
→ revue DELIVER (workflow review, max 3) → mutation (FAIL → proposition par fichier survivant
→ plan humain APPLY | STOP → kill_mutants → revue mutation → gates, max 3/5) → visuals → pr_writer → publish
```

Comparaison avec AgentStudio : notre workflow est un **script** rejouable (`workflows/skraft/
workflow.mjs`, ADR 0052–0055), la v2 un **graphe interprété**. Les deux journalisent chaque appel et
reprennent par rejeu. Le graphe est plus facile à personnaliser et à vérifier statiquement (boucles
bornées, nœuds obligatoires) ; le script exprime plus directement des portes riches (cohérence,
plan de test, arbitrages). La différence de fond est ailleurs : **chez nous, le script tourne
isolé** (processus sous `--permission`, ADR 0055) et les écritures des agents sont **gardées avant
d'avoir lieu** (`onPreToolUse`) ; en v2, le périmètre d'écriture est **contrôlé après coup**
(`step-checks.mjs`, `scopeFailures` : un fichier hors périmètre ou non commité fait refuser
l'étape).

---

## 3. Agents

### 3.1 Inventaire

| v1.15.1 (framework) | v2 | Commit |
|---|---|---|
| `skraft-orchestrator` | **Lanceur** : « The skraft engine runs the pipeline and decides every step » (359 → 58 lignes) | 1e995b63 |
| `solution-researcher` | Conservé, réécrit (105 → 38 lignes) | 070a5dab, fb2aa8c9 |
| `solution-architect` | Conservé, réécrit (500 → 116 lignes) | 070a5dab, a213fdae, 3449dfff |
| `acceptance-designer` | Conservé, réécrit (226 → 117 lignes) | 070a5dab, dc6634e1 |
| `software-engineer` | Conservé, réécrit (241 → 93 lignes) | 070a5dab, a3a7ea65 |
| `solution-architect-reviewer`, `acceptance-designer-reviewer`, `software-engineer-reviewer` | **Supprimés** : la revue est un nœud du moteur (§5) | 45aa007c |
| `contract-testing-worker`, `mock-integration-worker` | **Supprimés** : absorbés par `software-engineer`, guidé par le brief (`mocking:`, `contract testing: on`) et les skills | 070a5dab |
| `brownfield-*`, `refactoring-worker` | **Déplacés** dans le plugin autonome `skraft-brownfield` | ca8930f1 |
| — | **`pr-writer`** (prose de la PR ; le moteur rend le reste depuis le journal) | cf00fd9c |
| — | **`finding-refuter`** (§5.3) | 45aa007c |
| `quality-gates-lens` | **Supprimée** : les portes sont exécutées par le moteur | 45aa007c |

Plugin `skraft-backlog` : `backlog-slicer` et `story-writer` ajoutés (3d749d22), Azure Boards
(23a7872d). Les arbres Copilot et Claude Code sont synchronisés par script (`.agent-sync.json`).

### 3.2 Contrat commun (nouveau)

- **Entrée : un brief composé par le moteur** (`engine/domain/pipeline/dispatch-brief.mjs`,
  `composeBrief`, « the same on every host ») : entrées et sorties en chemins absolus, fichier
  résultat, chemins autorisés, commandes de portes à lancer avant de rendre la main, retour du
  rejet, instruction humaine, commits rouges d'acceptance, mutants, ADR brouillons, checklists.
- **Sortie** : `{"status": "done" | "blocked", "summary": "…"}`, toute autre clé refusée
  (`agent-result.mjs`).
- **Rôles** (`roles.mjs`) : sorties, chemins d'écriture, mode TDD (`red`, `cycle`), droit au shell.
  Le moteur commite pour les agents sans shell (chercheur, architecte, pr-writer).
- **Modèles** : les descripteurs Copilot **ne nomment plus de modèle** ; la configuration choisit
  une famille par rôle (`model-assignment.mjs` : chercheur `researcher`, architecte `planner`,
  pr-writer `economy`, lentilles `reviewer`, défaut `implementer`).
- **Plus aucun `$SKRAFT_PLUGIN_ROOT` ni heredoc** dans un agent (070a5dab).

AgentStudio a déjà ce contrat sous une autre forme : dossier de passation construit par le code,
outils terminaux à schéma (`report_phase`, `submit_lens_verdict`…), classes de modèle par rôle
(ADR 0048), contenu partagé sans nom d'outil (ADR 0024). La v2 converge vers ce modèle.

### 3.3 Agent par agent

| Agent | v2 : ce qui change | En face, dans AgentStudio |
|---|---|---|
| **Chercheur** | Remplit un document **pré-créé** depuis un gabarit (`assets/templates/research.template.md`) ; lit d'abord `docs/adr/decisions-index.md`, `docs/architecture/`, `docs/domain/event-model/`, `docs/features/` (une question couverte par `docs/` est « settled ») ; section **« Existing tests »** ; palier `economy` (haiku). Le moteur vérifie les citations et plages (`research-records`, #517) | `skraft-researcher` ; porte de citations en code (`porteCitations`, 8 sections, « Existant réutilisable » vérifié). Pas de lecture préalable de `docs/`, pas de section « tests existants » |
| **Architecte** | Les documents durables vont **sous `docs/`** (event model, context map, design tactique, ADR) ; seuls contrats et plan de remplacement restent dans le dossier daté (82d0920b). Plus de rendu d'ADR par CLI ni de fichiers de blocage : un conflit rend `blocked` avec une question à choix A/B/C, le moteur interroge l'humain (a213fdae). Ligne `docs-relied-on`, matrice terminée par `consistency-gate: PASS|FAIL`. Règle Object Calisthenics sur les contrats | Deux agents (`architect-model`, `architect-decide`) ; tout reste dans `.skraft/<slug>/` sauf les ADR ; la **matrice est écrite par le code** (G10), pas déclarée par l'agent |
| **Acceptance** | Le `.feature` va dans `docs/features/{bc}/{feature}.feature` ; auto-contrôle avec `acceptance-review-criteria` (G1–G11, B1, T1–T3, E1–E2) ; lignes `existing` prouvées (test lancé) ; le moteur refuse un commit de test DISTILL dont les tests passent | `skraft-acceptance` ; `checkAcceptanceRed`, matrice du plan de test, walking skeleton, **gel par empreinte** au commit de DISTILL |
| **Ingénieur** | Boucle interne du TDD ; plus d'outil `agent` (ne lance plus de workers) ; mocks et contrats selon le brief ; lance build, format, lint, test avant de rendre la main ; deux modes pour les mutants (proposer `test:` / `delete:` / `equivalent:`, puis appliquer le choix humain) ; jamais `Closes #N` | Deux agents (`skraft-test`, `skraft-dev`) séparés par des **portes RED/GREEN** et des gels d'empreinte ; arbitre de mutants (ADR 0065) |
| **pr-writer** | Prose de PR dans 4 sections fixes, langue de la story ; « never a figure, a test result, a gate, a reviewer » : les chiffres viennent du journal | Pas d'équivalent (pas de publication) |
| **Orchestrateur** | Lanceur : relaie ; interdit de lancer une porte ou `skraft decide` | Pas d'agent : le code orchestre |

---

## 4. Skills

Volume : 194 fichiers, **+3 042 / −13 620 lignes** ; `scripts/` passe de 110 à 45 fichiers.

### 4.1 Supprimés ou déplacés

| Skill v1 | Devenu en v2 |
|---|---|
| `adr-eligibility-gate` | Fusionné dans `architecture-decisions` (« Eligibility Gate », Q1–Q5) ; contrôles mécaniques dans `adr-checks.mjs` et `adr-content.mjs` (pas de version, une décision d'une phrase, statut d'un ensemble fermé) |
| `quality-gates-evidence-contract` (et `qg-verify`, `capture`, `snapshot`) | Retirés : le moteur exécute les portes et garde les preuves ; commits et rejeu RED dans `commits.mjs` |
| `mutation-testing` | Fusionné dans `quality-gates-<stack>` (« Read the survivors ») ; score jugé par `mutation-bar.mjs` |
| `resolving-stack-commands` | Retiré : commandes = **données** (`components[].commands` de `skraft-config.json`), valeurs proposées par `stack-detection.mjs` |
| `contract-testing-roster` | Fusionné dans `contract-testing` ; activé par `contractTesting: true` dans la configuration |
| `github-publication` | Renommé `github-forge-writes` : liste **fermée** d'écritures (commenter, mettre à jour son commentaire, label) ; publication par le moteur |
| `characterize-*`, `mikado-method`, `strangler-fig-method`, `compose-brownfield-prd` | Plugin `skraft-brownfield` |

### 4.2 Ajoutés

`clean-architecture-typescript` (0b23e75d), **`prune-tests`** (élagage des tests redondants par
matrice de kill, approbation test par test, `disable-model-invocation: true`, dc6634e1),
`github-forge-writes`, `azure-devops-forge-writes`, et pour le backlog `azure-boards-work-items`,
`backlog-slicing`, `story-elaboration`.

### 4.3 Conservés : ce qui change

| Skill | Lignes du SKILL.md | Changement notable |
|---|---|---|
| `architecture-review-criteria` | 132 → 68 (−969 au total) | `gate-definitions.md` et `verdict-rubric.md` supprimés ; `gate-checks.md` (un cas qui échoue, un qui passe, par porte G1–G18, C1, F1) ; section **« Not yours to report — the engine already checks »** |
| `acceptance-review-criteria` | 154 → 176 | Portes **B1, T1–T3, E1–E2** ; délégations au moteur (T3, G11 par `testability#layout`) |
| `architecture-decisions` | 305 → 349 | Absorbe l'éligibilité ; `Rejected` terminal ; amendement par nouvel ADR ; `Proposed` réécrit sur place tant qu'il n'est pas sur la branche par défaut |
| `architecture-patterns` | 481 → 138 | Fortement réduite ; `cqrs.md` ajouté |
| `outside-in-tdd` | 418 → 182 | **Liste de tests ordonnée (TPP + FLFI)** ; « the recorded red commit is the inspection » |
| `craft-discipline` | 124 → 127 | **C12 — Every test is planned** (`PLAN_DEVIATION:`) ; `Refs: #N`, jamais fermer une issue |
| `quality-gates-*` | 252 → 100 (dotnet) | Trois parties : lignes de commande à mettre dans la configuration, configuration de la mutation, lecture des survivants |
| `skraft-quality-bar` | 84 → 78 | Seuils **inchangés** et non configurables : mutation 100 % (Domain, Application), 80 % (API, Infrastructure), couverture 100 % (Domain, Application) |
| `qa-reporting` | (−1 170) | Machine à états supprimée ; reste le rendu |
| `adversarial-review-lenses` | 118 → 118 | Décrit encore la synthèse pondérée, mais « the engine runs each review node's lenses instead and computes the verdict » |
| `test-design-mandates`, `test-refactoring-catalog`, `clean-architecture-react` | inchangés | — |

**Structure.** Frontmatter inchangé (`name`, `description`) ; descriptions orientées déclencheur
(« Not for… ») ; scripts plats exécutés par `node` sans shell ; aucun `state.mjs` ;
`skraft-config.json` cité dans 19 fichiers. Garde-fous nouveaux : tests de parité entre la barre de
qualité et les scripts, évaluations par skill.

**Fil directeur** (inférence de l'analyse) : réduire le contexte, et **ne plus croire l'agent sur
parole** — chaque contrôle décrit en prose en v1 est réimplémenté dans `engine/`, et la skill dit
« the engine already checks… do not report ». C'est la règle qu'AgentStudio applique depuis S1
(procédure déplacée dans le code, `docs/15` §3).

Côté AgentStudio, les skills livrés viennent de v1.6.1 et v1.15.1 (`docs/licences/
autorisation-skraft.md`). Ils contiennent encore de la procédure que nos portes font déjà, sans la
mention « le code le vérifie déjà » : c'est une source de findings en double (une lentille qui
reproche ce qu'une porte a déjà jugé).

---

## 5. Lentilles et revue

### 5.1 Lentilles

| Lentille v2 | Phase | Contrôle | Portes (gravité) |
|---|---|---|---|
| `consistency` | DESIGN | Cohérence ADR, context map, contrats, diagrammes, recherche, story | G1, G2, G10, G12, G14 (blocker) ; C1 (high) |
| `architecture-compliance` | DESIGN | Clean Architecture et DDD dans ce que DESIGN a écrit | G3, G4 (blocker) ; G5, G6, G16 (high) |
| `fitness` | DESIGN | Le design répond à la story, rien de spéculatif, ADR éligibles | G7, G8, G11, G15, G17, F1 (high) ; G9, G18 (medium) |
| `coverage` | DISTILL | Bijection critères ↔ scénarios, cas limites | G1 (blocker) ; G2 (high) |
| `business-alignment` | DISTILL | Vocabulaire métier, périmètre | G4 (blocker) ; G3, B1 (high) |
| `testability` | DISTILL | Steps non ambigus, plan d'implémentation, acceptance rouge « pour la raison métier » | G11, T2, T3 (blocker) ; G5, G6, T1 (high) |
| `boundary-enforcement` | DISTILL | L'acceptance entre par le use case, doublures en bordure | G7, E1 (blocker) ; G8, E2 (high) |
| `test-integrity` | DELIVER, mutation | Test theater (G7), Iron Rule (G9), test hors plan sans `PLAN_DEVIATION` | G7, G9 (blocker) |
| `architecture-boundaries` | DELIVER | Pas de doublure sur Domain/Application, sens des dépendances, Object Calisthenics ; saute G5 si la porte `architecture` a passé | G4, G5 (blocker) ; G10 (medium) |
| `cold-reader` | DELIVER | Langage métier, sans contexte (`blind`) ; jamais au-dessus de `medium` | G11 (medium) |
| `mock-fidelity` | DELIVER si le patch touche des mocks | Stratégie de mocking, pas d'appel réel | M2, M3 (blocker) ; M1, M4 (high) |
| `contract-fidelity` | DELIVER si le patch touche des contrats | Tests de contrat côté fournisseur | K1, K3, K5 (blocker) ; K2, K4 (high) |

Changements de fond : les sept lentilles de DESIGN et DISTILL étaient des **sections internes**
des relecteurs (évaluées dans le même contexte) ; elles deviennent des **agents séparés**. La
lentille `quality-gates` disparaît (le moteur exécute les portes). Palier par défaut `economy`.

Face à AgentStudio : nous avons **4 lentilles généralistes** (`cold-reader`, `test-integrity`,
`architecture`, `quality-gates`) aux trois phases, avec des « points à examiner » par phase
(`CONSIGNES_DE_PHASE`, portes G de jugement) ; le plugin a **11 lentilles spécialisées par phase**
(plus 2 conditionnelles). Notre `quality-gates`, qui confronte les livrables aux faits mesurés,
n'a plus d'équivalent en v2.

### 5.2 Contrat de sortie d'une lentille

YAML (`lens`, `verdict` ∈ `pass | fail | inconclusive`, `findings`), validé par le moteur
(`engine/domain/review/answers.mjs`) :

- finding : `id`, `gate`, `severity` (`blocker | high | medium | low`), `location` (`path:line`),
  `description`, `suggestion` ; **obligatoires depuis #499** : `severityReason`, `drift`
  (`label | classification | structural`), `occurrences` (liste de `path:line`) ;
- au plus 20 findings ; `pass` avec un finding blocker, high ou medium est refusé ; `inconclusive`
  seulement si une entrée est illisible ;
- une réponse illisible est redemandée **une fois**, avec la raison ; deux fois → run arrêté
  (`lens-unreadable`).

AgentStudio : `submit_lens_verdict` à schéma (APPROVED / CHANGES_REQUESTED / REJECTED, gravités
blocker / major / minor), identifiants et cibles fixés par le code, plafond de `cold-reader` appliqué
par le code. Nous n'exigeons ni `severityReason`, ni `drift`, ni `occurrences`.

### 5.3 Le réfutateur (`finding-refuter`, nouveau)

- **Chaque finding, quelle que soit sa gravité**, est soumis au réfutateur avant le verdict
  (`review-runs.mjs`, `refutations`) : `confirmed`, `refuted` (doit citer un `path:line` lu) ou
  `unverifiable` (une règle introuvable dans les entrées n'est jamais `refuted`).
- Un correctif qui ajouterait un fait absent des entrées (devise, unité) fait réfuter le finding.
- Les findings de lentilles différentes sur la même ligne et la même gravité sont groupés en un
  appel, jugés un par un.
- **Modèle un palier au-dessus de la plus forte lentille concernée** (`escalatedTier`), plafonné à
  `frontier`.
- **Dissent Rule en code** (`dissentOf`) : quand une seule lentille trouve un défaut et que les
  autres passent, le réfutateur reçoit toutes les entrées de la revue et juge « as the reviewer ».
- Un finding `unverifiable` **compte**, avec la mention « (not verified) ».

Il n'y a rien d'équivalent dans AgentStudio : un défaut est jugé par **le producteur** (`fixed`,
`contested`, `outOfScope`), puis **la lentille** arbitre la contestation (`rulings`), puis
**l'humain** (ARBITRATION). Le réfutateur filtre les faux positifs **avant** qu'ils coûtent une
correction ; notre fil de défauts les traite **après**, au prix d'un tour du producteur.

### 5.4 Verdict, rondes, escalade

Verdict **calculé** (`engine/domain/review/verdict.mjs`) :

| Condition | Statut |
|---|---|
| Une lentille a répondu `inconclusive` | `BLOCKED` (`lens-inconclusive`) : rien n'est renvoyé au producteur, un humain est interrogé |
| Un finding non réfuté, **de n'importe quelle gravité**, qui n'est pas une note | `NEEDS_REWORK` |
| Sinon | `APPROVED` |

- **Notes** : un finding nouveau sur une ligne que l'agent n'a pas touchée devient une note, qui ne
  renvoie jamais le travail (`review-repeats.mjs`).
- **Re-revue incrémentale** : une lentille dont l'empreinte des entrées n'a pas changé et qui avait
  passé sans finding n'est pas relancée (`keepLenses`) ; un finding au même endroit qu'un finding
  réfuté est reporté réfuté sans rappeler le réfutateur (`carried`).
- **Plafond** : `max_visits=3` sur chaque arête `NEEDS_REWORK` ; au plafond, s'il ne reste que des
  findings medium ou low, question `review-ceiling` (ACCEPT — les findings acceptés figurent dans le
  rapport et la PR —, instruction, STOP) ; s'il reste un blocker ou un high, question `blocked`
  (instruction ou STOP seulement).
- Plus de `REJECTED`, plus de synthèse pondérée (completeness, business fit, quality, risk) dans le
  moteur — la skill la décrit encore.
- Aucun budget de coût bloquant : le coût est seulement journalisé (`review.cost`).

**Incohérence relevée en amont.** Le message du commit 27c2e656 (#503) dit « low findings ride along
on a pass » ; le code de `verdict.mjs` (l. 8-14) et le brief des lentilles disent l'inverse (« a pass
with low findings is no approval »). Le code fait foi ; le message de commit est en décalage.

Face à AgentStudio :

| Point | AgentStudio | v2 |
|---|---|---|
| Défaut mineur | N'empêche pas l'approbation | Renvoie le travail (sauf note) |
| Rejet net | REJECTED (2 lentilles) → escalade | N'existe plus |
| Lentilles relancées | Toutes, à chaque tour | Seules celles dont les entrées ont changé ou qui avaient un finding |
| Faux positifs | Contestation par le producteur, arbitrage par la lentille puis l'humain | Réfutateur avant le verdict |
| Question d'une lentille | Partie à l'humain, plafond 2 par phase (ADR 0063) | Pas de question : `inconclusive` → BLOCKED |
| Plafond de rondes | `essayer({max})` 2 ou 3, revue garantie à sa première ronde | `max_visits=3` par arête, puis question au plafond |

### 5.5 Portes de revue et portes mécaniques

| Porte v2 | Où | Ce que décide le code |
|---|---|---|
| `build, format, lint, test, architecture, coverage` | nœud `gates` ; `gate-plan.mjs`, `gate-runs.mjs` | Exécute les commandes de la configuration, sur les composants touchés, arrêt au premier échec ; code de sortie 127/9009 → `environment` (question humaine), autre échec → retour à l'agent. **Aucun seuil dans le code** : la couverture et l'architecture valent ce que dit la commande de l'équipe |
| `mutation` | `mutation-bar.mjs`, `mutation-report.mjs` | Score calculé sur les fichiers changés ; **100 % core, 80 % boundary, non configurable** ; « core » = dossier finissant par `domain` ou `application` ; survivants traités par fichier, avec un plan validé par l'humain ; `mutation-stalled` sans progrès |
| TDD | `commits.mjs`, `step-checks.mjs` | `test` = rouge, `feat`/`fix` = vert ; vert sans rouge refusé ; **chaque commit rouge rejoué** et doit échouer pour de vrai ; `Refs: #N` en dernière ligne |
| Scans dans la revue | `patch-scan.mjs`, `test-layout.mjs` | `test-integrity#patch` (skip/focus ajouté, test supprimé, assertions retirées) ; `testability#layout` (placement des tests) |
| DESIGN | `design-records.mjs` | Matrice déclarée `consistency-gate: PASS`, `docs-relied-on`, noms de fichier d'ADR, registre des remplacements |
| ADR | `adr-checks.mjs` | Brouillon réécrit sur place, une décision, aucune version, statut fermé ; ratification **humaine** |
| Périmètre d'écriture | `step-checks.mjs`, `roles.mjs` | Contrôlé **après** l'étape |
| **Gel des tests d'acceptance** | — | **Aucune porte trouvée** au commit lu : protégés par le brief (« stay red until your code passes them ») et par la lentille `test-integrity` ; le rôle `software-engineer` a `tests` dans son périmètre |

Portes d'AgentStudio sans équivalent mécanique en v2 : **gel par empreinte** (acceptance dès DISTILL,
tests unitaires dès leur rouge), **matrice de cohérence calculée** (pas déclarée), couverture
**du diff** avec seuil, **un seul nouveau test par pas rouge**, garde du contrat ratifié (un nom de
`contracts.md` ne disparaît pas du code), écarts au plan vérifiés contre la matrice (ADR 0067),
arbitre de mutants plafonné (ADR 0065), questions ouvertes de la story avant DESIGN.

Portes de la v2 sans équivalent chez nous : **rejeu réel des commits rouges**, format, scans de
patch par le code, publication relue avant d'être tenue pour faite.

---

## 6. Hôtes, état, configuration

- **Hôtes** : Claude Code (mod `hooks/skraft-mod.tsx`, outil `mcp__skraft__run_pipeline`, panneau),
  Copilot CLI (extension, workflow dynamique `skraft-pipeline`, outil `skraft_decide` sans
  argument : « neither the question nor the answer comes from the model »), VS Code (SDK, ou boucle
  `skraft next` / `skraft record`). Pas de pilote Codex.
- **Humain** : seules les provenances `host`, `host-confirmed`, `cli-tty` sont acceptées ;
  `skraft decide` exige un terminal.
- **Un pilote par run** : bail `<slug>/.lock` (TTL 120 s, renouvelé toutes les 30 s).
- **Journal** chaîné et signé ; `skraft journal adopt` pour changer de machine, avec un « oui »
  tapé.
- **Configuration** (`schemas/skraft-config.schema.json`) : composants (racine, stack, chemins,
  commandes), stratégie de mocking, tests de contrat, rapport de mutation, forge, rejeu TDD,
  consentements, **familles de modèles et paliers par hôte**. Ni seuil, ni liste de lentilles : les
  lentilles sont dans le DOT, la barre dans le code.

Rapprochement avec le serveur MCP d'AgentStudio (ADR 0068) : la v2 a fait le même choix (**le
moteur orchestre, l'hôte relaie**) et les mêmes garde-fous — un seul pilote par run (notre verrou
par projet), décision humaine qui ne vient jamais du modèle (notre `skraft_repondre` passe par les
interactions enregistrées, avec le profil d'`admin.json`). Différences : la v2 tourne **dans**
l'hôte (mod, extension Copilot) avec les agents de l'hôte ; notre serveur lance ses propres agents
Copilot, isolés.

---

## 7. Ce que la v2 confirme dans les choix d'AgentStudio

| Choix d'AgentStudio | Confirmation en v2 |
|---|---|
| Le code orchestre et décide (SPEC §0, ADR 0052) | Moteur, `nextStep` pur, verdict calculé |
| Procédure hors des prompts (`docs/15` §3) | Agents −60 %, skills −13 600 lignes, « the engine already checks » |
| Session neuve par rôle, dossier de passation construit par le code (SPEC, « Tours d'agent ») | Brief composé par le moteur, contexte frais par lentille |
| Sortie à schéma (outils terminaux) | Résultat JSON fermé, réponses de lentille validées |
| Classes de modèle par rôle (ADR 0048) | Familles et paliers par rôle, configurés |
| Questions à l'humain enregistrées, jamais bloquantes | Nœuds `hexagon`, `skraft decide`, provenance contrôlée |
| Mutation en fin de story (ADR 0049) | « Mutation runs last, on the code the DELIVER review approved » |
| PLAN_DEVIATION (ADR 0067) | C12 « Every test is planned » |
| Reprise par rejeu d'un journal (ADR 0053) | État dérivé du journal d'événements |

---

## 8. Écarts qui comptent pour AgentStudio

1. **Réfutateur de findings** — le plus net. Il attaque le coût que nos mesures montrent : sur le
   run MCP d'US-2 (`docs/runs/2026-11-05-us-2-mcp/`), 11 des 20 tours d'agent étaient des lentilles.
   Un faux positif nous coûte un tour du producteur plus un arbitrage ; il coûte un appel de
   réfutateur en v2. À mesurer, pas à supposer.
2. **Re-revue incrémentale** (`keepLenses`, `carried`, notes sur ligne inchangée) : c'était déjà
   le point « re-revue sélective » non repris de `docs/15` §5 ; la v2 l'a mis en code.
3. **Défauts mineurs** : la v2 les fait corriger, nous non. Nos corrections ciblées (ADR 0062,
   `minorThreads`) les traitent en fin de DELIVER seulement.
4. **Lentilles spécialisées par phase** (11 + 2) contre nos 4 généralistes : plus de tours par revue,
   mais des critères plus nets et des contextes séparés.
5. **Rejeu réel des commits rouges** : nous vérifions le rouge **au moment** du pas (preuves de
   `run_tests`) ; la v2 le revérifie a posteriori dans un worktree propre. Pour nous, le premier
   suffit tant que les preuves sont produites par notre handler — à garder en tête si une preuve
   devenait déclarative.
6. **Documents durables sous `docs/`** (event model, context map, features) et lecture préalable de
   `docs/` par le chercheur : nos livrables restent dans `.skraft/<slug>/`.
7. **Ce que la v2 n'a pas** : gel des tests d'acceptance, matrice de cohérence calculée, couverture
   du diff, gardes d'écriture avant l'écriture, isolation du script. Ce sont des garanties que nous
   ne devons pas perdre en reprenant des éléments v2.
8. **Désaccords de doctrine à trancher avant toute reprise** : « NEVER ask » (v2 : une lentille ne
   pose pas de question, `inconclusive` bloque) contre nos questions de revue (ADR 0063) ; REJECTED
   supprimé ; seuils de mutation non configurables (nous : `.agent-studio/quality.yaml`, ADR 0049,
   avec dérogations arbitrées, ADR 0065).

---

## 9. Suites proposées

### 9.1 À décider par le responsable du projet

1. **Autorisation** : étendre la reprise à la v2 (`integration/v2-next`) ? Sans extension, seules
   les idées sont réutilisables, réimplémentées sans copie.
2. **Réfutateur** : l'essayer dans le **workflow** (pas l'extension, ADR 0054) derrière une option,
   et le mesurer sur US-2 (tours, requêtes premium lues dans la trace, faux positifs écartés).
3. **Re-revue incrémentale** : la décider maintenant que la v2 en fournit un modèle en code.
4. **Défauts mineurs** : garder « un mineur n'empêche pas l'approbation » ou suivre la v2.
5. **Lentilles par phase** : garder 4 lentilles généralistes ou passer à des lentilles spécialisées.

### 9.2 Sans décision, à faire

- Mettre à jour `docs/portes-comparees-skraft-plugin.md` (périmé depuis `docs/15` §6) avec le §5.5.
- Retirer de nos skills la procédure que nos portes font déjà, en le disant (« le code le vérifie
  déjà »), comme la v2 — à faire dans le respect de la provenance v1.

### 9.3 À proposer en amont (contributions)

- **Gel des tests d'acceptance** par empreinte au commit de DISTILL (aujourd'hui protégés par le
  brief et une lentille seulement).
- **Matrice de cohérence calculée par le code**, au lieu de la ligne `consistency-gate: PASS`
  déclarée par l'architecte.
- **Couverture du diff** avec seuil porté par le moteur (aujourd'hui, ce que dit la commande).
- **Vérification de l'« existant réutilisable »** de la recherche (chaque nom cité présent dans le
  fichier cité).
- **Message du commit 27c2e656** en contradiction avec `verdict.mjs` sur les findings `low`.
