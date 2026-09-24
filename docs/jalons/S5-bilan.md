# S5 — Bilan

- Date : 2026-09-23
- Branche : `feat/s5-skraft-deliver` (partie de `feat/s4-skraft-distill`)
- État : **critères de sortie vérifiés sur une vraie chaîne Swift, agents simulés.**

## Critères de sortie (SPEC-skraft §14)

| Critère | État | Preuve |
| --- | --- | --- |
| US-12 livrée sur le projet Swift de démonstration | ✅ | `e2e-s5.test.ts` : SwiftPM + XCTest réels ; DISTILL rouge, ac-3 en non-régression, ac-1 livré en TDD (rouge sur symbole manquant, puis vert), ac-2 vert à la porte, revue, commits `test:`, `feat:`, livraison |
| Modification de test refusée | ✅ | `e2e-s5.test.ts` : la garde refuse l'écriture du test à `skraft-dev` ; `in-process-host.test.ts` (garde `readOnly`) |
| … puis détectée par empreinte | ✅ | `e2e-s5.test.ts` : test affaibli hors outils, tour annulé par rollback, relance avec le motif, aucun commit du test modifié |
| Porte de fin de scénario | ✅ | `deliver-gates.test.ts` (séquence, mutation, dépendances, calisthenics) ; `e2e-s5.test.ts` : mutation à 50 % refusée avec les survivants, scénario repris en sessions séparées |
| Deux granularités | ✅ | `reducer.test.ts` (sous-machine DELIVER, invariants sur 400 suites aléatoires) |

## Livré

- `readOnly` sur `agents.run` ; `ctx.stack.mutation()` et `ctx.stack.architecture()`.
- Identifiants Swift conformes au protocole.
- Sous-machine DELIVER et barre de qualité `.skraft/quality.json`.

ADR : 0017.

## Limites

- Mutation Swift simulée. ~~Pas de Muter sous Linux.~~ Possible sur macOS depuis le 2026-09-24.
- S-O2 non tranché (revue après le dernier scénario).
