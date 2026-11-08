# Run réel US-2 en BDD, runtime Claude, par le serveur MCP — 2026-11-08, second run

- **Départ** : `main` GitHub d'`exemple-dotnet-tdd` (`19583a4 bdd`), comme le premier run du jour.
  Serveur MCP reconstruit avec les corrections du jour (`7e4dec2` cohérence `Panier`, `ebed88f` Gherkin
  de la story, `18edb54` tests de la story, `6f0e8a4` mutation sur les lignes modifiées).
- **Pile** (`pile.yaml`) : celle du premier run, plus `mutation` (Stryker.NET 4.14.1, configuration du
  projet) et `format` (`dotnet format --verify-no-changes`).
- **Résultat** : fini, **16m13, 1 rejet, 5,18 $** (premier run : 23m28, 8 rejets, 12,18 $) ;
  ADR-003 **rédigé et ratifié** (abandonné au premier run) ; `dotnet test` 10/10.

## Étapes

| Étape | Essai | Début | Fin | Durée | Tours | Rejets | Coût | Modèles |
|---|---|---|---|---|---|---|---|---|
| INIT | 1 | 15:26:59 | 15:27:14 | 0m15 | 0 | — | 0.0000 $ |  |
| CLASSIFY | 1 | 15:27:14 | 15:27:21 | 0m07 | 1 | — | 0.0016 $ | claude-haiku-5-5 |
| CONFIRM_DIFFICULTY | 1 | 15:27:21 | 15:27:29 | 0m08 | 0 | — | 0.0000 $ |  |
| RESEARCH | 1 | 15:27:29 | 15:27:56 | 0m27 | 1 | — | 0.0901 $ | claude-sonnet-5-5 |
| BLOCKED | 1 | 15:27:56 | 15:27:59 | 0m03 | 0 | — | 0.0000 $ |  |
| RESEARCH | 2 | 15:27:59 | 15:28:59 | 0m59 | 1 | — | 0.2033 $ | claude-sonnet-5-5 |
| ROUTE | 1 | 15:28:59 | 15:29:01 | 0m02 | 0 | — | 0.0000 $ |  |
| DESIGN | 1 | 15:29:01 | 15:33:03 | 4m02 | 2 | cohérence : `ArgumentNullException` cité dans contracts.md n'existe pas dans event-model.md ni dans domain-model.md. | 1.3270 $ | claude-opus-5-5 |
| DESIGN | 2 | 15:33:03 | 15:34:59 | 1m56 | 2 | — | 1.8693 $ | claude-opus-5-5 |
| REVIEW | 1 | 15:34:59 | 15:35:52 | 0m53 | 3 | — | 0.2570 $ | claude-sonnet-5-5 |
| RATIFICATION | 1 | 15:35:52 | 15:36:03 | 0m11 | 0 | — | 0.0000 $ |  |
| DISTILL | 1 | 15:36:03 | 15:37:22 | 1m19 | 1 | — | 0.2604 $ | claude-sonnet-5-5 |
| REVIEW | 2 | 15:37:22 | 15:38:43 | 1m22 | 4 | — | 0.4045 $ | claude-sonnet-5-5, claude-haiku-5-5 |
| DELIVER | 1 | 15:38:43 | 15:41:42 | 2m58 | 2 | — | 0.2153 $ | claude-sonnet-5-5 |
| REVIEW | 3 | 15:41:42 | 15:43:11 | 1m29 | 4 | — | 0.5476 $ | claude-sonnet-5-5, claude-haiku-5-5 |
| DONE | 1 | 15:43:11 | 15:43:11 | 0m00 | 0 | — | 0.0000 $ |  |

Total : 16m13, 1 rejet(s), 5.1761 $

## Comparaison avec le premier run

| | Premier run | Second run |
|---|---|---|
| Durée | 23m28 | 16m13 |
| Rejets | 8 | 1 |
| Coût | 12,18 $ | 5,18 $ |
| DESIGN | 6 essais, escalade, 7,98 $ | 2 essais, 3,20 $ |
| ADR-003 | abandonné | ratifié |
| DISTILL | 4 essais, `.feature` de l'US-1 renommé | 1 essai, US-1 intact |
| Scénarios DELIVER | 8 pour 5 critères | 5 pour 5 critères |
| Mutation | non mesurée | mesurée, survivants anciens notés |

## Constats

- **Corrections vérifiées en réel** : aucun refus sur `Panier` ; le `.feature` de l'US-1 est intact ;
  ses tests ne sont ni comptés comme critères ni comme scénarios ; la mutation de fin de DELIVER a
  tourné, et les 5 survivants de `Montant.cs` (lignes 14, 21, 27, d'avant la story) sont notés hors
  du changement, sans bloquer.
- **Seul rejet** : DESIGN 1, « `ArgumentNullException` cité dans contracts.md n'existe pas dans les
  modèles ». C'est un type du framework, pas un concept du domaine : la règle exige du modèle tout nom
  composé cité par les contrats. À examiner (faux positif probable).
- **Toujours aucun test unitaire** : `tests/Tarification.Tests` inchangé. Deux scénarios pilotes
  (`ac-2`, `ac-3`), un seul pas commité (`ac-2`) ; `ac-1`, `ac-4`, `ac-5` requalifiés en non-régression
  (la remise valait 0,00 €). Les mutants des lignes de la story ont été tués par les scénarios.
- **Notes des lentilles** : le commentaire de `Facture` (`CalculDuPanier.cs:6`) dit encore que les
  remises restent à zéro ; la justification de la requalification dans `test-plan.md` (« remise à
  0,00 € en dur ») n'est plus vraie après DELIVER.
