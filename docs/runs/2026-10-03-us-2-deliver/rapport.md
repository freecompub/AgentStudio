# Run skraft — US-2.md — 2026-10-03 — reprise à DELIVER (arrêtée)

- Base : `run/us-2-2026-10-03-2973` (DISTILL validée), `--depuis=DELIVER`
- Code produit poussé sur `run/us-2-2026-10-03-deliver` (11 tests verts)
- Arrêté à la main pendant le 3ᵉ essai de correction : le défaut de revue exigeait des tests unitaires, gelés en mode correction.
- Durée : 5m08, 13 tours, 2 rejets, 164.6 requêtes premium (76 appels)

| Étape | Durée | Tours | Rejets | Appels | Requêtes premium |
|---|---|---|---|---|---|
| CLASSIFY | 0m22 | 1 | 0 | 7 | 9.6 |
| CONFIRM_DIFFICULTY | 0m00 | 0 | 0 | 0 | 0 |
| ROUTE | 0m00 | 0 | 0 | 0 | 0 |
| DELIVER | 2m16 | 2 | 0 | 20 | 26.9 |
| REVIEW | 1m02 | 4 | 0 | 33 | 53.2 |
| DELIVER | 0m52 | 1 | 1 | 5 | 18 |
| REVIEW | 0m11 | 4 | 0 | 8 | 48 |
| DELIVER | 0m25 | 1 | 1 | 3 | 8.8 |

## Rejets

### DELIVER — « revue »

- [cold-reader, major] Un seul scénario est testé (seuil exactement atteint, un seul palier). Le comportement implémenté dans GrilleDePaliers.PalierApplicable gère pourtant plusieurs cas non couverts ici : quantité en dessous de tout seuil (doit renvoyer null), grille vide, et plusieurs paliers applicables où celui au taux le plus élevé doit être retenu (MaxBy). Sans ces tests, un lecteur ne peut pas vérifier que la règle métier annoncée dans le commentaire de classe est réellement garantie au-delà du cas trivial. (tests/Tarification.Tests/GrilleDePaliersTests.cs:15)

### DELIVER — « revue »

- [cold-reader, major] La suite de tests ne couvre qu'un seul scénario (seuil exactement atteint, un seul palier dans la grille). Le commentaire XML de PalierApplicable annonce pourtant explicitement trois autres comportements distincts : quantité sous tout seuil renvoyant null (@ac-1), grille vide renvoyant null (@ac-5), et choix du palier au taux le plus avantageux quand plusieurs seuils sont atteints (@ac-3). Aucun test ne verrouille ces trois comportements documentés ; un lecteur du dépôt ne peut donc pas vérifier que la règle métier annoncée est réellement garantie au-delà du cas trivial, et une régression sur MaxBy ou sur la grille vide passerait inaperçue. (tests/Tarification.Tests/GrilleDePaliersTests.cs:15)
