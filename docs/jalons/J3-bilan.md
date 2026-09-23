# J3 — Bilan

- Date : 2026-09-23
- Branche : `feat/j3-preuves-interactions` (partie de `feat/j2-moteur-taches`)
- État : **critères de sortie vérifiés en tests automatisés, sans LLM** ; validation avec le vrai
  Copilot et dans l'interface toujours bloquée par les points de J1 (`docs/jalons/J1-blocages.md`).

## Critères de sortie (SPEC §14)

| Critère | État | Preuve |
| --- | --- | --- |
| Preuves de rouge puis vert présentes pour chaque comportement | ✅ agents scriptés | `extensions/tdd/test/e2e-j3.test.ts` : deux comportements en tour unique, puis la bascule en mode strict ; séquence vérifiée dans le journal de preuves |
| Une escalade survit à un redémarrage et reprend après réponse | ✅ agents scriptés | même fichier : budget épuisé, nouveaux services sur les mêmes stockages, demande toujours présente, réponse « relancer », cycle terminé |

## Livré

| Brique | Contenu |
| --- | --- |
| Cœur | Demandes persistées, journal de preuves, battement du watchdog, `composeGuards`, rapporteur de progression |
| Hôte d'extension | Outil `run_tests`, preuves des portes, gel des tests dans le tour, `ctx.evidence` |
| Extension `tdd` | Tour unique par défaut (`tdd-pair`), porte du cycle, bascule en mode strict, `/tdd --strict`, commits `test:` puis `feat:` |
| Workspace | Commit limité à des chemins |
| Application | Demandes persistées par projet, jalons et alertes dans la conversation, notifications système |

ADR : 0008.

## Limites connues

- `run_tests` lance toujours toute la suite (pas encore de sous-ensemble).
- Pas de rappel ni de mise en pause automatique d'une demande restée sans réponse (§7.1).
- La vue des preuves dans l'interface (mode avancé) n'existe pas encore : elles ne sont lisibles que
  dans le journal `tasks/<projet>/evidence/<tâche>.jsonl`.
- Hérité de J1 : jeton `gh` refusé par Copilot, Electron non lançable sur la machine de
  développement.
