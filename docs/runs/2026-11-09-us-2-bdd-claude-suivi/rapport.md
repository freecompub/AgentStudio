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
