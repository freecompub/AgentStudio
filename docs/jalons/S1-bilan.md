# S1 — Bilan

- Date : 2026-09-23
- Branche : `feat/s1-skraft-pipeline` (partie de `feat/s0-licence-skraft`, elle-même partie de J6)
- État : **critères de sortie vérifiés, agents simulés.**

## Préalable S0

La décision de licence (O9 / D42) est **en attente** : voir l'ADR 0012. Aucun contenu de skraft-plugin
n'est repris ; les rôles utilisent des prompts de substitution.

## Critères de sortie (SPEC-skraft §14)

| Critère | État | Preuve |
| --- | --- | --- |
| Tous les tests 13.1 verts | ✅ | `extensions/skraft/test/` : réducteur (chaque ligne de §5.2), invariants, grille (US-12 → `medium-hard`), synthèse de revue, littéraux et normalisation, citations, identifiants `PascalCase` |
| Pipeline complet à vide avec agents simulés | ✅ | `e2e-s1.test.ts` : quatre phases, revues, rapports générés, commits sur `skraft/us-12`, bilan ; en processus **et** extension isolée |
| Saut de RESEARCH par règle | ✅ | même fichier : story simple, DESIGN en premier, deux lentilles, budget 2 |
| Reprise après redémarrage à chaque stage | ✅ | même fichier : INIT, CLASSIFY, CONFIRM_DIFFICULTY, SPECIALIST (RESEARCH, DESIGN, DELIVER), ARTIFACT_GATE, REVIEW, COMMIT ; BLOCKED répondu après redémarrage ; aucune phase commitée deux fois |

## Limites

- RATIFICATION et ESCALATED ne sont testés qu'au niveau du réducteur : aucun ADR n'est produit avant `render_adr` (S3).
- Les portes spécifiques aux phases viennent de S2 à S5.
