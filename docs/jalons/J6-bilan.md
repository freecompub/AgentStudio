# J6 — Bilan

- Date : 2026-09-23
- Branche : `feat/j6-distribution-profils` (partie de `feat/j5-swift-usage`)
- État : **critères de sortie vérifiés en tests automatisés.** Le test d'usage avec une vraie personne
  non développeuse et la vérification dans Electron restent à faire (poste graphique).

## Critères de sortie (SPEC §14)

| Critère | État | Preuve |
| --- | --- | --- |
| Une extension tierce s'installe depuis un fichier | ✅ | `apps/desktop/test/third-party-install.test.ts` : compilation, empaquetage et signature par l'éditeur, installation depuis le fichier avec accord, chargement dans son propre processus, commande utilisable ; `extension-installer` (21 tests) ; `j6.test.tsx` (écran d'installation) |
| Un profil non développeur mène une tâche sans aide | ✅ parcours scripté | `apps/desktop/test/renderer/j6.test.tsx` : PO en mode simple, action guidée, décision en une phrase, suivi jusqu'à la fin, aucun détail technique affiché |

## Livré

| Brique | Contenu |
| --- | --- |
| `packages/extension-packaging` | Paquet `.asx`, signature Ed25519, lecture défensive, révocation signée, outils `ext:keys` et `ext:pack` |
| `packages/extension-installer` | Installation, mises à jour (accord si les permissions s'élargissent), révocation, désinstallation, permissions en langage clair |
| `packages/core` | Profils, politique de permissions par profil, demandes réservées à certains profils |
| `apps/desktop` | Configuration administrateur, écran Extensions et accord, modes simple et avancé, actions guidées, profil affiché |

ADR : 0011.

## Points ouverts

- **O5** : attribution des profils par un fichier administrateur, choix provisoire.
- Test d'usage réel avec un profil non développeur.
- Hérité de J1 : jeton `gh` refusé par Copilot, Electron non lançable sur la machine de développement.
