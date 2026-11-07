# Serveur MCP skraft

Exécute le workflow skraft (`workflows/skraft/`) sur le projet de l'appelant, depuis un client MCP
(Claude Code, Copilot CLI). Le serveur orchestre : il lance lui-même les agents (Copilot), avec une
session neuve par rôle, des gardes d'écriture et des portes vérifiées par le code. L'hôte démarre un
run, le suit et répond aux questions. Décision : ADR 0068 ; étude : `docs/14`.

## Construire

```bash
pnpm --filter @agent-studio/mcp-skraft build   # dist/main.mjs, dist/workflow-child.mjs, dist/workflows/skraft/
```

## Prérequis

- Node.js 22.13 ou plus (les workflows tournent isolés sous `--permission`).
- `git`, et `gh` (GitHub CLI) pour la connexion à GitHub.
- Un abonnement Copilot : les agents de skraft tournent sur Copilot, quel que soit l'hôte.

## Inscrire le serveur dans un client

Le client lance le serveur en processus enfant (transport stdio), par exemple :

```bash
claude mcp add skraft -- node /chemin/vers/apps/mcp-skraft/dist/main.mjs
```

Pour Copilot CLI, déclarer la même commande (`node …/dist/main.mjs`) dans sa configuration MCP
(format à vérifier sur la version installée).

## Configuration

`~/.agent-studio/mcp-skraft.json` (ou le fichier désigné par `SKRAFT_MCP_CONFIG`), facultatif :

```json
{ "autorises": ["~/Projets"], "hostname": "github.com" }
```

- `autorises` : dossiers où un projet est accepté, en plus des roots déclarés par le client. Un
  projet doit être un dépôt Git situé dans l'un ou l'autre ; tout autre chemin est refusé.
- `hostname` : `github.com` ou une instance GitHub Enterprise.

Les programmes qu'une pile peut lancer et le profil de l'utilisateur viennent d'`admin.json`, comme
pour l'application de bureau (`AGENT_STUDIO_ADMIN_CONFIG` pour le désigner).

## Outils

| Outil | Rôle |
|---|---|
| `skraft_connexion` | Connexion à GitHub : rend un code et une adresse à valider dans le navigateur |
| `skraft_demarrer` | Démarre un run sur une story ; au premier lancement, rend l'accord à faire valider (`accord: "une-fois"` ou `"toujours"`) ; `pile` si le projet n'en a pas |
| `skraft_etat` | Mode du serveur, workflow et accord, pile, runs, questions en attente, derniers messages (JSON) |
| `skraft_repondre` | Répond à une question en attente |
| `skraft_reprendre` | Prend la main si aucun autre serveur ne pilote le projet, et reprend les runs interrompus |
| `skraft_arreter` | Abandonne un run |
| `skraft_rapport` | Rapport d'un run : statut, valeur ou motif, messages, dernier rejet, arbitrages (JSON) |

Deux clients ouverts sur le même projet donnent deux serveurs : un seul pilote (verrou), l'autre
consulte. Pendant un run, l'hôte ne doit pas modifier le dépôt : skraft travaille sur
`skraft/<slug>` et ses checkpoints supposent d'être seuls.

## Données

Tout ce que le serveur garde est dans `~/.agent-studio/mcp-skraft/` : tâches et journaux de rejeu
(`tasks/`), piles fournies (`piles/`), verrous (`verrous/`), état du CLI Copilot (`copilot/`),
journal (`logs/mcp-skraft.log`). Rien n'est écrit dans le dépôt en dehors du travail de skraft.

## Licence

Le workflow skraft est sous GPL-3.0-or-later (`dist/workflows/skraft/LICENSE`), livré avec ses
sources. La licence du reste du paquet n'est pas encore fixée : il n'est pas à distribuer en l'état.
