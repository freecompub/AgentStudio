# Nos agents face à ceux de skraft-plugin

- Date : 2026-10-14, branche `feat/workflow-rejouable`.
- Statut : **constat**. Aucune correction faite, aucune décision prise.
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

### Incohérences entre le prompt et ce que l'agent reçoit

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

### Règle absente

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

**4.6 Méthode de DESIGN.** Les phases 3.5 à 8 de `solution-architect` ne sont ni dans nos prompts,
ni vérifiées par une porte :
- les engagements structurels et les déclencheurs obligatoires d'ADR ;
- la justification de chaque patron (« sans le patron ») ;
- la couche des dépôts (Domain ou Application, jamais Infrastructure) ;
- le découpage Command/Query et les tranches verticales ;
- le classement des sous-domaines (Core, Supporting, Generic) et les patrons de relation ;
- le format des contrats et `decisions-index.md`.

La skill `adr-eligibility-gate` n'en couvre qu'une partie.

**4.7 Plan de test de DISTILL.**
- Les colonnes couche, doublure et walking skeleton ne sont pas nommées dans le prompt de
  `skraft-acceptance`, alors que SPEC-skraft les demande.
- Il n'est pas exigé que le plan d'implémentation couvre chaque scénario.
- La skill `clean-architecture-testing`, reprise, n'est donnée qu'aux rôles test et dev.
- Redondance : le prompt dit « Lance les tests », ce que le code fait déjà.

---

## 5. Évolutions du plugin depuis la v1.6.1

Présentes dans main (1.15.1), absentes chez nous :

| Évolution | Agents concernés |
|---|---|
| La recherche devient une **entrée exigée** de DESIGN et de DISTILL. Chez nous, `research.md` n'apparaît que comme un chemin dans « Phases terminées » (`brief.ts:18-22`), sans consigne | architecte, acceptance |
| La recherche liste la pile, le framework de test, les commandes de build et de test, et les éléments existants réutilisables avec leur chemin | researcher |
| Scan structurel par script (`structural-scan.json`), au lieu d'une recherche faite par l'agent | architecte |
| Skills `clean-architecture-{dotnet,java,python,react}` | architecte, software-engineer |
| Respect du plan de test par l'agent, ou trace `PLAN_DEVIATION` ; `test-integrity` juge chaque test au regard du plan | software-engineer, test-integrity |
| Re-revue sélective : seules les lentilles en échec ou dont les fichiers ont changé sont relancées (`carried_forward`) | reviewers |
| Patch produit une fois et partagé par les lentilles | reviewers |
| Mode `rework` : seules les portes invalidées sont relancées | software-engineer, architecte, acceptance |
| Mutation une seule fois en fin de story | **déjà fait chez nous** (ADR 0049) |

---

## 6. Prochaines étapes proposées

1. **Corriger 4.1 à 4.4**, dans l'extension et le workflow, en TDD : ce sont des corrections
   locales (dossiers des lentilles, prompts, plafond de gravité appliqué par le code).
2. **Décider** pour 4.5 à 4.7 : des lentilles propres à DESIGN et DISTILL, et la part de la
   méthode de DESIGN à vérifier par une porte plutôt qu'à confier au prompt.
3. **Décider** quelles évolutions du §5 reprendre (reprise depuis main, et non plus depuis la
   v1.6.1 : l'autorisation actuelle ne porte que sur la branche
   `refactor/v1.6.0-tracking-substrate` et le tag v1.6.1).
4. Mettre à jour `docs/portes-comparees-skraft-plugin.md` : la ligne G14 (l.70) est périmée, car
   le code refuse désormais un verdict dans le nom du fichier d'un ADR.
