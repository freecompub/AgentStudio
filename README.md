# agent-studio

Application de bureau qui fait travailler des agents de code sous contrôle : le LLM propose, le
code décide et vérifie.

Les agents ne sont pas laissés libres. Les preuves — exécutions de tests — sont produites par
l'application, pas rapportées par l'agent. Les passages d'un état à l'autre sont des portes
exécutées par du code : tests au vert, périmètre d'écriture respecté, empreinte des tests gelés
inchangée. Chaque tour est précédé d'un point de restauration Git, et un tour interrompu est
rejoué depuis ce point plutôt que rafistolé.

`agent-studio` est un nom de code (O10).

## Prérequis

| | |
| --- | --- |
| Node | ≥ 22.12 |
| pnpm | 10 (`corepack enable` suffit : la version est épinglée par `packageManager`) |
| GitHub CLI | [`gh`](https://cli.github.com), connecté en OAuth — un jeton personnel classique est refusé par Copilot |
| Git | pour les points de restauration et les commits |

L'application n'a pas de compte : elle emprunte celui de `gh` (D4). Si `gh` n'est pas connecté,
elle propose de l'être, sur GitHub.com ou sur une instance GitHub Enterprise.

```bash
pnpm install
pnpm dev
```

## Commandes

```bash
pnpm test                        # toute la suite Vitest, sans aucun appel réel au LLM
pnpm typecheck                   # types du processus Node et du renderer
pnpm build                       # build Electron dans apps/desktop/out
pnpm smoke:copilot               # essai réel contre Copilot : consomme des requêtes
pnpm ext:build <src> <sortie>    # compile une extension du dépôt
pnpm ext:keys / pnpm ext:pack    # clés d'éditeur, puis paquet .asx
```

## Ce que fait l'application

Vous ouvrez un dépôt Git, vous conversez avec un agent, et vous pouvez **annuler un tour d'un
geste** : le point de restauration est repris, les fichiers écrits disparaissent.

Deux extensions apportent des méthodes de travail :

- **`tdd`**, livrée avec l'application : un cycle rouge / vert / nettoyage, où l'agent qui écrit
  le code ne peut pas modifier les tests — la garde le refuse, et une empreinte le détecte s'il
  passe outre ;
- **`skraft`**, distribuée à part en paquet `.asx` : un pipeline recherche → conception →
  distillation → livraison → revue, avec des ADR, des scénarios d'acceptance gelés et une revue
  par lentilles dont le verdict est reproductible.

Chaque extension tourne dans **son propre processus**, sous le modèle de permissions de Node, et
ne voit jamais le SDK : seulement l'API `ctx`.

## Le serveur MCP skraft

skraft tourne aussi **hors de l'application**, depuis un client MCP (Copilot CLI, Claude Code) :
`apps/mcp-skraft` (ADR 0068, mode d'emploi dans son `README.md`).
- Le serveur fait travailler ses propres agents, avec les mêmes gardes et les mêmes portes.
- Le client démarre, suit et relaie les questions.
- Ce qui élargit les droits est demandé à l'utilisateur par le client (ADR 0075) : un dépôt hors
  des dossiers permis, un programme hors de la liste, l'écriture du profil de pile.
- Sans pile, `skraft_pile` la fait découvrir par un agent et la vérifie en l'exécutant (ADR 0076).

## La pile d'un projet

Comment lancer les tests, où sont les fichiers, comment lire les rapports : c'est la section `pile`
de `.agent-studio/projet.yaml` (`profiles/README.md`). `/stack init` la fait découvrir par un agent,
à partir de ce que le code a détecté. Le code la vérifie ensuite :
- programmes autorisés, ou acceptés par l'utilisateur ;
- schéma et diagnostic ;
- canaris, des tests à la réponse connue, lancés dans une copie du projet.

La pile n'est écrite qu'après accord. `/stack doctor` la vérifie à nouveau à la demande.

## Organisation

| Dossier | Rôle |
| --- | --- |
| `apps/desktop` | Electron : processus principal, preload sandboxé, renderer React |
| `packages/core` | Sessions, registre, routeur, arbitre de permissions, preuves |
| `packages/task-engine` | Réducteur pur, effets, persistance, reprise après redémarrage |
| `packages/workspace` | Seul service à toucher le disque et Git |
| `apps/mcp-skraft` | Serveur MCP local : skraft depuis Copilot CLI ou Claude Code |
| `packages/runtime-copilot` | Adaptateur du port `AgentRuntime` vers le Copilot SDK |
| `packages/runtime-claude` | Adaptateur vers Claude, par le CLI `claude -p` (ADR 0070) |
| `packages/workflow` | Workflows rejouables : script, appels journalisés, reprise par rejeu (ADR 0052, 0055) |
| `packages/project-services` | Services d'un projet ouvert : pile, `/stack`, tâches, accords, workflows |
| `packages/stack-adapters` | Lancement des tests par langage (TypeScript/Vitest ; profils déclaratifs pour les autres) |
| `packages/extension-*` | API, hôte isolé, manifeste, empaquetage signé, installation |
| `extensions/{tdd,skraft}` | Les deux méthodes de travail |
| `workflows/skraft` | skraft en workflow, celui qu'embarque le serveur MCP |

## Documentation

- `docs/specs/SPEC.md` — document faisant autorité : décisions (D1–D42), feuille de route,
  conventions ;
- `docs/specs/SPEC-skraft.md` — l'extension `skraft` ;
- `docs/adr/` — décisions techniques prises en cours de route, avec leurs conséquences ;
- `docs/jalons/` — bilan de chaque jalon, ses critères de sortie et ses limites connues.

## État

Jalons J1 à J6 (socle) et S1 à S6 (skraft) livrés. La reprise du contenu de skraft-plugin a commencé
le 2026-09-25 (ADR 0012, `docs/licences/autorisation-skraft.md`). Où en est le travail :
`features.json` (critères vérifiables) et `progress.md` (journal, pièges, prochaine étape). Le
passage à SQLite (ADR 0019) reste décidé et non implémenté.
