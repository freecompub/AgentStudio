# S4 — Bilan

- Date : 2026-09-23
- Branche : `feat/s4-skraft-distill` (partie de `feat/s3-skraft-design`)
- État : **critères de sortie vérifiés, agents simulés, vrai Vitest.**

## Critères de sortie (SPEC-skraft §14)

| Critère | État | Preuve |
| --- | --- | --- |
| Fixture valeurs traitée | ✅ | `distill-gates.test.ts` ; `e2e-s4.test.ts` : scénario 2 écrit avec « 12 U », rejeté en nommant le critère 2 et la valeur « 12,5 U », puis corrigé |
| Fixture RED traitée | ✅ | `distill-gates.test.ts` (assertion et symbole manquant acceptés, erreur de syntaxe rejetée) ; `e2e-s4.test.ts` : ac-3 déjà vert rejeté sans justification, accepté une fois requalifié en non-régression ; preuve `DISTILL_RED` produite par `run_tests` |
| Empreinte enregistrée | ✅ | `e2e-s4.test.ts` : `acceptanceHash` (SHA-256) et `regressions` dans l'état ; réducteur : gel écrit une seule fois |

## Livré

- `StackLayout` sur les adaptateurs et alias `@stack:*` résolus par l'hôte.
- `ctx.workspace.fingerprint(globs)` et `ctx.stack.layout`.
- Portes valeurs et RED d'acceptance ; tests d'acceptance gelés.

ADR : 0016.

## Limites

- Le test de bout en bout US-12 sur Swift reste simulé (faux `runTests`) ; l'exécution réelle de
  la chaîne Swift est couverte à partir de S5.
