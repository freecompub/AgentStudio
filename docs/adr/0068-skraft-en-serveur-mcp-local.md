# ADR 0068 — skraft en serveur MCP local

## Statut

**Accepté** le 2026-10-17 par le responsable du projet, branche `feat/mcp-skraft`. Étude préalable :
`docs/14-skraft-en-serveur-mcp.md`.

## Contexte

On veut utiliser skraft depuis Claude Code ou Copilot CLI, sans l'application de bureau. Le moteur
n'importe pas Electron (`packages/workflow`, `core`, `task-engine`, `runtime-copilot`,
`extension-host`), et le workflow `workflows/skraft/` est autonome (docs/14 §2).

Exposer seulement les portes au LLM de l'hôte (option B de docs/14) casserait le principe « le LLM
propose, le code décide » : rien n'oblige l'hôte à appeler les portes, il n'y a plus de session neuve
par rôle, et le serveur ne voit pas les écritures de l'hôte.

## Décision

1. **Le serveur orchestre** (option A de docs/14). Il exécute le **workflow** `workflows/skraft/`,
   pas l'extension (ADR 0054 : les deux coexistent ; une seule cible pour ce jalon). Il lance lui-même
   les agents, avec leurs sessions neuves par rôle, leurs gardes d'écriture, et ses portes.
2. **Runtime des agents : Copilot**, par l'adaptateur existant (`packages/runtime-copilot`), avec le
   jeton GitHub de `gh`. Le serveur ne dépend que du port `AgentRuntime` : un adaptateur Claude
   (Claude Agent SDK) pourra s'ajouter plus tard, choisi par configuration. Le *sampling* MCP (le LLM
   de l'hôte) est écarté : ni session isolée par rôle, ni outils terminaux, ni garde d'écriture.
3. **Transport stdio.** Le client (Claude Code, Copilot CLI) lance le serveur comme processus enfant,
   depuis sa configuration MCP. Le serveur vit le temps de la session du client : un run interrompu
   par sa fermeture reprend au démarrage suivant, par rejeu du journal.
4. **Outils courts, pas d'appel bloquant** (un run dure longtemps) : démarrer, consulter l'état
   (phase, étape, dernier rejet, questions en attente), répondre à une question (ratification,
   escalade, arbitrage, question ouverte), reprendre, arrêter, lire le rapport. Les questions à
   l'humain sont déjà des demandes enregistrées : elles se traduisent directement en ces outils.
5. **Un verrou par projet.** Chaque client lance son propre serveur : deux instances de Copilot CLI
   donnent deux serveurs, qui partagent le dépôt, le dossier des tâches et le registre des sessions.
   Le serveur qui lance ou reprend un run prend un verrou (avec son PID, libéré à l'arrêt ou repris
   si le processus est mort). *Précisé le 2026-11-05* : le verrou est dans le dossier de données du
   serveur (`~/.agent-studio/mcp-skraft/verrous/`, un fichier par projet), **pas dans le dépôt** :
   les checkpoints capturent les fichiers non suivis (`git add -A`) et le rollback les restaure ;
   dans le dépôt, le verrou entrerait dans les checkpoints et dans les diffs que contrôlent les
   portes. Un autre serveur reste en
   **consultation** : il lit l'état, mais refuse de lancer, de reprendre, d'arrêter un run et de
   répondre à ses questions, avec un message clair. *Décidé le 2026-11-05* (au lieu de « peut
   répondre aux questions ») : répondre relance le run dans le serveur qui répond
   (`interactions.respond` → `engine.dispatch`), il tournerait alors en parallèle du pilote. Chaque
   serveur donne son PID et celui du pilote (`skraft_etat`, messages de refus), pour que
   l'utilisateur sache depuis quelle fenêtre répondre.
6. **Projet de l'appelant.** Détecté, dans l'ordre : l'argument `projet` d'un outil, les *roots*
   déclarés par le client MCP, le dossier courant du processus. Le serveur tourne sous le compte de
   l'utilisateur, sans bac à sable, et les demandes de permission du client ne couvrent pas ses
   écritures : il **borne** donc les projets acceptés — un dépôt Git, dans un root du client ou dans
   une liste de dossiers autorisés de sa configuration. Tout autre chemin est refusé.

