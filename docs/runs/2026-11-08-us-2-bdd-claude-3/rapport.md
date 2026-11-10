# Run réel US-2 en BDD, runtime Claude, par le serveur MCP — 2026-11-08, troisième run

- **Départ** : `main` GitHub d'`exemple-dotnet-tdd` (`19583a4 bdd`), comme les deux runs précédents.
  Serveur MCP reconstruit au commit `991df12` (PR #25 : noms du modèle donnés à l'architecte qui
  décide), qui contient aussi tout le travail de la PR #24 (questions de la story avant RESEARCH, BDD
  muet bloqué, etc.).
- **Pile** : celle du second run (`pile.yaml` : BDD Reqnroll, `{rapports}`, couverture, Stryker, format).
- **Résultat** : fini, **15m05, 2 rejets, 5,12 $** ; ADR-003 ratifié ; `.feature` de l'US-1 intact ;
  `dotnet test` 10/10.

## Étapes

| Étape | Essai | Début | Fin | Durée | Tours | Rejets | Coût | Modèles |
|---|---|---|---|---|---|---|---|---|
| INIT | 1 | 23:20:51 | 23:21:05 | 0m14 | 0 | — | 0.0000 $ |  |
| CLASSIFY | 1 | 23:21:05 | 23:21:13 | 0m08 | 1 | — | 0.0019 $ | claude-haiku-5-5 |
| CONFIRM_DIFFICULTY | 1 | 23:21:13 | 23:21:21 | 0m08 | 0 | — | 0.0000 $ |  |
| ROUTE | 1 | 23:21:21 | 23:21:37 | 0m15 | 0 | — | 0.0000 $ |  |
| RESEARCH | 1 | 23:21:37 | 23:22:22 | 0m46 | 1 | citations : `Steps/ChiffrageDuPanierSteps.cs` : fichier inexistant dans le dépôt. | 0.1668 $ | claude-sonnet-5-5 |
| RESEARCH | 2 | 23:22:22 | 23:22:46 | 0m24 | 1 | — | 0.2361 $ | claude-sonnet-5-5 |
| ROUTE | 2 | 23:22:46 | 23:22:53 | 0m07 | 0 | — | 0.0000 $ |  |
| DESIGN | 1 | 23:22:53 | 23:26:46 | 3m53 | 2 | cohérence : context-map.md : la relation « `A` → `B` » ne nomme aucun patron (ACL, Conformist, Shared Kernel, Customer-Supplier, Open Host Service, Published Language, Partnership, Separate Ways). ; context-map.md : le contexte `A` n'est classé ni Core, ni Supporting, ni Generic (une ligne « `A` : Core \| Supporting \| Generic »). ; context-map.md : le contexte `B` n'est classé ni Core, ni Supporting, ni Generic (une ligne « `B` : Core \| Supporting \| Generic »). | 1.3603 $ | claude-opus-5-5 |
| DESIGN | 2 | 23:26:46 | 23:27:22 | 0m36 | 2 | — | 1.5782 $ | claude-opus-5-5 |
| REVIEW | 1 | 23:27:22 | 23:28:01 | 0m39 | 3 | — | 0.2303 $ | claude-sonnet-5-5 |
| RATIFICATION | 1 | 23:28:01 | 23:28:09 | 0m08 | 0 | — | 0.0000 $ |  |
| DISTILL | 1 | 23:28:09 | 23:29:51 | 1m41 | 1 | — | 0.3275 $ | claude-sonnet-5-5 |
| REVIEW | 2 | 23:29:51 | 23:31:39 | 1m48 | 5 | — | 0.5137 $ | claude-sonnet-5-5, claude-haiku-5-5, claude-opus-5-5 |
| DELIVER | 1 | 23:31:39 | 23:34:36 | 2m58 | 2 | — | 0.2120 $ | claude-sonnet-5-5 |
| REVIEW | 3 | 23:34:36 | 23:35:56 | 1m20 | 4 | — | 0.4964 $ | claude-sonnet-5-5, claude-haiku-5-5 |
| DONE | 1 | 23:35:56 | 23:35:56 | 0m00 | 0 | — | 0.0000 $ |  |

Total : 15m05, 2 rejet(s), 5.1232 $

## Comparaison

| | Premier run | Second run | Troisième run |
|---|---|---|---|
| Durée | 23m28 | 16m13 | 15m05 |
| Rejets | 8 | 1 | 2 |
| Coût | 12,18 $ | 5,18 $ | 5,12 $ |
| DESIGN | 6 essais, 7,98 $ | 2 essais, 3,20 $ | 2 essais, 2,94 $ |
| Question du chercheur (`blocker`) | oui | oui | **non** (posée avant RESEARCH) |
| Refus « nom cité absent du modèle » | 4 essais | 1 | **0** |

## Constats

- **Plus de refus sur les noms du modèle** : la liste donnée à l'architecte qui décide a joué.
- **Plus de question bloquante du chercheur** : la question ouverte de la story est posée en `ROUTE`
  avant RESEARCH.
- **Rejet DESIGN 1 : faux positif de la porte de cohérence.** `context-map.md` disait « aucune flèche
  `A` → `B` à qualifier » ; la porte a lu ce texte comme une relation entre deux contextes `A` et `B`
  (patron manquant, contextes non classés). L'architecte du modèle l'a reformulé (trace). Coût : le
  second essai de DESIGN, 1,58 $. À corriger dans la porte.
- **Rejet RESEARCH 1 : erreur de l'agent.** Citation `Steps/ChiffrageDuPanierSteps.cs` au lieu de
  `tests/Tarification.UnitTests/Steps/…`. La porte a raison ; un tour de plus (≈ 0,17 $). Piste : le
  motif pourrait proposer le chemin complet quand un seul fichier du dépôt se termine ainsi.
- DELIVER : comme au second run, un seul pas (`ac-2` couvert par l'acceptance) ; `ac-3` déjà vert
  (noté) ; mutation de fin passée, 5 survivants anciens de `Montant.cs` notés hors du changement.
