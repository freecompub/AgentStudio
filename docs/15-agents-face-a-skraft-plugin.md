# Nos agents face à ceux de skraft-plugin

- Date : 2026-10-14, branche `feat/workflow-rejouable`.
- Statut : **constat**. §4.1 à 4.5 corrigés le 2026-10-14, §4.6 et §4.7 le 2026-10-15 (extension et workflow) ; §5 à décider.
- Question : nos agents font-ils la même chose que ceux de skraft-plugin
  (`github.com/SebastienDegodez/skraft-plugin`) ?
- Versions comparées :
  - **v1.6.1**, le tag d'où vient notre reprise (`docs/licences/autorisation-skraft.md`) ;
  - **main en 1.15.1**, l'état du plugin au 2026-10-14.
- Méthode : lecture des prompts, des skills et du code des deux côtés. Agents du plugin :
  `plugins/skraft-framework/com.github.copilot/agents/`. Les nôtres : `extensions/skraft/agents/`.
  Dans ce document, les numéros de ligne côté plugin sont ceux de la v1.6.1, sauf mention contraire.

---

## 1. En résumé

Nos agents font globalement le même travail que ceux du plugin, avec une différence de fond
voulue : **chez nous, la procédure est exécutée par le code**, pas lue par l'agent. Cela concerne
les commits, la preuve du rouge, le lancement des portes, la ratification des ADR, le rendu des
ADR et la synthèse de la revue. `autorisation-skraft.md` (« Ce qui a été écarté sciemment »)
décrit ce choix.

Il reste trois incohérences entre nos prompts et ce que reçoivent les agents, une règle de
gravité absente, et trois écarts de fond sur DESIGN et DISTILL (§4).

Les copies de l'extension et du workflow (`workflows/skraft/agents/`) sont **identiques octet pour
octet**, et les skills attribuées à chaque rôle sont les mêmes (`extensions/skraft/src/roles.ts`,
`workflows/skraft/workflow.mjs`).

---

## 2. Correspondance des agents

| Notre agent | Agent du plugin | Verdict |
|---|---|---|
| `skraft-researcher` | `solution-researcher` | Équivalent, sauf l'« exemple exécutable » demandé par approche |
| `skraft-architect-model`, `skraft-architect-decide` | `solution-architect` (un seul agent en 10 phases) | **Divergent** : la méthode de modélisation manque (§4.6) |
| `skraft-acceptance` | `acceptance-designer` | Équivalent, sauf le contenu du plan de test (§4.7) |
| `skraft-test`, `skraft-dev` | `software-engineer` (un seul agent pour le test et le code) | Équivalent, avec deux différences voulues (§3.4) |
| `skraft-lens-cold-reader` | `cold-reader-lens` | Équivalent, sauf le plafond de gravité (§4.4) |
| `skraft-lens-test-integrity` | `test-integrity-lens` | Équivalent, sauf le code non transmis (§4.1) |
| `skraft-lens-architecture` | `architecture-boundaries-lens` | Équivalent, sauf l'entrée incohérente (§4.2) |
| `skraft-lens-quality-gates` | `quality-gates-lens` | Différent par construction, fidèle sur le fond (§3.3) |
| `skraft-classifier` | aucun | Création propre : le plugin a supprimé ses niveaux en 1.6.0 (SPEC-skraft) |
| `skraft-mutation-arbiter` | aucun | Création propre, ADR 0065 : chez eux, l'auteur du code exempte lui-même un mutant (`skills/mutation-testing/SKILL.md`) |
| le code (réducteur, `workflow.mjs`) | `skraft-orchestrator` | Remplacé par le code |
| aucun | `brownfield-analyst`, `brownfield-harness-builder`, `brownfield-refactorer`, `refactoring-worker` | Hors MVP (SPEC-skraft) |
| aucun | `contract-testing-worker`, `mock-integration-worker` | Hors MVP |
| aucune | `contract-fidelity-lens`, `mock-fidelity-lens` | Écartées sciemment : liées à .NET (`autorisation-skraft.md`) |

`refactoring-worker` ne correspond pas à notre pas de nettoyage : il sert à la méthode Mikado et
au Strangler Fig, en brownfield. Dans le plugin, `software-engineer` n'a pas de phase REFACTOR
explicite (« Do NOT refactor during Green », puis COMMIT). Notre pas de nettoyage, avec sa porte,
va donc plus loin.

---

## 3. Ce qui diffère par conception

### 3.1 Procédure déplacée dans le code

