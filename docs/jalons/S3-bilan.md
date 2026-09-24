# S3 — Bilan

- Date : 2026-09-23
- Branche : `feat/s3-skraft-design` (partie de `feat/s2-skraft-research`)
- État : **critères de sortie vérifiés, agents simulés.**

## Critères de sortie (SPEC-skraft §14)

| Critère | État | Preuve |
| --- | --- | --- |
| Fixture cohérence rejetée | ✅ | `design-gate.test.ts` (`BolusLimited` absent du modèle, ADR existant modifié…) ; `e2e-s3.test.ts` (rejet précis puis correction) |
| DISTILL inatteignable avant ratification | ✅ | `e2e-s3.test.ts` : stage RATIFICATION, agent d'acceptance jamais lancé, refus d'un PO, acceptation par l'architecte puis DISTILL ; invariant 7 du réducteur |
| `amend` relance le bon rôle | ✅ | `e2e-s3.test.ts` : seule `skraft-architect-decide` est relancée, avec la demande ; ADR amendé au même numéro |

## Livré

Outils d'extension (`ctx.tools`), `render_adr`, porte cohérence, statuts d'ADR basculés à la
ratification. ADR : 0015.