7. **Authentification.** Le runtime Copilot a
   besoin d'un jeton GitHub compatible Copilot ; le serveur n'a pas de fenêtre. Deux cas, comme
   l'application (`packages/github-auth`) :
   - **déjà connecté avec `gh`** : le serveur lit le jeton (`gh auth token`) et vérifie qu'il est
     accepté par Copilot ; aucune étape visible ;
   - **pas connecté**, ou jeton refusé (jeton personnel classique) : un outil `skraft_connexion`
     lance le flux d'appareil (`gh auth login --web`) et **rend le code et l'adresse à l'hôte**, qui
     les affiche ; l'utilisateur valide dans son navigateur, et le serveur attend la fin de la
     connexion. Les autres outils répondent « non connecté : appelle `skraft_connexion` ».

   GitHub Enterprise : l'hôte est donné par la configuration du serveur. Le jeton n'est jamais rendu
   à l'hôte MCP ni écrit dans un journal.

8. **Pile du projet.** Le serveur reprend le
   choix de l'application (`packages/project-services/src/workspace-services.ts`), dans cet ordre :
   - le **profil du projet** `.agent-studio/stack.yaml`, versionné avec le dépôt ;
   - sinon la **détection automatique** par les adaptateurs (TypeScript aujourd'hui) ;
   - sinon le **profil fourni par le client** dans son appel (argument `pile` de `skraft_demarrer`),
     au même format que `.agent-studio/stack.yaml`.

   Un profil fourni par le client passe les **mêmes contrôles** qu'un profil du projet : validation
   du schéma, et chaque programme qu'il nomme doit figurer dans la liste de l'administrateur
   (`allowedPrograms` de `admin.json`, ou la liste par défaut). Il est gardé avec le run, pour qu'une
   reprise utilise la même pile, et n'est pas écrit dans le dépôt. Sans profil ni adaptateur ni pile
   fournie, le serveur **refuse de démarrer**, avec un message qui dit quoi fournir : un repli sur
   une autre pile ferait échouer toutes les portes pour une mauvaise raison. La pile retenue, et sa
   source, figurent dans la réponse de `skraft_etat`.

9. **Accord sur le workflow, sans fenêtre** (décidé le 2026-11-05). Même règle que l'application
   (`verifierAccord`, ADR 0055), en deux appels : si aucun accord n'est retenu pour l'empreinte du
   workflow, `skraft_demarrer` ne lance rien et rend « accord requis » avec le résumé de
   `resumeAccord` (origine, écritures, Git, tests, agents). L'hôte le montre à l'utilisateur, puis
   rappelle `skraft_demarrer` avec `accord: "une-fois"` ou `accord: "toujours"` ; « toujours »
   retient l'accord pour cette empreinte, un workflow modifié est redemandé. Écartés : l'accord
   préalable en configuration (l'utilisateur ne voit pas le résumé, l'accord ne suit plus
   l'empreinte) et l'*elicitation* MCP (support par Copilot CLI non vérifié).

## Conséquences

- Un nouveau point d'entrée Node (paquet `apps/mcp-skraft`), qui assemble les services d'un projet
  sans Electron : moteur de tâches, Workspace, adaptateur de pile, interactions, preuves, trace,
  runtime Copilot, workflow activé. L'IPC, les confirmations et le chat de l'application de bureau
  sont remplacés par les outils et les notifications MCP.
- SDK MCP : `@modelcontextprotocol/sdk` (1.32.2 au 2026-11-05, Node ≥ 18, compatible zod 4).
- La reprise hors Electron reste à vérifier (docs/14 §5, point 4).
- Pendant un run, l'hôte ne doit pas modifier le dépôt : skraft travaille sur `skraft/<slug>` et ses
  checkpoints supposent d'être seuls.
- Coûts : l'hôte consomme pour piloter, les agents de skraft pour travailler (deux abonnements si
  l'hôte n'est pas Copilot).
- Points à vérifier sur les versions installées avant de s'y fier : le dossier courant donné au
  serveur par chaque client, et leur support des *roots* MCP.