| Demandé à l'agent par le plugin | Chez nous |
|---|---|
| Commit à chaque cycle ou phase | `effects.ts` (`commitPhase`), `deliver-effects.ts` |
| Preuve du rouge (sortie, code de retour, révision) | `run_tests` et les portes RED (`deliver-effects.ts`, `distill.ts`) |
| Valeurs des critères recopiées mot pour mot | porte `checkValues` (`distill.ts`) |
| Vocabulaire métier du Gherkin | porte `checkGherkin` (`gherkin.ts`) |
| Gabarit de recherche, recommandation unique | porte `checkResearch` (`research.ts`) |
| CLI `artifact adr`, clés obligatoires | outil `render_adr` |
| Ratification Proposed → Accepted/Rejected | réducteur et interaction `ratifier-adr` |
| ADR en ajout seul, numérotation, registre des remplacements | `design.ts` |
| Ne jamais modifier un test pour qu'il passe | empreintes des tests gelés, `deliver-effects.ts` |
| Fichier de production modifié (« Fixture Theater ») | `deliver-effects.ts` |
| Mutation et sa barre | `deliver-effects.ts` (fin de DELIVER, ADR 0049) |
| Journal, `qg-verify`, qa-reporting | faits mesurés par le code (`review-brief.ts`, `reviewFacts`) |
| Bloqué après 3 essais : revenir au vert, escalader | budget de réessais et rollback (`deliver-machine.ts`) |
| Synthèse de la revue (matrice de gravité, notes au minimum) | `review.ts` (`synthesize`), même correspondance question → lentille, mêmes poids |

### 3.2 Écarté sciemment (`autorisation-skraft.md`)

- les Object Calisthenics et les seuils de forme : c'est le linter du projet qui en juge
  (ADR 0022) ;
- « un test qui ne tue aucun mutant, supprime-le » ;
- les lentilles `contract-fidelity` et `mock-fidelity`, liées à .NET.

### 3.3 Choix propres à notre conception

- **Questions à l'humain.** Le plugin les interdit (« NEVER ask questions ») ; nos agents peuvent
  poser une question avec `report_blocker`, et la réponse est réinjectée.
- **Dissidence.** Le plugin interdit d'écarter en silence une lentille minoritaire
  (« Dissent Rule », `software-engineer-reviewer`). Chez nous, l'approbation exige que **toutes**
  les lentilles approuvent (`review.ts:115`) : une minorité ne peut jamais être écartée.
- **Verdict et gravités.** Chez eux : `pass | fail | inconclusive`, gravités
  `blocker | high | medium | low`, et toute gravité `medium` fait retravailler. Chez nous :
  `APPROVED | CHANGES_REQUESTED | REJECTED`, gravités `blocker | major | minor`, et un défaut
  `minor` laisse approuver. Le cas « je ne peux pas juger » passe par `report_blocker`.
- **`quality-gates`** ne reçoit ni code ni tests, seulement les faits et les livrables, pour ne
  pas rejuger ce que les portes ont mesuré (ADR 0028). Elle est absente en DESIGN.

### 3.4 DELIVER

- **Deux rôles au lieu d'un.** `skraft-test` écrit un seul test rouge ; `skraft-dev` le fait
  passer au vert, puis nettoie, en session séparée au niveau `challenging`.
- **Tests d'acceptance.** Le plugin écrit en DISTILL le test du premier scénario seulement. Nous
  écrivons ceux de tous les scénarios, puis nous les gelons (SPEC-skraft).
- **Ajouts propres** : `coveredBy` pour ne pas dupliquer un test d'acceptance (ADR 0045), le pas
  fix-test et la contestation d'un défaut (ADR 0046, 0047), la garde du contrat ratifié.

---

## 4. Écarts à traiter

### Incohérences entre le prompt et ce que l'agent reçoit (corrigées)

**4.1 `test-integrity` ne reçoit pas le code de production.**
- Le prompt dit : « Tu reçois les tests ET le code de production ».
- Le dossier construit par `review-brief.ts:87-90` (et `workflows/skraft/review-brief.mjs:24-25`)
  ne contient que les critères, les tests, les livrables et les faits.
- Conséquence : la lentille ne peut pas juger si un test vérifie le vrai comportement.
  Exemple : une assertion miroir du code, qui recopie le calcul au lieu de vérifier un résultat.

**4.2 `architecture` ne reçoit pas les tests.**
- Le prompt dit : « Tu reçois le code seul, sans les tests », puis demande de vérifier
  « l'absence de doublure dans le domaine ».
- Dans le plugin (G4, « pas de mock dans Domain/Application »), cette vérification se fait dans
  les tests.

