# S6 — Bilan

- Date : 2026-09-23
- Branche : `feat/s6-skraft-review` (partie de `feat/s5-skraft-deliver`)
- État : **critères de sortie vérifiés avec des agents simulés, sur une vraie chaîne Swift pour 13.3.**
  Les mesures réelles restent bloquées (voir Limites).

## Critères de sortie (SPEC-skraft §14)

| Critère | État | Preuve |
| --- | --- | --- |
| Verdict reproductible depuis les mêmes JSON | ✅ | `review-brief.test.ts` (`replayReview`) ; `e2e-s6.test.ts` : JSON et rapports commités, y compris ceux d'une revue suivie d'un rollback, rejoués à l'identique |
| Bout en bout 13.3 vert | ✅ | `e2e-s6.test.ts` (SwiftPM + XCTest réels) : `medium-hard` confirmé ; citation hors limites rejetée ; question « par prise ou par jour » tranchée ; incohérence `BolusLimited` rejetée ; ADR-001 ratifié par l'architecte ; « 12 U » rejeté ; scénario 3 requalifié ; ac-1 et ac-2 livrés ; modification de test refusée puis détectée ; défaut `major` corrigé par une relance ciblée ; DONE avec bilan |
| Mesures sur trois stories | ⚠️ mécanisme vérifié | `e2e-s6.test.ts` : US-7 (simple), US-12 (assez difficile), US-15 (difficile) ; requêtes et tokens par état, réessais, granularité (sessions séparées : plus de requêtes en DELIVER). Mesures issues d'agents simulés |

## Livré

- Faits établis joints aux lentilles, et contexte propre à chaque lentille.
- Rapports reproductibles.
- Correction ciblée après la revue de DELIVER.
- Réessais par phase.

ADR : 0018.

## Limites

- **Mesures réelles** : la comparaison sur US-12 et deux stories réelles exige un run Copilot.
  ~~Bloqué par le jeton et par l'absence de GTK.~~ **Débloqué le 2026-09-24** (`J1-blocages.md`) :
  ce run reste à faire.
- Mutation Swift simulée. ~~Pas de Muter sous Linux.~~ Muter est un outil macOS : son exécution
  réelle est désormais possible sur le poste de développement.
- Table de pondération des lentilles : attend la décision de licence O9/D42 (S0, ADR 0012).
