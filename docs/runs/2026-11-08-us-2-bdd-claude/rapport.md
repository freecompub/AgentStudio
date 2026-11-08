# Run réel US-2 en BDD, runtime Claude, par le serveur MCP — 2026-11-08

- **Départ** : `main` GitHub d'`exemple-dotnet-tdd` (`19583a4 bdd` : Reqnroll, `Features/`, `Steps/`,
  US-1 déjà en BDD), serveur MCP reconstruit le jour même (`feat/bdd`, `ab95c63`).
- **Commande** : `scripts/essai-mcp-skraft.ts <dépôt GitHub> stories/US-2.md docs/runs/reponses-us-2.json
  --runtime=claude --pile=pile.yaml`. Le `main` ne déclare pas de pile : elle est donnée par
  l'argument `pile` (`pile.yaml` ici : `{rapports}`, couple `bdd` Reqnroll).
- **Vérification préalable, sans LLM** : 5 tests relevés, six constats de `/stack doctor` `ok`
  (canari BDD compris) — après la correction `{rapports}` (ADR 0072 révisé).
- **Résultat** : fini, **23m28, 8 rejets, 12,18 $** ; aucun ADR ; `dotnet test` sur la branche :
  10/10 (2 xUnit, 8 scénarios Reqnroll).

## Étapes

