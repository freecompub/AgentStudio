# Runs réels US-2 en BDD suivis par `skraft_attendre` — 2026-11-09

Départ : `main` GitHub d'`exemple-dotnet-tdd` (`19583a4 bdd`), runtime Claude, pile `pile.yaml`. Serveur
MCP de la PR #26 (`skraft_attendre`, ligne de progression). Script : `scripts/essai-mcp-skraft.ts
--suivi=attendre`, qui affiche ce que l'hôte montrerait à l'utilisateur (`sortie-suivie.txt`).

## Premier essai : interrompu au bout de 80 s

Le client MCP abandonne un appel au bout de **60 s** (délai par défaut du SDK) ; le script demandait
`delai: 120`. RESEARCH sans changement pendant plus d'une minute : « MCP error -32001: Request timed
out », le script et le serveur se sont arrêtés. Corrigé : attente bornée à 50 s (30 par défaut).

## Second essai : fini, 22m39, 5 rejets, 6,62 $

| Étape | Essai | Début | Fin | Durée | Tours | Rejets | Coût | Modèles |
|---|---|---|---|---|---|---|---|---|
| INIT | 1 | 11:09:15 | 11:09:26 | 0m11 | 0 | — | 0.0000 $ |  |
| CLASSIFY | 1 | 11:09:26 | 11:09:35 | 0m09 | 1 | — | 0.0011 $ | claude-haiku-5-5 |
| CONFIRM_DIFFICULTY | 1 | 11:09:35 | 11:09:35 | 0m00 | 0 | — | 0.0000 $ |  |
| ROUTE | 1 | 11:09:35 | 11:09:36 | 0m00 | 0 | — | 0.0000 $ |  |
| RESEARCH | 1 | 11:09:36 | 11:10:43 | 1m08 | 1 | citations : `Features/panier-chiffrage.feature` : fichier inexistant dans le dépôt. ; `tests/Dosage.Tests` : fichier inexistant dans le dépôt. | 0.1405 $ | claude-sonnet-5-5 |
| RESEARCH | 2 | 11:10:43 | 11:11:03 | 0m19 | 1 | citations : `tests/Tarification.Tests` : fichier inexistant dans le dépôt. ; `tests/Tarification.UnitTests` : fichier inexistant dans le dépôt. | 0.1761 $ | claude-sonnet-5-5 |
| RESEARCH | 3 | 11:11:03 | 11:11:21 | 0m18 | 1 | — | 0.2084 $ | claude-sonnet-5-5 |
| ROUTE | 2 | 11:11:21 | 11:11:23 | 0m02 | 0 | — | 0.0000 $ |  |
| DESIGN | 1 | 11:11:23 | 11:15:35 | 4m12 | 2 | — | 1.3905 $ | claude-opus-5-5 |
| REVIEW | 1 | 11:15:35 | 11:16:31 | 0m56 | 3 | — | 0.2203 $ | claude-sonnet-5-5 |
| RATIFICATION | 1 | 11:16:31 | 11:16:32 | 0m01 | 0 | — | 0.0000 $ |  |
| DISTILL | 1 | 11:16:32 | 11:18:18 | 1m46 | 1 | — | 0.2977 $ | claude-sonnet-5-5 |
| REVIEW | 2 | 11:18:18 | 11:20:26 | 2m08 | 5 | revue : [quality-gates#1.1, major, deliverable] Le plan affirme « Mutation M4 : GrillePaliers.RemisePour — M4 negative — saturated by AC ». Aucun outil de mutation n'a été exécuté d'après les faits, donc cette qualité n'est pas mesurée. De plus, la méthode GrillePaliers.RemisePour n'existe pas dans src/Tarification.Domaine/GrillePaliers.cs (la classe ne porte que Paliers, Vide et De). L'affirmation doit être retirée ou reformulée comme non mesurée. (.skraft/us-2/distill/test-plan.md:20) — gravité : Une qualité présentée comme acquise (mutant saturé) sans aucune mesure et sur une cible inexistante trompe le lecteur sur la solidité de la suite. ; [quality-gates#1.2, major, deliverable] Le plan ne documente pas le résultat DISTILL_RED établi par le code : 8 réussis, 2 en échec, sur 10 tests. Il ne dit pas quels scénarios sont en échec (ce devrait être @ac-2 et @ac-3, les seuls non requalifiés) ni pourquoi. Le total de 10 n'est pas réconcilié avec les 5 scénarios de panier-remise-par-palier.feature. La preuve de la porte rouge reste donc absente du livrable. (.skraft/us-2/distill/test-plan.md:1) — gravité : La porte DISTILL repose sur la preuve que les tests échouent pour la bonne raison, et le livrable ne la rapporte pas. ; Réponds à chaque défaut ci-dessus dans le champ `responses` de report_phase : `fixed` si tu l'as corrigé, `contested` avec ta raison si tu estimes qu'il ne faut pas le corriger, `outOfScope` avec ta raison s'il est juste mais que sa correction n'est pas de ton ressort. Un défaut maintenu après contestation doit être corrigé ; le contester encore soumet le désaccord à l'humain. | 0.5789 $ | claude-sonnet-5-5, claude-haiku-5-5, claude-opus-5-5 |
| REVIEW | 3 | 11:20:26 | 11:20:26 | 0m00 | 0 | — | 0.0000 $ |  |
| DISTILL | 2 | 11:20:26 | 11:20:53 | 0m27 | 1 | — | 0.3562 $ | claude-sonnet-5-5 |
| REVIEW | 4 | 11:20:53 | 11:21:58 | 1m05 | 5 | revue : [quality-gates#2.1, major, deliverable] La décision sur ATPayer reste non consignée. Le plan ne dit ni si ATPayer doit déduire la remise, ni quelle option « la plus simple » a été retenue. CalculDuPanier.cs:12 définit toujours ATPayer = SommeDesArticles + FraisDePort, sans la remise. Dès @ac-2 vert, Facture.Remise vaudra 1,00 € alors qu'ATPayer restera au plein tarif. Cette incohérence annoncée par l'utilisateur n'est ni tracée ni signalée dans le livrable. (.skraft/us-2/distill/test-plan.md:19) — gravité : Une incohérence concrète entre remise affichée et montant à payer, qui touchera le total dès la phase suivante, n'est pas tracée. ; Rappel des demandes des revues précédentes, déclarées corrigées : ne les défais pas. ;   - [quality-gates#1.1] Le plan affirme « Mutation M4 : GrillePaliers.RemisePour — M4 negative — saturated by AC ». Aucun outil de mutation n'a été exécuté d'après les faits, donc cette qualité n'est pas mesurée. De plus, la méthode GrillePaliers.RemisePour n'existe pas dans src/Tarification.Domaine/GrillePaliers.cs (la classe ne porte que Paliers, Vide et De). L'affirmation doit être retirée ou reformulée comme non mesurée. ;   - [quality-gates#1.2] Le plan ne documente pas le résultat DISTILL_RED établi par le code : 8 réussis, 2 en échec, sur 10 tests. Il ne dit pas quels scénarios sont en échec (ce devrait être @ac-2 et @ac-3, les seuls non requalifiés) ni pourquoi. Le total de 10 n'est pas réconcilié avec les 5 scénarios de panier-remise-par-palier.feature. La preuve de la porte rouge reste donc absente du livrable. ; Réponds à chaque défaut ci-dessus dans le champ `responses` de report_phase : `fixed` si tu l'as corrigé, `contested` avec ta raison si tu estimes qu'il ne faut pas le corriger, `outOfScope` avec ta raison s'il est juste mais que sa correction n'est pas de ton ressort. Un défaut maintenu après contestation doit être corrigé ; le contester encore soumet le désaccord à l'humain. | 0.7335 $ | claude-sonnet-5-5, claude-haiku-5-5, claude-opus-5-5 |
| REVIEW | 5 | 11:21:58 | 11:21:58 | 0m00 | 0 | — | 0.0000 $ |  |
| DISTILL | 3 | 11:21:58 | 11:22:19 | 0m21 | 1 | — | 0.4003 $ | claude-sonnet-5-5 |
| REVIEW | 6 | 11:22:19 | 11:23:02 | 0m43 | 4 | — | 0.5058 $ | claude-sonnet-5-5, claude-haiku-5-5 |
| DELIVER | 1 | 11:23:02 | 11:26:08 | 3m06 | 2 | — | 0.2135 $ | claude-sonnet-5-5 |
| REVIEW | 7 | 11:26:08 | 11:27:54 | 1m45 | 5 | revue (correction ciblée) : [architecture#1.1, major, code] La somme des remises ligne par ligne est faite dans le cas d'usage (RemiseDe, Aggregate sur panier.Lignes). L'ADR-003 décide de placer `Panier.SommeDesRemises(GrillePaliers)` sur la racine, qui somme `GrillePaliers.RemisePour(ligne)` : c'est ce qui porte l'invariant I1 (remise par ligne) et I2 (grille vide → zéro) dans le domaine. `Panier.cs` n'a pas reçu cette opération ; la règle d'agrégation passe dans la couche Application, contre adr-001 (règle commerciale dans le domaine) et contre la décision ratifiée. Le contrat `contracts.md` (Remise = panier.SommeDesRemises(grille)) n'est pas respecté. (src/Tarification.Application/CalculDuPanier.cs:32) — gravité : Le code s'écarte de la frontière d'agrégat ratifiée par l'ADR-003 et place une règle commerciale dans l'application, contre l'ADR-001. ; Réponds à chaque défaut ci-dessus dans le champ `responses` de report_phase : `fixed` si tu l'as corrigé, `contested` avec ta raison si tu estimes qu'il ne faut pas le corriger, `outOfScope` avec ta raison s'il est juste mais que sa correction n'est pas de ton ressort. Un défaut maintenu après contestation doit être corrigé ; le contester encore soumet le désaccord à l'humain. | 1.0773 $ | claude-sonnet-5-5, claude-haiku-5-5, claude-opus-5-5 |
| REVIEW | 8 | 11:27:54 | 11:27:55 | 0m01 | 0 | — | 0.0000 $ |  |
| DELIVER | 2 | 11:27:55 | 11:30:01 | 2m06 | 1 | — | 0.1710 $ | claude-sonnet-5-5 |
| REVIEW | 9 | 11:30:01 | 11:31:54 | 1m53 | 4 | — | 0.1442 $ | claude-sonnet-5-5, claude-haiku-5-5 |
| DONE | 1 | 11:31:54 | 11:31:54 | 0m00 | 0 | — | 0.0000 $ |  |

Total : 22m39, 5 rejet(s), 6.6153 $

### Par phase

| Phase | Essais | Durée | Tours | Coût | Rejets |
|---|---|---|---|---|---|
| Préparation | 1 | 0m22 | 1 | < 0,01 $ | — |
| RESEARCH | 3 | 1m45 | 3 | 0,53 $ | 2 (citations : chemins incomplets, nom périmé, dossiers cités comme fichiers) |
| DESIGN | 1 | 4m12 | 2 | 1,39 $ | **0** |
| Revue de DESIGN | 1 | 0m56 | 3 | 0,22 $ | — |
| DISTILL | 3 | 2m34 | 3 | 1,05 $ | — |
| Revue de DISTILL | 3 | 3m56 | 14 | 1,82 $ | 2 (mutation affirmée sans mesure ; décision `ATPayer` non consignée) |
| DELIVER | 2 | 5m12 | 3 | 0,38 $ | — |
| Revue de DELIVER | 2 | 3m39 | 9 | 1,22 $ | 1 (somme des remises dans le cas d'usage, contraire à l'ADR-003) |

### Ce que l'hôte a reçu

Phases (19), questions avec options (7), réponses reçues, fin du run, messages, ligne de progression à
chaque retour (44), « Rien de nouveau » toutes les 50 s (22). **Aucun rejet** (5 réels) **ni essai** :
la carte d'une tâche de workflow ne porte ni `feedback` ni `step`. Corrigé ensuite : rejets et essai lus
dans la trace (`vueDeTache`), vérifié en rejouant cette trace (2, puis 3, 4, 5 rejets, chacun avec son
motif).

### Constats

- DESIGN passe sans rejet (liste des noms du modèle, PR #25).
- Les revues font 49 % du coût (3,26 $). Les trois défauts sont fondés ; celui sur `ATPayer` vient de la
  réponse vague du répondeur du banc (« l'option la plus simple »), qu'un vrai utilisateur aurait tranchée.
- RESEARCH refait deux fois pour des citations, alors que les chemins complets sont dans sa présélection.

## Troisième essai, après la correction des rejets : fini, 21m13, 5 rejets, 6,51 $

ADR-003 accepté ; `dotnet test` 10/10. Le serveur (`0afe171`) a signalé **les 5 rejets sur 5**, au moment
où ils se produisaient, avec la phase, l'essai, la porte et le motif (`sortie-suivie-2.txt`) ; aussi 20
phases, 7 questions (dont une escalade), 5 réponses, la fin.

| Étape | Essai | Début | Fin | Durée | Tours | Rejets | Coût | Modèles |
|---|---|---|---|---|---|---|---|---|
| INIT | 1 | 13:29:11 | 13:29:25 | 0m14 | 0 | — | 0.0000 $ |  |
| CLASSIFY | 1 | 13:29:25 | 13:29:34 | 0m09 | 1 | — | 0.0017 $ | claude-haiku-5-5 |
| CONFIRM_DIFFICULTY | 1 | 13:29:34 | 13:29:35 | 0m01 | 0 | — | 0.0000 $ |  |
| ROUTE | 1 | 13:29:35 | 13:29:35 | 0m00 | 0 | — | 0.0000 $ |  |
| RESEARCH | 1 | 13:29:35 | 13:30:32 | 0m57 | 1 | citations : `tests/Tarification.UnitTests` : fichier inexistant dans le dépôt. | 0.2020 $ | claude-sonnet-5-5 |
| RESEARCH | 2 | 13:30:32 | 13:30:43 | 0m11 | 1 | — | 0.2388 $ | claude-sonnet-5-5 |
| ROUTE | 2 | 13:30:43 | 13:30:45 | 0m01 | 0 | — | 0.0000 $ |  |
| DESIGN | 1 | 13:30:45 | 13:35:29 | 4m45 | 2 | — | 1.5335 $ | claude-opus-5-5 |
| REVIEW | 1 | 13:35:29 | 13:36:00 | 0m30 | 3 | — | 0.2092 $ | claude-sonnet-5-5 |
| RATIFICATION | 1 | 13:36:00 | 13:36:01 | 0m01 | 0 | — | 0.0000 $ |  |
| DISTILL | 1 | 13:36:01 | 13:37:25 | 1m24 | 1 | RED d'acceptance : Le test d'acceptance « Tarification.UnitTests.Features.RemiseParPalierDeQuantiteFeature.AC_3UnSeulPalierSappliqueLePlusAvantageux » échoue pour une mauvaise raison : Remise attendue 12,00 €, obtenue 0,00 €. ; Le test d'acceptance « Tarification.UnitTests.Features.RemiseParPalierDeQuantiteFeature.AC_2UneLigneQuiAtteintLeSeuilDuPalierObtientLaRemise » échoue pour une mauvaise raison : Remise attendue 1,00 €, obtenue 0,00 €. | 0.3232 $ | claude-sonnet-5-5 |
| DISTILL | 2 | 13:37:25 | 13:37:55 | 0m30 | 1 | — | 0.3745 $ | claude-sonnet-5-5 |
| REVIEW | 2 | 13:37:55 | 13:39:43 | 1m47 | 5 | revue : [quality-gates#1.1, major, deliverable] Les décisions tranchées par l'utilisateur sur ce qui touche aux tests ne sont consignées nulle part dans le plan de test. La question sur ATPayer (qui ignore la remise, CalculDuPanier.cs:12) a reçu « retiens l'option la plus simple » ; le plan ne dit pas que ATPayer reste hors remise, ni que c'est un choix conscient. Or la story traite justement de la remise, et le commentaire de Facture (CalculDuPanier.cs:6-8) présente les remises à zéro comme provisoires. Un lecteur ne peut pas savoir si l'exclusion est voulue. (.skraft/us-2/distill/test-plan.md:22) — gravité : Un total à payer qui ignore la remise dans la story de la remise est un risque métier visible, et le plan le passe sous silence. — aussi : src/Tarification.Application/CalculDuPanier.cs:12 ; Réponds à chaque défaut ci-dessus dans le champ `responses` de report_phase : `fixed` si tu l'as corrigé, `contested` avec ta raison si tu estimes qu'il ne faut pas le corriger, `outOfScope` avec ta raison s'il est juste mais que sa correction n'est pas de ton ressort. Un défaut maintenu après contestation doit être corrigé ; le contester encore soumet le désaccord à l'humain. | 0.4788 $ | claude-sonnet-5-5, claude-haiku-5-5, claude-opus-5-5 |
| REVIEW | 3 | 13:39:43 | 13:39:43 | 0m00 | 0 | — | 0.0000 $ |  |
| DISTILL | 3 | 13:39:43 | 13:40:04 | 0m21 | 1 | — | 0.4175 $ | claude-sonnet-5-5 |
| REVIEW | 4 | 13:40:04 | 13:40:46 | 0m42 | 4 | revue : Revue « changements demandés » sans défaut bloquant ni majeur à corriger. Verdicts : cold-reader : APPROVED (Dans AC-4, les lignes sont déclarées sans prix (« une ligne "MUG-01" de 6 articles »), un prix de 1,00 € étant fixé en silence par le step. Un lecteur métier ne voit pas que le prix est sans importance ; « à un prix quelconque » le rendrait explicite.) ; test-integrity : APPROVED ; architecture : APPROVED ; quality-gates : CHANGES_REQUESTED (Le plan décrit encore Pourcentage et PalierDeRemise comme des bouchons « remise toujours Montant.Zero ». Ce sont des types réels qui stockent leurs valeurs (Pourcentage.De, PalierDeRemise.De). Seuls BaremeDePaliers.RemiseDe et Panier.RemiseSelon renvoient Montant.Zero. Le défaut subsiste dans la version actuelle. ; Le plan annonce les rouges attendus mais ne consigne toujours pas le résultat réel de DISTILL_RED (8 réussis, 2 en échec, 0 ignoré). Il n'explique pas non plus d'où viennent les 10 tests alors que le feature en compte 5. Le défaut subsiste. ; Le plan justifie « aucune doublure : domaine réel, ADR-001 ». Le fichier docs/adr/adr-001-decoupage-domaine-application.md traite du découpage domaine/application et ne mentionne aucune doublure. La référence ne soutient pas l'affirmation. Le défaut subsiste. ; Le plan déclare les requalifications « role: regression » pour AC-1, AC-4 et AC-5, mais le .feature ne porte aucun marqueur de rôle sur ces scénarios. La requalification n'existe que dans le plan, ce qui fragilise la traçabilité. Le défaut subsiste, le feature n'ayant pas changé. ; Les scénarios AC-4 et AC-5 ne donnent pas le prix des lignes. Le step « une ligne ... de N articles » injecte silencieusement un prix de 1,00 € (ChiffrageDuPanierSteps.cs:25-27), et « une ligne quelconque » fabrique la référence REF-QUELCONQUE. Le .feature n'exprime donc pas les montants qu'il vérifie. Le défaut subsiste, le feature n'ayant pas changé.). | 0.4329 $ | claude-sonnet-5-5, claude-haiku-5-5 |
| REVIEW | 5 | 13:40:46 | 13:40:46 | 0m01 | 0 | — | 0.0000 $ |  |
| ESCALATED | 1 | 13:40:46 | 13:40:47 | 0m01 | 0 | — | 0.0000 $ |  |
| DISTILL | 4 | 13:40:47 | 13:43:08 | 2m21 | 1 | — | 0.3873 $ | claude-sonnet-5-5 |
| REVIEW | 6 | 13:43:08 | 13:44:55 | 1m47 | 6 | revue : [cold-reader#3.1, major, test] Les deux premières lignes du palier sont écrites différemment : « 10 articles ou plus : 5 % » (AC-1, AC-2, AC-4, AC-5) puis « 10 : 5 % » et « 50 : 12 % » (AC-3). Un lecteur métier ne sait pas ce que « 10 » désigne (articles ? euros ?). L'expression régulière rend « articles ou plus » optionnel, ce qui masque l'incohérence. Écrire partout « 50 articles ou plus : 12 % » et rendre le texte obligatoire. (tests/Tarification.UnitTests/Features/panier-remise-par-palier.feature:22) — gravité : Le scénario AC-3 est le seul à illustrer le choix du palier le plus avantageux, et son vocabulaire est ambigu pour le métier. ; [quality-gates#3.1, major, deliverable] Défaut #1.1 : persistant en partie. La décision sur ATPayer est désormais écrite (« ATPayer inchangé »), mais seulement dans la section « Points notés pour la boucle interne (non écrits) », et présentée comme « option la plus simple retenue ». Le plan ne dit pas que la valeur n'a pas été confirmée par l'utilisateur (passation.md:7 : « Valeur à confirmer, non devinée »), ni que ATPayer exclut volontairement la remise pour cette story, ni que la remise est désormais calculée et stockée dans Facture.Remise sans être déduite du total. Aucun scénario ne vérifie ATPayer (grep sans résultat dans tests/), donc cette exclusion n'est couverte par aucun test. Un lecteur ne peut toujours pas savoir si l'exclusion est un choix définitif ou un report à une story ultérieure. (.skraft/us-2/distill/test-plan.md:48) — gravité : Le plan est le seul document qui trace ce choix métier non confirmé, sur le sujet même de la story (la remise), et il le présente comme tranché. — aussi : tests/Tarification.UnitTests/Features/panier-remise-par-palier.feature:1 ; Rappel des demandes des revues précédentes, déclarées corrigées : ne les défais pas. ;   - [quality-gates#1.1] Les décisions tranchées par l'utilisateur sur ce qui touche aux tests ne sont consignées nulle part dans le plan de test. La question sur ATPayer (qui ignore la remise, CalculDuPanier.cs:12) a reçu « retiens l'option la plus simple » ; le plan ne dit pas que ATPayer reste hors remise, ni que c'est un choix conscient. Or la story traite justement de la remise, et le commentaire de Facture (CalculDuPanier.cs:6-8) présente les remises à zéro comme provisoires. Un lecteur ne peut pas savoir si l'exclusion est voulue. ; Réponds à chaque défaut ci-dessus dans le champ `responses` de report_phase : `fixed` si tu l'as corrigé, `contested` avec ta raison si tu estimes qu'il ne faut pas le corriger, `outOfScope` avec ta raison s'il est juste mais que sa correction n'est pas de ton ressort. Un défaut maintenu après contestation doit être corrigé ; le contester encore soumet le désaccord à l'humain. | 0.4861 $ | claude-sonnet-5-5, claude-haiku-5-5, claude-opus-5-5 |
| REVIEW | 7 | 13:44:55 | 13:44:55 | 0m00 | 0 | — | 0.0000 $ |  |
| DISTILL | 5 | 13:44:55 | 13:45:52 | 0m56 | 1 | — | 0.4963 $ | claude-sonnet-5-5 |
| REVIEW | 8 | 13:45:52 | 13:46:33 | 0m41 | 4 | — | 0.3153 $ | claude-sonnet-5-5, claude-haiku-5-5 |
| DELIVER | 1 | 13:46:33 | 13:49:20 | 2m47 | 2 | — | 0.1910 $ | claude-sonnet-5-5 |
| REVIEW | 9 | 13:49:20 | 13:50:24 | 1m04 | 4 | — | 0.4254 $ | claude-sonnet-5-5, claude-haiku-5-5 |
| DONE | 1 | 13:50:24 | 13:50:24 | 0m00 | 0 | — | 0.0000 $ |  |

Total : 21m13, 5 rejet(s), 6.5135 $

### Défauts de forme vus, corrigés ensuite

- Motif coupé à 160 caractères, parfois avant la cause (« … échoue po… ») : on garde désormais son début
  et sa fin.
- Double point final (« dépôt.. ») : une phrase ne finit plus que par un point.

### Ce que le run révèle sur skraft (à analyser)

1. **Rouge d'acceptance refusé à tort, probablement** : `Assert.True(condition, "Remise attendue 12,00 €,
   obtenue 0,00 €")` classé « mauvaise raison » ; le lecteur reconnaît une assertion à son texte, que le
   message personnalisé masque. L'agent est passé à `Assert.Equal` (trace, 13:37:45). Un essai perdu.
2. **Escalade pour une revue sans défaut grave** : quality-gates « changements demandés » sans défaut
   bloquant ni majeur ; personne à qui renvoyer, escalade, DISTILL refait entièrement.
3. **Conflit de règles** : cold-reader reproche d'écrire le palier de deux façons (« 10 articles ou plus :
   5 % », « 10 : 5 % ») ; c'est la story qui les écrit ainsi, et la porte exige de recopier ses valeurs.
