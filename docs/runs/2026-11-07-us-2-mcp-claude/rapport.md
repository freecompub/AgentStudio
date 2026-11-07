# Run skraft — US-2.md — 2026-11-07 — serveur MCP, runtime Claude (mesure)

- But : mesurer, sur un vrai run, trois changements ajoutés depuis le run du 06/11 : le réfutateur
  des défauts de revue (ADR 0069), le disjoncteur des réessais (ADR 0073) et les réponses humaines
  citables (`passation.md`).
- Mode : workflow skraft piloté par le **serveur MCP** construit (stdio, paquet reconstruit le jour
  même), **runtime Claude** par le CLI (Claude Code 2.1.319) ; hôte d'essai
  `scripts/essai-mcp-skraft.ts --runtime=claude --base=a7cf6db`.
- Projet : clone de `github.com/freecompub/exemple-dotnet-tdd`, **même commit de départ** que les
  runs du 05/11 et du 06/11 (`a7cf6db`). Ce commit a encore `.agent-studio/stack.yaml` et
  `.skraft/quality.json` : lus avec l'avertissement de transition de l'ADR 0071.
- Modèles par classe (défaut Claude) : `strong` → opus, `standard` → sonnet, `light` → haiku.
- Réponses humaines : `reponses-us-2.json` (copie de `docs/runs/reponses-us-2.json`), répondeur
  commun, profil `architecte`.
