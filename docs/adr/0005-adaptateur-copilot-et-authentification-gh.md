# ADR 0005 — Adaptateur Copilot SDK et authentification par GitHub CLI

- Statut : accepté
- Date : 2026-09-23
- Jalon : J1 (D3, D4, D10, D27, D28, §15)

## Contexte

Version installée : `@github/copilot-sdk` 1.0.14, qui embarque le runtime Copilot CLI 1.0.85 dans un
paquet propre à chaque plateforme. Aucun binaire `copilot` n'est donc requis sur le poste. Les points
`À VÉRIFIER` du §15 ont été contrôlés sur cette version.

## Décision

1. **Arbitrage par `onPermissionRequest`**, pas par `onPreToolUse`. Les demandes de permission sont
   typées par *sorte* (`shell` avec `fullCommandText`, `write` avec `fileName`/`resolvedPath`,
   `read`, `url`, `mcp`, `custom-tool`…), une information stable. Les noms d'outils intégrés vus par
   `onPreToolUse`, eux, varient selon la version du CLI (§15). Chaque demande est normalisée en
   `ToolCallRequest`, puis confiée à la `ToolCallGuard` de la session. Une exception ou un délai
   dépassé donne `reject` (D28). Chaque refus est aussi émis comme événement `tool-denied`.
2. **Nos outils** passent par `defineTool` avec `skipPermission: true`, puisque leur contrôle est dans
   notre handler, et `isTerminal: true` pour les outils terminaux (D18).
3. **Isolement du SDK** : l'adaptateur dépend d'un protocole minimal (`CopilotClientPort`,
   `CopilotSessionPort`), que les classes du SDK satisfont structurellement. La session renvoyée au
   cœur n'expose que `id`, `send`, `onEvent`, `abort` et `close` (D10).
4. **Événements** : seuls les messages et le `session.idle` de l'agent principal comptent. Les
   événements portant `parentToolCallId` ou `agentId` (sous-agents) et tous les événements inconnus
   deviennent `activity`, qui ne sert qu'à réarmer le watchdog.
5. **Authentification** : le jeton vient de `gh auth token` et est passé au client
   (`gitHubToken`, `useLoggedInUser: false`). Il ne quitte jamais le processus principal.
   **Constat** : l'API Copilot refuse les PAT classiques (`ghp_…`, erreur « Personal Access Tokens
   are not supported for this endpoint »). Le service d'authentification détecte la nature du jeton
   et exige alors une reconnexion par navigateur (`gh auth login --web`, jeton OAuth `gho_…`).

## Conséquences

- `onPreToolUse` reste disponible pour les gardes d'extension (J4, composition des hooks §5.5).
- Un essai réel (`pnpm smoke:copilot`, hors CI) vérifie les critères de J1 contre le vrai service.
