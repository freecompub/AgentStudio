# J5 — Bilan

- Date : 2026-09-23
- Branche : `feat/j5-swift-usage` (partie de `feat/j4-isolation-extensions`)
- État : **critères de sortie vérifiés avec une vraie chaîne Swift 6.1.2, agents scriptés.**

## Critères de sortie (SPEC §14)

| Critère | État | Preuve |
| --- | --- | --- |
| `/tdd` sur un projet Swift | ✅ chaîne réelle, agents scriptés | `extensions/tdd/test/e2e-j5-swift.test.ts` : SwiftPM + XCTest, rouge par symbole manquant, puis vert, commits `test:` puis `feat:` |
| Usage affiché par état | ✅ | même test (requêtes, tokens, durée, effets par état) ; `workspace-services.test.ts` (carte) ; `app.test.tsx` (tableau par état dans la carte) |

## Livré

| Brique | Contenu |
| --- | --- |
| `packages/stack-adapters` | Adaptateur Swift (XCTest, JUnit, erreurs de compilation), analyse des imports, lecture de Muter, sélection par détection, chaîne locale |
| `packages/core` | Événement `usage`, décompte par tour, enregistreur d'usage persistant |
| `packages/task-engine` | Durée et effets par état, `phaseOf` |
| `packages/extension-host` | Usage des agents attribué à la tâche et à son état |
| `extensions/tdd` | Réessais par état, planificateur rattaché à sa tâche |
| `apps/desktop` | Choix automatique de la stack, usage dans la carte de tâche |

ADR : 0010.

## Environnement de développement

La chaîne Swift a été installée **hors système** dans `~/.cache/agent-studio/swift` (environ 3 Go), avec
un dossier `compat/` : lien vers `libxml2.so.16`, objets GCC 16 extraits de paquets `.deb`, `ld.lld`.
Pour la supprimer : `rm -rf ~/.cache/agent-studio/swift`.

## Limites connues

- **Muter non exécuté** : la lecture de son rapport suit sa documentation ; à valider avant S5.
- Décompte des requêtes Copilot : un prompt × multiplicateur du modèle, à confirmer selon l'offre.
- L'usage de la session principale n'est pas encore mesuré.
- Hérité de J1 : jeton `gh` refusé par Copilot, Electron non lançable sur la machine de développement.
