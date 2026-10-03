# Run skraft — US-2.md — 2026-10-03

- Projet : `/home/diabeo/Projets/exemple-dotnet-tdd`, branche poussée `run/us-2-2026-10-03-2973`
- État final : ABORTED / DELIVER
- Durée : 14m02, 20 tours, 2 rejets, 4498666 tokens d'entrée
- Requêtes premium : 404.2 d'après le SDK (111 appels), écart de réserve 405

## Étapes

| Étape | Durée | Tours | Rejets | Fins anormales | Appels | Requêtes premium | Tokens entrée |
|---|---|---|---|---|---|---|---|
| CLASSIFY | 0m13 | 1 | 0 |  | 4 | 6.6 | 73053 |
| CONFIRM_DIFFICULTY | 0m00 | 0 | 0 |  | 0 | 0 | 0 |
| RESEARCH | 1m32 | 1 | 0 |  | 7 | 19.9 | 172571 |
| ROUTE | 0m00 | 0 | 0 |  | 0 | 0 | 0 |
| DESIGN | 0m29 | 1 | 0 |  | 5 | 14.6 | 160923 |
| BLOCKED | 0m00 | 0 | 0 |  | 0 | 0 | 0 |
| DESIGN | 5m24 | 4 | 1 |  | 32 | 130.7 | 1686747 |
| REVIEW | 0m56 | 3 | 0 |  | 14 | 38.7 | 334058 |
| DESIGN | 0m00 | 0 | 0 |  | 0 | 0 | 0 |
| DISTILL | 3m35 | 1 | 0 |  | 15 | 53.8 | 814353 |
| REVIEW | 0m41 | 4 | 0 |  | 20 | 64 | 590375 |
| DISTILL | 0m34 | 1 | 1 |  | 5 | 31.8 | 289148 |
| REVIEW | 0m16 | 4 | 0 |  | 9 | 44.1 | 377438 |
| DISTILL | 0m00 | 0 | 0 |  | 0 | 0 | 0 |
| DELIVER | 0m08 | 0 | 0 |  | 0 | 0 | 0 |
| ESCALATED | 0m00 | 0 | 0 |  | 0 | 0 | 0 |
| DELIVER | 0m07 | 0 | 0 |  | 0 | 0 | 0 |
| ESCALATED | 0m00 | 0 | 0 |  | 0 | 0 | 0 |
| DELIVER | 0m06 | 0 | 0 |  | 0 | 0 | 0 |
| ESCALATED | 0m00 | 0 | 0 |  | 0 | 0 | 0 |
| ABORTED | 0m00 | 0 | 0 |  | 0 | 0 | 0 |

## Rejets et leurs motifs

### DESIGN — porte « cohérence »

- `PalierApplicable` cité dans contracts.md n'existe pas dans event-model.md ni dans domain-model.md.

### DISTILL — porte « revue »

- [cold-reader, major] `Facture.ATPayer` ne soustrait toujours pas `Remise` (`SommeDesArticles + FraisDePort`), alors que `Facture.Remise` peut désormais être non nulle via `CalculDuPanier.Chiffrer(Panier, GrilleDePaliers)`. Un lecteur qui découvre uniquement le code (sans le journal de phase) y verra un total facturé incohérent avec le champ `Remise` qu'il expose juste à côté — le commentaire XML de `Facture` (« les remises... restent à zéro tant que les stories correspondantes ne sont pas livrées ») est maintenant obsolète puisque cette story livre justement le calcul de `Remise`. (src/Tarification.Application/CalculDuPanier.cs:10)

## Relevés de réserve

- 2026-10-03T10:07:55.269Z — départ : 1249
- 2026-10-03T10:07:55.346Z — CLASSIFY : 1249
- 2026-10-03T10:08:08.056Z — CONFIRM_DIFFICULTY : 1249
- 2026-10-03T10:08:08.074Z — RESEARCH : 1249
- 2026-10-03T10:09:39.591Z — ROUTE : 1222
- 2026-10-03T10:09:39.601Z — DESIGN : 1222
- 2026-10-03T10:10:08.762Z — BLOCKED : 1222
- 2026-10-03T10:10:08.774Z — DESIGN : 1222
- 2026-10-03T10:15:32.601Z — REVIEW : 1077
- 2026-10-03T10:16:28.185Z — DESIGN : 1038
- 2026-10-03T10:16:28.259Z — DISTILL : 1038
- 2026-10-03T10:20:03.346Z — REVIEW : 984
- 2026-10-03T10:20:44.430Z — DISTILL : 920
- 2026-10-03T10:21:18.554Z — REVIEW : 888
- 2026-10-03T10:21:34.065Z — DISTILL : 888
- 2026-10-03T10:21:34.221Z — DELIVER : 888
- 2026-10-03T10:21:41.778Z — ESCALATED : 888
- 2026-10-03T10:21:41.855Z — DELIVER : 888
- 2026-10-03T10:21:48.636Z — ESCALATED : 844
- 2026-10-03T10:21:48.696Z — DELIVER : 844
- 2026-10-03T10:21:54.954Z — ESCALATED : 844
- 2026-10-03T10:21:55.038Z — ABORTED : 844
- 2026-10-03T10:21:56.385Z — fin : 844
