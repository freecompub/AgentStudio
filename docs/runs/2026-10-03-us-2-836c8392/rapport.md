# Run skraft — US-2.md — 2026-10-03

- Projet : `/home/diabeo/Projets/exemple-dotnet-tdd`, branche poussée `run/us-2-2026-10-03-9362`
- État final : DONE / —
- Durée : 4m38, 12 tours, 1 rejets, 1747091 tokens d'entrée
- Requêtes premium : 152.5 d'après le SDK (70 appels), écart de réserve 105

## Étapes

| Étape | Durée | Tours | Rejets | Fins anormales | Appels | Requêtes premium | Tokens entrée |
|---|---|---|---|---|---|---|---|
| CLASSIFY | 0m21 | 1 | 0 |  | 7 | 8 | 138030 |
| CONFIRM_DIFFICULTY | 0m00 | 0 | 0 |  | 0 | 0 | 0 |
| ROUTE | 0m00 | 0 | 0 |  | 0 | 0 | 0 |
| DELIVER | 2m00 | 2 | 0 |  | 15 | 28.1 | 425256 |
| REVIEW | 1m08 | 4 | 0 |  | 31 | 51.6 | 718438 |
| DELIVER | 0m39 | 1 | 1 |  | 4 | 17.4 | 136807 |
| REVIEW | 0m25 | 4 | 0 |  | 13 | 47.4 | 328560 |
| DELIVER | 0m00 | 0 | 0 |  | 0 | 0 | 0 |
| DONE | 0m00 | 0 | 0 |  | 0 | 0 | 0 |

## Rejets et leurs motifs

### DELIVER — porte « revue »

- [quality-gates#1.1, major, test] L'opérateur `+` (ligne 17) et `Soustrait` (ligne 25) ne sont exercés par aucun test — ils ne servent qu'à `Facture.ATPayer` (Tarification.Application/CalculDuPanier.cs), dont l'impl-plan DISTILL reconnaît explicitement qu'« aucun AC ne porte de valeur explicite sur ATPayer » et que la correction « n'est exercée par aucun test d'acceptance gelé ». Ce n'est pas un cas de l'ADR 0045 (pas de duplication d'un test d'acceptance existant) : c'est un comportement livré sans aucune preuve rouge→vert, ce qui explique une partie du déficit de couverture mesuré sur Montant.cs (70 %, 7/10 lignes). (src/Tarification.Domaine/Montant.cs:17)
- Réponds à chaque défaut ci-dessus dans le champ `responses` de report_phase : `fixed` si tu l'as corrigé, `contested` avec ta raison si tu estimes qu'il ne faut pas le corriger, `outOfScope` avec ta raison s'il est juste mais que sa correction n'est pas de ton ressort. Un défaut maintenu après contestation doit être corrigé ; le contester encore soumet le désaccord à l'humain.

## Relevés de réserve

- 2026-10-03T13:13:29.948Z — départ : 320
- 2026-10-03T13:13:30.042Z — CLASSIFY : 320
- 2026-10-03T13:13:50.966Z — CONFIRM_DIFFICULTY : 320
- 2026-10-03T13:13:50.980Z — ROUTE : 320
- 2026-10-03T13:13:50.987Z — DELIVER : 320
- 2026-10-03T13:15:50.718Z — REVIEW : 284
- 2026-10-03T13:16:58.993Z — DELIVER : 233
- 2026-10-03T13:17:37.766Z — REVIEW : 215
- 2026-10-03T13:18:02.921Z — DELIVER : 215
- 2026-10-03T13:18:02.989Z — DONE : 215
- 2026-10-03T13:18:06.229Z — fin : 215