| Étape | Essai | Début | Fin | Durée | Tours | Rejets | Coût | Modèles |
|---|---|---|---|---|---|---|---|---|
| INIT | 1 | 11:35:41 | 11:35:52 | 0m11 | 0 | — | 0.0000 $ |  |
| CLASSIFY | 1 | 11:35:52 | 11:36:01 | 0m09 | 1 | — | 0.0020 $ | claude-haiku-5-5 |
| CONFIRM_DIFFICULTY | 1 | 11:36:01 | 11:36:12 | 0m11 | 0 | — | 0.0000 $ |  |
| RESEARCH | 1 | 11:36:12 | 11:36:29 | 0m18 | 1 | — | 0.0921 $ | claude-sonnet-5-5 |
| BLOCKED | 1 | 11:36:29 | 11:36:42 | 0m13 | 0 | — | 0.0000 $ |  |
| RESEARCH | 2 | 11:36:42 | 11:37:25 | 0m43 | 1 | citations : `tests/Dosage.Tests` : fichier inexistant dans le dépôt. ; `.agent-studio/stack.yaml` : fichier inexistant dans le dépôt. | 0.1903 $ | claude-sonnet-5-5 |
| RESEARCH | 3 | 11:37:25 | 11:37:32 | 0m07 | 1 | — | 0.2115 $ | claude-sonnet-5-5 |
| ROUTE | 1 | 11:37:32 | 11:37:43 | 0m11 | 0 | — | 0.0000 $ |  |
| DESIGN | 1 | 11:37:43 | 11:41:26 | 3m42 | 2 | cohérence : `SommeDesArticles` cité dans contracts.md n'existe pas dans event-model.md ni dans domain-model.md. ; `FraisDePort` cité dans contracts.md n'existe pas dans event-model.md ni dans domain-model.md. ; `Panier`, Agrégat dans ADR-003, n'existe ni dans event-model.md ni dans domain-model.md. | 1.3128 $ | claude-opus-5-5 |
| DESIGN | 2 | 11:41:26 | 11:43:12 | 1m47 | 2 | cohérence : `Panier`, Agrégat dans ADR-003, n'existe ni dans event-model.md ni dans domain-model.md. | 2.0188 $ | claude-opus-5-5 |
| DESIGN | 3 | 11:43:12 | 11:44:03 | 0m50 | 2 | cohérence : `Panier`, Agrégat dans ADR-003, n'existe ni dans event-model.md ni dans domain-model.md. | 2.3449 $ | claude-opus-5-5 |
| DESIGN | 4 | 11:44:03 | 11:44:03 | 0m01 | 0 | — | 0.0000 $ |  |
| ESCALATED | 1 | 11:44:03 | 11:44:14 | 0m11 | 0 | — | 0.0000 $ |  |
| DESIGN | 5 | 11:44:14 | 11:47:34 | 3m19 | 2 | cohérence : `PrixUnitaire` cité dans contracts.md n'existe pas dans event-model.md ni dans domain-model.md. | 0.9087 $ | claude-opus-5-5 |
| DESIGN | 6 | 11:47:34 | 11:49:17 | 1m43 | 2 | — | 1.4042 $ | claude-opus-5-5 |
| REVIEW | 1 | 11:49:17 | 11:49:57 | 0m40 | 3 | — | 0.2329 $ | claude-sonnet-5-5 |
| RATIFICATION | 1 | 11:49:57 | 11:49:58 | 0m00 | 0 | — | 0.0000 $ |  |
| DISTILL | 1 | 11:49:58 | 11:51:14 | 1m16 | 1 | gherkin : tests/Tarification.UnitTests/Features/panier-chiffrage.feature : le titre du scénario « Le client chiffre une ligne de plusieurs articles » (@ac-1) doit commencer par « AC-1 » : c'est ce qui le relie à son test. ; tests/Tarification.UnitTests/Features/panier-chiffrage.feature : le titre du scénario « Le client chiffre plusieurs lignes » (@ac-2) doit commencer par « AC-2 » : c'est ce qui le relie à son test. ; tests/Tarification.UnitTests/Features/panier-chiffrage.feature : le titre du scénario « Le client chiffre un panier vide » (@ac-3) doit commencer par « AC-3 » : c'est ce qui le relie à son test. | 0.2947 $ | claude-sonnet-5-5 |
| DISTILL | 2 | 11:51:14 | 11:51:44 | 0m30 | 1 | RED d'acceptance : Le test d'acceptance « Tarification.UnitTests.Features.ChiffrerUnPanierLigneALigneFeature.AC_2LeClientChiffrePlusieursLignes » (critère 2) passe déjà : requalifiez-le en non-régression avec une justification dans test-plan.md, ou faites-le piloter un nouveau comportement. ; Le test d'acceptance « Tarification.UnitTests.Features.ChiffrerUnPanierLigneALigneFeature.AC_3LeClientChiffreUnPanierVide » (critère 3) passe déjà : requalifiez-le en non-régression avec une justification dans test-plan.md, ou faites-le piloter un nouveau comportement. | 0.3425 $ | claude-sonnet-5-5 |
| DISTILL | 3 | 11:51:44 | 11:52:06 | 0m22 | 1 | — | 0.3847 $ | claude-sonnet-5-5 |
| REVIEW | 2 | 11:52:06 | 11:54:20 | 2m13 | 5 | revue : [quality-gates#1.2, major, deliverable] « Mandat 4 : GrilleDePaliers.RemisePour — M4 negative, saturé par les AC » affirme une saturation de mutation : aucun résultat de mutation n'est établi par les faits, et la méthode RemisePour n'existe pas dans src/Tarification.Domaine/GrilleDePaliers.cs (seuls Vide et De y figurent). Cette qualité est revendiquée sans avoir été mesurée. (.skraft/us-2/distill/test-plan.md:28) — gravité : Un livrable qui se prévaut d'une qualité non mesurée donne un faux gage de qualité, ce qui est un défaut selon la règle de la lentille. ; [quality-gates#1.3, major, deliverable] Le plan ne rend pas compte des 10 tests exécutés (8 réussis, 2 en échec). Les fichiers .feature ne contiennent que 8 scénarios (5 US-2 dans panier-remise-par-palier.feature, 3 US-1 dans panier-chiffrage.feature) et le plan ne dit pas ce qui explique les deux autres. La cohérence entre le rapport d'exécution et le plan ne peut donc pas être vérifiée. (.skraft/us-2/distill/test-plan.md:25) — gravité : Un écart non expliqué entre le nombre de tests exécutés et le plan de test rend le compte rendu rouge/vert non traçable. ; Réponds à chaque défaut ci-dessus dans le champ `responses` de report_phase : `fixed` si tu l'as corrigé, `contested` avec ta raison si tu estimes qu'il ne faut pas le corriger, `outOfScope` avec ta raison s'il est juste mais que sa correction n'est pas de ton ressort. Un défaut maintenu après contestation doit être corrigé ; le contester encore soumet le désaccord à l'humain. | 0.5745 $ | claude-sonnet-5-5, claude-haiku-5-5, claude-opus-5-5 |
| REVIEW | 3 | 11:54:20 | 11:54:20 | 0m00 | 0 | — | 0.0000 $ |  |
| DISTILL | 4 | 11:54:20 | 11:54:46 | 0m26 | 1 | — | 0.4418 $ | claude-sonnet-5-5 |
| REVIEW | 4 | 11:54:46 | 11:56:05 | 1m19 | 4 | — | 0.5138 $ | claude-sonnet-5-5, claude-haiku-5-5 |
| DELIVER | 1 | 11:56:05 | 11:57:54 | 1m49 | 2 | — | 0.2321 $ | claude-sonnet-5-5 |
| REVIEW | 5 | 11:57:54 | 11:59:09 | 1m15 | 4 | — | 0.6728 $ | claude-sonnet-5-5, claude-haiku-5-5 |
| DONE | 1 | 11:59:09 | 11:59:09 | 0m00 | 0 | — | 0.0000 $ |  |

Total : 23m28, 8 rejet(s), 12.1751 $

## Ce qui a marché

- Le `.feature` de DISTILL est écrit **dans le projet** (`tests/Tarification.UnitTests/Features/
  panier-remise-par-palier.feature`), en français, titres `AC-n`, valeurs du critère recopiées ;
  les étapes sont ajoutées à `Steps/ChiffrageDuPanierSteps.cs`. Rouges attendus : @ac-2 et @ac-3.
- Les 10 tests des deux projets sont vus par les portes (`{rapports}`).

## Défauts trouvés (nos portes)

1. **La porte des titres `AC-n` juge tous les `.feature` du dossier**, y compris celui de l'US-1 :
   DISTILL 1 est refusé pour `panier-chiffrage.feature`, et l'agent **renomme les scénarios de
   l'US-1** (`AC-1 Le client chiffre…`). Un fichier d'une autre story est modifié.
2. **Les marqueurs `ac-n` de deux stories se confondent** : renommés, les scénarios de l'US-1
   (`AC_1…`, `AC_2…`, `AC_3…`) sont pris pour des tests d'acceptance de l'US-2. DISTILL 2 est
   refusé (« passe déjà »), et l'agent les requalifie en non-régression dans le `test-plan.md` de
   l'US-2. Le rapport liste 8 scénarios (`ac-1`, `ac-1#2`, …) pour 5 critères. Le problème existe
   aussi hors BDD dès qu'une story précédente a laissé des tests nommés `Ac<n>_…`.

## Autres constats

- **Aucun test unitaire écrit** en DELIVER (`tests/Tarification.Tests` inchangé) : un seul pas
  (`ac-2#2`), les autres scénarios passaient déjà ou en régression. À regarder au regard du
  « TDD toujours ».
- @ac-1, @ac-4, @ac-5 de l'US-2 requalifiés en régression : la remise vaut déjà 0,00 €.
- **DESIGN coûte 7,98 $ sur 12,18** (6 essais, une escalade « même refus deux fois ») : même
  incohérence entre architectes qu'au 07/11 (`Panier` de l'ADR-003 absent des modèles).
- RESEARCH 2 refusé pour des citations de `tests/Dosage.Tests` et `.agent-studio/stack.yaml` :
  ces noms viennent de l'**ADR-002 du projet** (`docs/adr/adr-002-format-de-rapport-de-tests.md:18`),
  resté d'une version antérieure ; la porte des citations a bien refusé, et l'agent a corrigé.