**4.3 `cold-reader` : des faits annoncés, aucun reçu.**
- Le prompt parle des « faits qui te sont fournis ».
- Le dossier n'en contient aucun (`review-brief.ts:79-85`).

### Règle absente (corrigée)

**4.4 Plafond de gravité de `cold-reader`.**
- Plugin : « Maximum severity for this lens is `medium`. Nothing here is a `blocker`. »
  (`cold-reader-lens`, l.83).
- Chez nous, cette lentille peut rendre un `blocker` et bloquer seule une phase sur une question
  de clarté.

### Écarts de fond

**4.5 Revue de DESIGN et de DISTILL.**
- Dans le plugin, chaque phase a son relecteur et ses lentilles internes :
  - DESIGN, `solution-architect-reviewer` : cohérence, conformité d'architecture, fitness ;
  - DISTILL, `acceptance-designer-reviewer` : couverture, alignement métier, testabilité, respect
    des frontières.
- Les quatre lentilles-agents ne servent qu'en DELIVER.
- Nous appliquons ces quatre lentilles, faites pour du code, aux documents de DESIGN et de
  DISTILL.

**Traité le 2026-10-14, options C puis A :**

| Porte du plugin | Traitement chez nous |
|---|---|
| DESIGN G2, G12 (registre des remplacements tenu des deux côtés) | Déjà en code (`design.ts`) |
| DESIGN G8 (chaque commande a un événement) | **Code** : `commandesSansEvenement`, porte « cohérence » |
| DESIGN G6 (chaque relation entre contextes nomme son patron) | **Code** : `relationsSansPatron`, porte « cohérence » (si `context-map.md` existe) |
| DISTILL G6 (chaque critère dans `impl-plan.md`) | **Code** : `checkPlans`, porte « plan de test », avant toute exécution |
| DISTILL G8 (au moins un walking skeleton) | **Code** : `checkPlans`, ligne « - @ac-N : walking skeleton — … » dans `test-plan.md` |
| DISTILL G1, G3, G4, G9, G10 | Déjà en code (portes valeurs, gherkin, RED d'acceptance) |
| DESIGN G1, G3, G4, G5, G9, G11, G15 ; DISTILL G2, G3, G5, G7, G11 | **Jugement** : « Points à examiner en DESIGN / DISTILL » ajoutés au dossier de la lentille concernée (`CONSIGNES_DE_PHASE`, `review-brief.ts`, `.mjs`) |

- Les prompts des producteurs annoncent les formats vérifiés : `skraft-architect-model`
  (« Commande `X` → événement `Y` », patron par relation) et `skraft-acceptance` (critères dans
  `impl-plan.md`, ligne walking skeleton).
- Les skills `architecture-review-criteria` et `acceptance-review-criteria` restent à la demande :
  elles portent aussi la dérivation du verdict du plugin (« Verdict Derivation », « Dissent
  Handling »), que notre code remplace.
- **DESIGN G10 (matrice de cohérence) : construite par le code**, et non plus par l'architecte qui
  s'y décernait `consistency-gate: PASS`. `matriceDeCoherence` relève la catégorie donnée à chaque
  nom (« Commande `X` », « objet-valeur `Y` »…) dans `event-model.md`, `domain-model.md`,
  `contracts.md`, `diagrams.md` et les nouveaux ADR, et refuse les catégories incompatibles du
  plugin : commande et requête, entité et objet-valeur, agrégat et service de domaine. La porte
  écrit `design/consistency-matrix.md` à chaque essai ; il est commité avec DESIGN.
- **`STRUCTURAL_DRIFT`** (« le concept existe dans un artefact et pas dans l'autre ») :
  - sens « ADR → modèle », **en code** (`conceptsAbsentsDuModele`) : un concept classé dans un
    nouvel ADR, hors de sa section « Alternatives », existe dans `event-model.md` ou
    `domain-model.md`. Le plugin n'exclut pas les alternatives et exige toutes ses colonnes
    (event-model, diagrams, contracts) : adaptation de notre part ;
  - sens « document → ADR » (un agrégat qu'aucun ADR ne justifie), **à la lentille**
    `architecture`, dans ses consignes de DESIGN. Agrégats seulement : un dépôt en tant que tel est
    une règle de base que le plugin interdit lui-même de ratifier par un ADR (G15).
- Non repris en code : DESIGN G7 (chaque critère a son déclencheur), laissé au jugement de
  `test-integrity` en DESIGN.

**4.6 Méthode de DESIGN.** Les phases 3.5 à 8 de `solution-architect` ne sont ni dans nos prompts,
ni vérifiées par une porte :
- les engagements structurels et les déclencheurs obligatoires d'ADR ;
- la justification de chaque patron (« sans le patron ») ;
- la couche des dépôts (Domain ou Application, jamais Infrastructure) ;
- le découpage Command/Query et les tranches verticales ;
- le classement des sous-domaines (Core, Supporting, Generic) et les patrons de relation ;
- le format des contrats et `decisions-index.md`.

La skill `adr-eligibility-gate` n'en couvre qu'une partie.

**Traité le 2026-10-15** (extension et workflow) :

| Phase de `solution-architect` | Code (porte « cohérence ») | Prompt | Lentille |
|---|---|---|---|
| 3. Réutilisation | — | modélisateur : réutiliser, étendre ou créer, section « Réutilisation » | architecture |
| 4. Command/Query, tranches verticales | commande → événement ; commande et requête cohérentes (matrice) | modélisateur | test-integrity |
| 5. Sous-domaines, relations | chaque contexte classé Core, Supporting ou Generic (`contextesNonClasses`) ; patron par relation | modélisateur | — |
| 6. Couche des dépôts | « Couche : Domaine / Application » exigée, infrastructure refusée (`contratsIncomplets`) | modélisateur et décideur | architecture (consigne corrigée : domaine **ou** application) |
| 7.0 Engagements déjà dans le code | **retiré le 2026-11-11** (décision du responsable : la porte juge les ADR que la story produit, pas l'existant). La recherche dans les sources prenait des skills qui décrivent CQRS pour du code, et bloquait DESIGN en boucle sur AgentStudio. | — | — |
| 7. Déclencheurs obligatoires d'ADR | couche anticorruption de la carte sans ADR → refus | décideur : liste et exclusions | architecture : liste complète |
| 7. Justification des patrons | — | décideur | architecture |
| 8. Format des contrats | chaque commande, requête et événement du modèle a sa section « ## Commande `X` »… (`contratsIncomplets`) | décideur | — |

- Les déclencheurs écrits en prose (« CQRS », « Event Sourcing » dans un document de conception)
  restent à la lentille : une phrase comme « pas de CQRS » tromperait une recherche.
- Un ADR « valable » n'est ni `Rejected`, ni `Superseded`, ni `Deprecated`, et sa section
  « Alternatives » ne compte pas.
- Non repris : `decisions-index.md` (index des verdicts) ; nos ADR et leur statut sont déjà dans
  l'état de la tâche et le rapport final.

**4.7 Plan de test de DISTILL.**
- Les colonnes couche, doublure et walking skeleton ne sont pas nommées dans le prompt de
  `skraft-acceptance`, alors que SPEC-skraft les demande.
- Il n'est pas exigé que le plan d'implémentation couvre chaque scénario.
- La skill `clean-architecture-testing`, reprise, n'est donnée qu'aux rôles test et dev.
- Redondance : le prompt dit « Lance les tests », ce que le code fait déjà.


**Traité le 2026-10-15** (extension et workflow) :
- **Code**, porte « plan de test » (`checkPlans`), avant toute exécution :
  - `test-plan.md` porte une matrice de couverture (colonnes Scénario, Cas d'usage, Couche,
    Doublure, Walking skeleton) avec une ligne par critère, sa couche (Domaine, Application ou
    Infrastructure) et sa doublure (« aucune » acceptée) ; au moins un walking skeleton, par la
    colonne ou par la ligne « - @ac-N : walking skeleton — … » ;
  - chaque critère de `impl-plan.md` a une étape qui nomme son fichier de test
    (« - Test : `chemin` »).
- **Prompt** de `skraft-acceptance` : lecture des conventions de la recherche, matrice, étapes de
  l'extérieur vers l'intérieur ; « Lance les tests » remplacé par « seule l'exécution du code fait
  foi ».
- **Skill** `clean-architecture-testing` donnée à l'agent d'acceptance, à la demande.
- **Lentille** `test-integrity` en DELIVER : chaque test respecte la couche et la doublure prévues
  par la matrice ; un écart non justifié est un défaut.
- Non repris : l'étape « forecast » (rapport du plugin sur ses propres fichiers d'état) ; notre
  rapport final en tient lieu.
---

## 5. Évolutions du plugin depuis la v1.6.1

Présentes dans main (1.15.1), absentes chez nous :

| Évolution | Agents concernés |
|---|---|
| La recherche devient une **entrée exigée** de DESIGN et de DISTILL | architecte, acceptance — **repris le 2026-10-15** : le code recopie conventions et existant réutilisable dans le dossier de passation (`brief.ts`, `brief.mjs`) ; prompts du modélisateur et de l'agent d'acceptance |
| La recherche liste la pile, le framework de test, les commandes de build et de test, et les éléments existants réutilisables avec leur chemin | researcher — **existant réutilisable repris le 2026-10-15**, vérifié par la porte « citations » : chaque élément inventorié existe dans le fichier cité (le plugin ne le vérifie pas). **Commandes non reprises** : l'adaptateur de pile en est l'autorité, et seul `run_tests` les exécute (contrat du cœur, `agent-prompts.ts`) |
| Scan structurel par script (`structural-scan.json`), au lieu d'une recherche faite par l'agent | architecte |
| Skills `clean-architecture-{dotnet,java,python,react}` | architecte, software-engineer — **repris le 2026-10-15** (v1.15.1), avec `architecture-patterns` et `clean-architecture-testing` mises à jour. Choisie à l'appel (`/skraft <story> --archi java`) ; absente ou inconnue : clean architecture par défaut. Le code l'indique dans le dossier de DESIGN, DISTILL et DELIVER, avec la pile tirée de l'adaptateur |
| Respect du plan de test par l'agent, ou trace `PLAN_DEVIATION` ; `test-integrity` juge chaque test au regard du plan | software-engineer, test-integrity — **repris le 2026-10-15** (ADR 0067) : écart déclaré dans `report_phase` (`planDeviations`), vérifié par le code contre la matrice, commité dans `ecarts-au-plan.md`, jugé par `test-integrity` et `quality-gates` |
| Re-revue sélective : seules les lentilles en échec ou dont les fichiers ont changé sont relancées (`carried_forward`) | reviewers |
| Patch produit une fois et partagé par les lentilles | reviewers |
| Mode `rework` : seules les portes invalidées sont relancées | software-engineer, architecte, acceptance |
| Mutation une seule fois en fin de story | **déjà fait chez nous** (ADR 0049) |

**Mesures pour décider des trois dernières lignes (re-revue sélective, patch partagé, mode
`rework`)**, en place depuis le 2026-10-16 : section « Coût des revues et des corrections » du
rapport du banc (`scripts/banc/revues.ts`), recalculable sur un run enregistré, sans requête, par
`pnpm banc:revues docs/runs/<run>`. Sur les deux runs US-2 du 10/10 qui ont atteint DELIVER :

| Run | Revues (req. premium) | Re-revue sélective : économie au plus | Lectures des lentilles | Tokens d'entrée des lentilles / du run | Après la 1re revue de DELIVER |
|---|---|---|---|---|---|
| extension `c4433175` | 64,3 | 8,4 (3 lentilles) | 151 | 1 587 249 / 5 087 423 | 4 exécutions de tests (9 s), 1 revue relancée (17,9) |
| workflow `0b3184b5` | 114,4 | 0 | 111 | 853 135 / 4 019 194 | aucune correction |

Deux runs ne suffisent pas à trancher : à refaire sur les prochains runs Copilot.

---

## 6. Prochaines étapes proposées

1. ~~Corriger 4.1 à 4.4~~ : **fait le 2026-10-14**, extension et workflow.
   - `test-integrity` reçoit le code ; `architecture` reçoit les tests et son prompt le dit
     (`review-brief.ts`, `review-brief.mjs`).
   - Le prompt de `cold-reader` ne parle plus de faits ; il annonce son plafond.
   - Le plafond est appliqué par le code dans `numberDefects` (`review-thread.ts`, `.mjs`) :
     `blocker` → `major`, `REJECTED` → `CHANGES_REQUESTED`, écart tracé dans `severityNote`.
2. ~~4.5~~ : **fait le 2026-10-14** (options C puis A, voir §4.5) ; ~~4.6~~ : **fait le
   2026-10-15** (voir §4.6) ; ~~4.7~~ : **fait le 2026-10-15** (voir §4.7).
3. **Décider** quelles évolutions du §5 reprendre. Depuis le 2026-10-15, l'autorisation couvre
   toutes les versions antérieures à `v2.0.0` (`docs/licences/autorisation-skraft.md`) : une reprise
   depuis `v1.15.1` est possible, en citant ce tag dans sa provenance.
4. Mettre à jour `docs/portes-comparees-skraft-plugin.md` : la ligne G14 (l.70) est périmée, car
   le code refuse désormais un verdict dans le nom du fichier d'un ADR.
