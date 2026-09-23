# J1 — Blocages et critères de sortie en attente

- Date : 2026-09-23
- Branche : `feat/j1-socle`
- État : **code livré, critères de sortie non validés de bout en bout.**
  Le passage à J2 a été demandé explicitement malgré ces points ouverts.

## Critères de sortie de J1 (SPEC §14)

| Critère | État | Vérifié par |
| --- | --- | --- |
| Conversation complète sur un dépôt cloné | ⏳ en attente (blocage 1) | `pnpm smoke:copilot`, puis l'application |
| Checkpoint et annulation en un geste | ✅ en test automatisé / ⏳ en réel | `main-session.test.ts`, `checkpoints.test.ts`, `app.test.tsx` |
| Reprise de la conversation après redémarrage | ✅ en test automatisé / ⏳ en réel | `main-session.test.ts`, `json-conversation-store.test.ts` |

## Blocage 1 — Jeton GitHub refusé par Copilot

- **Constat** : `gh` est connecté avec un jeton personnel classique (`ghp_…`). L'API Copilot répond
  `400 Bad Request` : « Personal Access Tokens are not supported for this endpoint ».
- **Impact** : aucun tour d'agent réel possible. L'authentification elle-même fonctionne
  (`getAuthStatus` → `isAuthenticated: true`), mais tout appel de modèle échoue.
- **Levée** : se reconnecter par le navigateur pour obtenir un jeton OAuth (`gho_…`) :
  ```bash
  gh auth login --web --hostname github.com --git-protocol https
  pnpm smoke:copilot
  ```
  Alternative : un PAT à grain fin doté de la permission « Copilot Requests ».
- **Déjà fait** : `github-auth` détecte la nature du jeton (`tokenKind`) ; l'application refuse de démarrer
  la conversation avec un PAT classique et propose la reconnexion (ADR 0005).

## Blocage 2 — Electron ne démarre pas sur la machine de développement

- **Constat** : `error while loading shared libraries: libatk-1.0.so.0`. La machine n'a ni GTK ni écran
  (`DISPLAY` vide).
- **Impact** : l'interface n'a jamais été vue à l'écran. Elle n'est couverte que par les tests du
  renderer sous jsdom et par le build `electron-vite`.
- **Levée**, au choix :
  - lancer `pnpm dev` sur un poste de bureau (Linux avec GTK, macOS ou Windows) ;
  - ou installer les dépendances d'exécution d'Electron et un serveur X virtuel (droits administrateur) :
    `sudo apt install libatk1.0-0 libatk-bridge2.0-0 libgtk-3-0 libnss3 libxss1 libasound2t64 xvfb`,
    puis `xvfb-run pnpm dev`.

## Points à surveiller (non bloquants)

- `koffi`, une dépendance du Copilot SDK utilisée seulement par le transport en processus
  expérimental, a un script de build ignoré par pnpm. Il n'est pas utilisé (transport stdio).
- La purge des vieux checkpoints (`refs/agent-studio/checkpoints/*`) n'est pas encore faite (ADR 0003).
- La persistance JSON de la conversation est provisoire (O6, ADR 0004).