- État final : **fini / DONE** ; phases RESEARCH, DESIGN, DISTILL, DELIVER ; **aucun ADR** au final
  (DESIGN rembobiné par une escalade ; les essais suivants n'en ont pas écrit).
- Durée : **26m10** ; **40 tours d'agent** ; **7 rejets** ; coût **13,83 $**.
- Livrable vérifié à part : `dotnet test` dans le clone, **10/10 verts**.

## Étapes (une par phase et par rejeu)

Le rejet est affiché sur la ligne de l'essai refusé. Motifs abrégés ; texte complet dans `rapport.json`.

| Étape | Essai | Début (UTC) | Durée | Tours | Coût | Rejet (porte : cause) |
|---|---|---|---|---|---|---|
| INIT | 1 | 21:42:57 | 0m12 | 0 | 0,00 $ | — |
| CLASSIFY | 1 | 21:43:08 | 0m08 | 1 | 0,00 $ | — |
| CONFIRM_DIFFICULTY | 1 | 21:43:17 | 0m10 | 0 | — | — |
| RESEARCH | 1 | 21:43:27 | 0m18 | 1 | 0,08 $ | — (question bloquante du chercheur) |
| BLOCKED | 1 | 21:43:45 | 0m12 | 0 | — | — (réponse du répondeur) |
| RESEARCH | 2 | 21:43:57 | 0m52 | 1 | 0,20 $ | **citations** : `tests/Dosage.Tests` cité, inexistant |
| RESEARCH | 3 | 21:44:49 | 0m13 | 1 | 0,23 $ | — |
| ROUTE | 1 | 21:45:02 | 0m12 | 0 | — | — (4 questions ouvertes répondues) |
| DESIGN | 1 | 21:45:14 | 3m51 | 2 | 1,38 $ | **cohérence** : `SommeDesArticles`, `FraisDePort` cités dans contracts.md, absents des modèles ; commande `ConfigurerGrille` sans section ; agrégat `Panier` de l'ADR-003 absent des modèles |
| DESIGN | 2 | 21:49:05 | 1m51 | 2 | 2,06 $ | **cohérence** : agrégat `Panier` de l'ADR-003 absent des modèles |
| DESIGN | 3 | 21:50:56 | 1m15 | 2 | 2,56 $ | **cohérence** : le même (`Panier`) |
| DESIGN | 4 | 21:52:10 | 0m01 | 0 | — | — (budget épuisé, escalade) |
| ESCALATED | 1 | 21:52:11 | 0m04 | 0 | — | — (le répondeur relance la phase) |
| DESIGN | 5 | 21:52:15 | 3m55 | 2 | 1,10 $ | **cohérence** : `PrixUnitaire`, `SommeDesArticles`, `FraisDePort` cités dans contracts.md, absents des modèles |
| DESIGN | 6 | 21:56:09 | 1m17 | 2 | 1,48 $ | — |
| REVIEW | 1 | 21:57:27 | 1m11 | 4 | 0,37 $ | — |
| DESIGN | 7 | 21:58:38 | 0m00 | 0 | — | **revue** : [architecture, major] interface de dépôt `IDepotDePaniers` déclarée sans critère de story ni ADR |
| DESIGN | 8 | 21:58:38 | 1m02 | 2 | 1,87 $ | — |
| REVIEW | 2 | 21:59:40 | 0m45 | 3 | 0,36 $ | — |
| RATIFICATION | 1 | 22:00:25 | 0m01 | 0 | — | — (aucun ADR à ratifier) |
| DISTILL | 1 | 22:00:26 | 1m14 | 1 | 0,23 $ | — |
| REVIEW | 3 | 22:01:40 | 1m18 | 4 | 0,51 $ | — |
| DELIVER | 1 | 22:02:58 | 2m06 | 2 | 0,21 $ | — |
| REVIEW | 4 | 22:05:04 | 1m37 | 5 | 0,88 $ | **revue (correction ciblée)** : [architecture, major] la somme des remises vit dans le cas d'usage (Application) au lieu de `Panier.SommeDesRemises` (domaine), contre ADR-001 |
| REVIEW | 5 | 22:06:41 | 0m01 | 0 | — | — |
| DELIVER | 2 | 22:06:42 | 1m13 | 1 | 0,17 $ | — |
| REVIEW | 6 | 22:07:55 | 1m11 | 4 | 0,14 $ | — |
| DONE | 1 | 22:09:07 | 0m00 | 0 | — | — |

**Total : 26m10, 7 rejets, 13,83 $.**

Tours par rôle : architectes 12 (6 + 6, opus), lentilles 18 (cold-reader 5, test-integrity 5,
architecture 5, quality-gates 3), chercheur 3, réfutateur 2, développeur 2, testeur 1, acceptance 1,
classifieur 1.

## Comparaison avec le run du 06/11 (même commit, même runtime)

| | 06/11 | 07/11 |
|---|---|---|
| Durée | 18m24 | **26m10** |
| Tours d'agent | 34 | **40** |
| Rejets | 4 | **7** |
| Escalades | 0 | **1** (DESIGN, budget épuisé) |
| Coût | 2,27 $ (non fiable, borne basse ≈ 1,26 $) | **13,83 $** (mesure corrigée) |
| ADR | ADR-003 ratifié | aucun |
| Tests | 10/10 | 10/10 |

## Ce que le run dit des trois changements mesurés

- **Réponses citables** (`passation.md`) : écrit et commité, avec les 5 réponses (4 questions
  ouvertes, 1 question bloquante du chercheur). Une seule question bloquante dans tout le run, aucune
  question répétée. Le 29/09, faute de source citable, DESIGN avait posé sept questions ; ici, zéro.
- **Disjoncteur** : **sans effet ici**. DESIGN a refusé deux fois de suite pour le même motif (essais 2
  et 3, l'agrégat `Panier`), mais c'était aussi le troisième essai : le budget de 3 escaladait au même
  moment.
- **Réfutateur** : appelé 2 fois, une par revue qui avait un défaut major ; les deux défauts ont été
  maintenus et ont renvoyé le travail. Aucune réfutation dans ce run.

## Ce que le run révèle

- **DESIGN porte l'essentiel du coût** : 8 essais (dont l'escalade et une correction de revue),
  environ 10,4 $ sur 13,8 $, presque tout sur opus. La porte de cohérence a refusé 4 fois, toujours pour
  des noms cités dans `contracts.md` ou dans un ADR et absents de `event-model.md` et `domain-model.md` :
  les deux architectes (modèle, puis décision) ne restent pas alignés.
- Le coût du 06/11 n'est **pas comparable** : il était sous-estimé (cumul de session recompté, ligne
  finale perdue ; défauts corrigés le 06/11). Seuls durée, tours et rejets se comparent.
- Les **revues** font 20 des 40 tours (18 de lentilles, 2 du réfutateur), mais coûtent peu (sonnet,
  haiku) : 2,26 $ en tout.
