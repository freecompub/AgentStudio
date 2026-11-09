# Serveur MCP skraft

Exécute le workflow skraft (`workflows/skraft/`) sur le projet de l'appelant, depuis un client MCP
(Claude Code, Copilot CLI). Le serveur orchestre : il lance lui-même les agents, avec une session
neuve par rôle, des gardes d'écriture et des portes vérifiées par le code. L'hôte démarre un run, le
suit et relaie les questions à l'utilisateur. Décision : ADR 0068 ; étude : `docs/14`.

Une story passe par RESEARCH, DESIGN (avec ADR), DISTILL (scénarios d'acceptance), DELIVER (TDD),
chaque phase revue par des lentilles. Le travail est commité sur la branche `skraft/<slug>`.

## Construire

```bash
pnpm --filter @agent-studio/mcp-skraft build   # dist/main.mjs, dist/workflow-child.mjs, dist/workflows/skraft/
```

Le workflow est **copié** dans `dist/` au build : toute modification de `workflows/skraft/` demande de
reconstruire le serveur.

## Prérequis

- Node.js 22.13 ou plus (les workflows tournent isolés sous `--permission`).
- `git`.
- Le **runtime des agents**, au choix (ADR 0070, réglage `runtime`) :
  - **Copilot** (par défaut) : un abonnement Copilot, et `gh` (GitHub CLI) pour la connexion ;
  - **Claude** : Claude Code (`claude`) installé et connecté (`claude auth login`).
- Les outils que la pile du projet lance (`dotnet`, `pytest`, `vitest`, Stryker…), autorisés par
  l'administrateur (`admin.json`, voir plus bas).

## Inscrire le serveur dans un client

Le client lance le serveur en processus enfant (transport stdio) :

```bash
claude mcp add skraft -- node /chemin/vers/apps/mcp-skraft/dist/main.mjs
```

Pour Copilot CLI, déclarer la même commande (`node …/dist/main.mjs`) dans sa configuration MCP
(format à vérifier sur la version installée).

## Configuration

### Le serveur : `~/.agent-studio/mcp-skraft.json`

Facultatif ; `SKRAFT_MCP_CONFIG` en désigne un autre. Une clé inconnue est refusée.

```json
{
  "autorises": ["~/Projets"],
  "hostname": "github.com",
  "runtime": "claude",
  "modeles": { "strong": "opus", "standard": "sonnet", "light": "haiku" }
}
```

| Clé | Défaut | Rôle |
|---|---|---|
| `autorises` | `[]` | Dossiers (absolus, `~` accepté) où un projet est accepté, en plus des roots déclarés par le client. Un projet doit être un dépôt Git situé dans l'un ou l'autre. Ailleurs, si le client sait poser une question (*elicitation*), le serveur demande à l'utilisateur d'accepter le dépôt : une fois, ou toujours (retenu dans `~/.agent-studio/mcp-skraft/depots-acceptes.json`) ; sinon il refuse (ADR 0075). |
| `hostname` | `github.com` | Hôte GitHub (ou GitHub Enterprise) pour la connexion Copilot. |
| `runtime` | `copilot` | `copilot` ou `claude` : qui fait travailler les agents. |
| `modeles` | défaut du runtime | Modèle par classe de rôle : `strong` (les deux architectes, le réfutateur), `standard` (chercheur, acceptance, testeur, développeur, arbitre de mutation, lentilles cold-reader, test-integrity, architecture), `light` (classifieur, lentille quality-gates). Avec Claude : `opus`, `sonnet`, `haiku` par défaut. |

### L'utilisateur et les programmes : `admin.json`

Comme pour l'application de bureau : le **profil** de l'utilisateur (qui décide de quelles
questions, voir « Les questions » ; `developpeur` sans fichier) et les **programmes** qu'une pile a
le droit de lancer (`allowedPrograms`).

Le fichier est cherché à un emplacement **système**, pas dans le dossier personnel :

| Système | Emplacement |
|---|---|
| macOS | `/Library/Application Support/agent-studio/admin.json` |
| Linux | `/etc/agent-studio/admin.json` |
| Windows | `%ProgramData%\agent-studio\admin.json` |

La variable `AGENT_STUDIO_ADMIN_CONFIG` en désigne un autre ; pour le serveur, la poser dans le
bloc `env` de sa déclaration chez le client. Le fichier est lu au démarrage du serveur : redémarrer
le client après l'avoir changé.

`allowedPrograms` **remplace** la liste par défaut, il ne s'y ajoute pas. Sans la clé, la liste par
défaut s'applique : `pytest`, `go`, `cargo`, `gradle`, `mvn`, `dotnet`, `vitest`, `jest`, `phpunit`,
`rspec`, des linters (`eslint`, `ruff`…), `prettier` et des outils de mutation (`stryker`, `mutmut`,
`pitest`). Un fichier illisible n'autorise aucun programme.

```json
{ "profile": { "role": "architecte" }, "allowedPrograms": ["dotnet", "pytest"] }
```

Un programme refusé l'est avec la liste en vigueur et son origine : le fichier lu, ou celui qui
était attendu et manquait.

## La pile du projet

Skraft doit savoir comment lancer les tests, où vivent les fichiers, comment lire une erreur de
compilation. Il prend, dans cet ordre :

1. le **profil du projet** : `.agent-studio/projet.yaml`, section `pile`, ou section `composants`
   pour un dépôt qui mélange les technologies (ADR 0071, 0074) ;
2. sinon, l'**adaptateur** intégré, s'il reconnaît le projet (TypeScript avec Vitest) ;
3. sinon, la pile donnée par l'appelant dans l'argument **`pile`** de `skraft_demarrer`, au même
   format. Elle est gardée hors du dépôt (`~/.agent-studio/mcp-skraft/piles/`), pour qu'une reprise
   la retrouve. Une pile donnée alors que le projet a la sienne est ignorée, et le message le dit.

Sans aucune des trois, le serveur refuse de démarrer, et dit de fournir `pile`.

Dans un projet, `/stack init` (application de bureau) propose un profil, BDD compris, et
`/stack doctor` le vérifie en l'exécutant (canaris). Si le BDD n'est détecté qu'à moitié, `/stack init`
n'écrit rien et demande la suite : `/stack init --lanceur <nom> --features <dossier> --etapes <dossier>`,
ou `/stack init --sans-bdd`. Exemple de pile .NET, en BDD avec Reqnroll,
mutation Stryker et deux projets de test :

```yaml
id: dotnet
detect: [Tarification.sln]
tests:
  command: [dotnet, test, --nologo, --logger, "junit;LogFilePath={rapports}/{assembly}.xml",
            --collect, "XPlat Code Coverage;Format=cobertura", --results-directory, "{couverture}"]
  report: junit-xml
  coverage: cobertura-xml
mutation:
  command: [dotnet, stryker, --config-file, stryker-config-core.json, --output, "{dossier}"]
  report: stryker-json
format:
  command: [dotnet, format, --verify-no-changes]
layout:
  acceptanceTests: []
  unitTests: ["tests/Tarification.Tests/**/*.cs"]
  sources: ["src/**/*.cs"]
bdd:
  - lanceur: reqnroll
    features: tests/Tarification.UnitTests/Features
    etapes: tests/Tarification.UnitTests/Steps
infrastructureModules: [Microsoft.EntityFrameworkCore, System.Data, System.Net.Http]
buildErrors:
  pattern: '^(?<file>[^\s(]+\.cs)\(\d+,\d+\): (?<message>error \w+: .*)$'
  missingSymbol: ["error CS0103", "error CS0246", "error CS0234", "error CS1061", "error CS0117"]
```

- **Jetons** substitués par le code, jamais par un shell : `{rapport}` (un fichier) ou `{rapports}`
  (un dossier, un rapport par projet de test, tous réunis), `{couverture}` et `{dossier}` (dossiers
  de sortie), `{fichiers}` (fichiers à vérifier). Ce qui les entoure passe tel quel
  (`{assembly}` est un jeton du lanceur).
- **`bdd`** (ADR 0074) : `false` ou absent, les scénarios Gherkin sont une spécification dans
  `.skraft/<slug>/` et les tests d'acceptance sont ordinaires ; une liste de couples
  `{ lanceur, features, etapes }`, les `.feature` du projet **sont** les tests d'acceptance. Lanceurs
  connus : `reqnroll`, `specflow`, `cucumber-js`, `jest-cucumber`, `cucumber-jvm`, `pytest-bdd`,
  `behave`. Le TDD reste la règle en DELIVER. **Une pile muette sur le BDD** (`bdd` absent) dans un
  projet qui en montre les signes (un lanceur cité par un manifeste, des `.feature`) **ne démarre pas** :
  déclarer les couples, ou `bdd: false`.
- **Qualité** : la section `qualite` de `projet.yaml` fixe les seuils (couverture, mutation). Par
  défaut, la mutation exige 100 % pour le domaine et l'application, jugée sur les **seules lignes
  modifiées** par la story ; la couverture est rapportée, pas exigée.

## Outils

| Outil | Arguments | Rôle |
|---|---|---|
| `skraft_connexion` | — | Connexion du runtime. Copilot : rend un code et une adresse à valider dans le navigateur. Claude : vérifie `claude auth status`, sinon dit de lancer `claude auth login`. Rappeler pour vérifier. |
| `skraft_demarrer` | `story` (chemin relatif au projet), `auto`, `archi`, `pile`, `accord`, `projet` | Démarre un run, en arrière-plan. Au premier lancement, rend le **résumé à faire accepter** (agents, droits d'écriture, questions) sans rien démarrer ; rappeler avec les mêmes arguments et `accord: "une-fois"` ou `"toujours"` (retenu tant que le workflow ne change pas). `auto` : retient la difficulté proposée sans la faire confirmer. `archi` : skill d'architecture par son nom ou son langage (`java`) ; par défaut la clean architecture. |
| `skraft_etat` | `projet` | JSON : mode du serveur (pilote ou consultation), workflow et accord, pile retenue, runs (phase, étape, dernier rejet, usage, et **`progression`**, la ligne à montrer telle quelle), **questions en attente** (identifiant, options, profils, réponse libre), derniers messages. |
| `skraft_attendre` | `tache`, `delai` (secondes, 30 par défaut, 50 au plus : un client MCP abandonne souvent un appel au-delà de 60 s), `projet` | **Attend un changement**, puis rend ce qui a changé **depuis le dernier appel** (phase, étape, rejet avec sa porte et son motif, lus dans la trace du run, question à poser, réponse reçue, message, fin), la ligne de progression de chaque run, les questions en attente et `termine`. Rien ne se perd entre deux appels. Run déjà fini : réponse immédiate. |
| `skraft_repondre` | `question`, `option`, `texte`, `projet` | Répond à une question en attente, par l'identifiant et l'option lus dans `skraft_etat` ; `texte` : réponse libre ou commentaire. L'hôte pose la question à l'utilisateur, il ne répond jamais à sa place. |
| `skraft_rapport` | `tache`, `projet` | JSON : statut (`en-cours`, `fini`, `echec`, `annule`), valeur ou motif, messages (dont le bilan final), dernier rejet, arbitrages, et **étapes** (une par phase et par rejeu : début, fin, durée, tours, rejets, unités Copilot `aiu`, coût Claude `coutUsd`, modèles). |
| `skraft_reprendre` | `projet` | Prend la main si aucun autre serveur ne pilote le projet, et reprend les runs interrompus (rejeu du journal). |
| `skraft_arreter` | `tache`, `projet` | Abandonne un run ; ses questions en attente sont annulées. |

`projet` est facultatif partout : par défaut, le premier root du client, sinon le dossier courant du
serveur.

## Déroulé d'un run

1. `skraft_connexion` si le runtime n'est pas encore connecté.
2. `skraft_demarrer { story: "stories/US-2.md" }` : montrer le résumé rendu à l'utilisateur ; s'il
   accepte, rappeler avec `accord`. La réponse donne l'identifiant de la tâche.
3. `skraft_attendre { tache }` en boucle, tant que `termine` est faux : à chaque retour, dire à
   l'utilisateur ce qui a changé, avec la ligne de progression, par exemple
   « US-2 · Conception, étape 2/5 · en cours · 6 min 34 s · 2,94 $ · dernier rejet : … · aucune question
   en attente ». (`skraft_etat` donne la même ligne à la demande.)
4. Une question apparaît (« Question à poser à l'utilisateur : … ») : la montrer à l'utilisateur, puis
   `skraft_repondre` avec son choix. Le run reprend.
5. Statut `fini` : `skraft_rapport` donne le bilan (phases, ADR, notes hors du changement) et le
   tableau des étapes. La branche `skraft/<slug>` contient le travail, un commit par phase et par
   scénario.

## Les questions

Chaque question est réservée à des profils (`admin.json`) ; un autre profil ne peut pas y répondre.

| Type | Quand | Profils |
|---|---|---|
| `confirmer-difficulte` | après la classification, sauf `auto` | tous |
| `question-ouverte` | questions de la story **avant RESEARCH**, celles de la recherche avant DESIGN ; réponse libre ou report | PO, développeur, architecte, administrateur |
| `blocage` | un agent a besoin d'une information pour continuer | PO, développeur, architecte, administrateur |
| `question-de-revue` | une lentille pose une question métier | PO, développeur, architecte, administrateur |
| `escalade` | une phase échoue (budget épuisé, même refus deux fois) : relancer, sauter, abandonner | développeur, architecte, administrateur |
| `arbitrer`, `arbitrer-mutation`, `arbitrer-couverture` | un agent conteste un défaut, un mutant, une ligne non couverte | développeur, architecte, administrateur |
| `ratifier-adr` | un ADR proposé en DESIGN | architecte |

## Pendant un run

- L'hôte ne modifie pas le dépôt : skraft travaille sur `skraft/<slug>`, et ses points de reprise
  supposent d'être seuls.
- Deux clients ouverts sur le même projet donnent deux serveurs : un seul **pilote** (verrou), l'autre
  **consulte** (`skraft_etat`, `skraft_rapport`) ; `skraft_reprendre` prend la main quand le pilote est
  arrêté.
- Le dossier `.skraft/<slug>/` reçoit les livrables (recherche, conception, plans de test, rapports de
  revue) et `passation.md`, les réponses de l'utilisateur, citables par les agents.

## Essai réel hors client

`scripts/essai-mcp-skraft.ts` joue l'hôte : il clone le projet (jamais le dépôt donné), lance le
serveur construit, donne l'accord, répond avec le répondeur du banc, et affiche le tableau des étapes.
Il consomme de vraies requêtes.

```bash
pnpm --filter @agent-studio/mcp-skraft build
PATH=$HOME/.dotnet:$PATH DOTNET_ROOT=$HOME/.dotnet pnpm tsx scripts/essai-mcp-skraft.ts \
  https://github.com/freecompub/exemple-dotnet-tdd.git stories/US-2.md docs/runs/reponses-us-2.json \
  --runtime=claude --pile=pile.yaml [--base=<commit>] [--auto]
```

Comptes rendus : `docs/runs/`.

## Données

Tout ce que le serveur garde est dans `~/.agent-studio/mcp-skraft/` : tâches, journaux de rejeu et
traces (`tasks/`), piles fournies (`piles/`), dépôts acceptés « toujours » (`depots-acceptes.json`),
verrous (`verrous/`), état du CLI Copilot (`copilot/`),
journal (`logs/mcp-skraft.log`). Rien n'est écrit dans le dépôt en dehors du travail de skraft.

## Licence

Le workflow skraft est sous GPL-3.0-or-later (`dist/workflows/skraft/LICENSE`), livré avec ses
sources. La licence du reste du paquet n'est pas encore fixée : il n'est pas à distribuer en l'état.
