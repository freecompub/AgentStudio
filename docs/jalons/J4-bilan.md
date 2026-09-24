# J4 — Bilan

- Date : 2026-09-23
- Branche : `feat/j4-isolation-extensions` (partie de `feat/j3-preuves-interactions`)
- État : **critères de sortie vérifiés sur de vrais processus Node, sans LLM**, et l'exécution sous
  `utilityProcess` dans Electron est confirmée depuis le 2026-09-24.

## Critères de sortie (SPEC §14)

| Critère | État | Preuve |
| --- | --- | --- |
| L'extension `tdd` tourne hors du processus principal sans perte de fonction | ✅ | `extensions/tdd/test/e2e-cycle.test.ts` et `e2e-j3.test.ts` : les 6 scénarios de J2 et J3 passent aussi en mode `isolated` (processus Node distinct sous `--permission`) |
| Une permission non déclarée est refusée | ✅ | `packages/extension-host/test/isolated-host.test.ts` : `git:commit` non déclarée → refus ; lecture de `/etc/hostname` → `ERR_ACCESS_DENIED` (second rempart) |
| Un hook qui plante n'autorise rien | ✅ | même fichier (hook qui lève, hook qui ne répond jamais) ; `permission-arbiter.test.ts` ; `app-controller.test.ts` (session principale) |

## Livré

| Brique | Contenu |
| --- | --- |
| `packages/extension-manifest` | Schéma du manifeste, semver de `engines.appApi`, cohérence des permissions |
| `packages/task-engine` | Définitions de tâche asynchrones |
| `packages/extension-host` | RPC, runtime enfant, hôte isolé et supervision, lanceur Node, hooks, bundle |
| `packages/core` | Registre des hooks, arbitre de permissions, règles « toujours autoriser » |
| `extensions/tdd` | Entrée compilée `dist/index.mjs` ; tests de bout en bout dans les deux modes |
| `apps/desktop` | Build des extensions internes, chargeur validant, lanceur `utilityProcess`, arbitre de la session principale, dialogue « Toujours autoriser » |

ADR : 0009.

## Risques et limites

- ~~**Non vérifié** : dans Electron, le comportement de `utilityProcess.fork` avec `--permission`.~~
  **Levé le 2026-09-24** : sur macOS, `pnpm dev` active les deux extensions internes dans leur
  propre processus (`extension activée (processus isolé)`, un pid par extension). Le repli par
  `execArgv` restreint ou `child_process.fork` n'est pas nécessaire.
- Le bundle de `tdd` embarque une partie du cœur (classes d'erreur) : environ 765 Ko. À réduire en
  exposant ces erreurs dans `extension-api`.
- Pas encore de signature ni d'installation depuis un fichier (J6).
- ~~Hérité de J1~~ : les deux blocages de J1 sont levés (`J1-blocages.md`).
