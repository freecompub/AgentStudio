# Run skraft — US-2.md — 2026-11-06 — serveur MCP, runtime Claude (ADR 0070)

- Mode : workflow skraft piloté par le **serveur MCP** construit (stdio), **runtime Claude** par le CLI
  (`claude -p`, Claude Code 2.1.319, connexion claude.ai) ; hôte d'essai `scripts/essai-mcp-skraft.ts
  --runtime=claude --base=a7cf6db`.
- Projet : clone de `github.com/freecompub/exemple-dotnet-tdd`, **même commit de départ que le run
  Copilot du 05/11** (`a7cf6db`) : le `main` actuel n'a plus de profil de pile (converti à
  skraft-plugin v2), le serveur refusait de démarrer. Branche du run poussée :
  **`tests/us-2/mcp-claude-1`** (`f2df512`).
- Modèles par classe (défaut Claude) : `strong` → opus, `standard` → sonnet, `light` → haiku.
- Réponses humaines : `docs/runs/reponses-us-2.json`, répondeur commun, profil `architecte`.
- État final : **fini / DONE** ; phases RESEARCH, DESIGN, DISTILL, DELIVER ; ADR-003 proposé et ratifié.
- Durée : **18m24** ; **34 tours d'agent** ; **4 rejets**.
- Livrable vérifié à part : `dotnet test` dans le clone, **10/10 verts**.

## Étapes (une par phase et par rejeu)

| Étape | Essai | Début (UTC) | Fin (UTC) | Durée | Tours | Modèles | Rejet (porte : motifs) |
|---|---|---|---|---|---|---|---|
| INIT | 1 | 23:16:20 | 23:16:32 | 0m11 | 0 |  | — |
| CLASSIFY | 1 | 23:16:32 | 23:16:38 | 0m06 | 1 | haiku-5-5 | — |
| CONFIRM_DIFFICULTY | 1 | 23:16:38 | 23:16:51 | 0m13 | 0 |  | — |
| RESEARCH | 1 | 23:16:51 | 23:17:52 | 1m01 | 1 | sonnet-5-5 | **citations** : `tests/Dosage.Tests` : fichier inexistant dans le dépôt. |
| RESEARCH | 2 | 23:17:52 | 23:18:05 | 0m13 | 1 | sonnet-5-5 | — |
| ROUTE | 1 | 23:18:05 | 23:18:08 | 0m02 | 0 |  | — |
| DESIGN | 1 | 23:18:08 | 23:21:30 | 3m22 | 2 | opus-5-5 | **cohérence** : `PrixUnitaire` cité dans contracts.md n'existe pas dans event-model.md ni dans domain-model.md. ; `SommeDesArticles` cité dans contracts.md n'existe pas dans event-model.md ni dans domain-model.md. ; `FraisDePort` cité dans contracts.md n'existe pas dans event-model.md ni dans domain-model.md. ; `Panier`, Agrégat dans ADR-003, n'existe ni dans event-model.md ni dans domain-model.md. |
| DESIGN | 2 | 23:21:30 | 23:23:31 | 2m01 | 2 | opus-5-5 | — |
| REVIEW | 1 | 23:23:31 | 23:24:19 | 0m48 | 3 | sonnet-5-5 | — |
| RATIFICATION | 1 | 23:24:19 | 23:24:24 | 0m05 | 0 |  | — |
| DISTILL | 1 | 23:24:24 | 23:25:32 | 1m08 | 1 | sonnet-5-5 | — |
| REVIEW | 2 | 23:25:32 | 23:27:25 | 1m52 | 5 | sonnet-5-5, haiku-5-5, opus-5-5 | **revue** : [quality-gates#1.1, major, deliverable] La ligne « Mandat 4 : GrilleDeRemise.RemisePour — M4 negative — saturated by AC (toutes les branches atteintes par ac-1..5) » présente une saturation de mutation et une couverture de branches comme acquises. Aucun outil de mutation ni de couverture n'a été exécuté, et aucun de leurs résultats ne figure dans les faits. De plus, RemisePour est un retour constant (Montant.Zero) : il n'a aucune branche, donc « toutes les branches atteintes » n'a pas de sens sur ce code. (.skraft/us-2/distill/test-plan.md:18) — gravité : Un livrable qui se prévaut d'une qualité non mesurée induit en erreur sur la solidité de la suite, ce qui est un défaut majeur. ; [quality-gates#1.2, major, test] Ac4 (et de même Ac1 ligne 17 et Ac5 ligne 62) passe déjà contre le bouchon GrilleDeRemise.RemisePour, qui renvoie zéro. Le test-plan (lignes 14 à 16) affirme qu'il « garde le calcul par ligne contre un cumul des quantités » ou « garde la frontière du seuil », mais rien n'établit que ces tests échouent sur une implémentation fautive. Trois critères sur cinq ne pilotent donc pas la phase RED. Le gel de l'empreinte limite la correction : l'arbitrage revient à l'humain. (tests/Tarification.Tests/RemiseParPalierAcceptanceTests.cs:50) — gravité : Une protection de non-régression affirmée sans démonstration laisse trois critères d'acceptation sans valeur de détection vérifiée. — aussi : tests/Tarification.Tests/RemiseParPalierAcceptanceTests.cs:17, tests/Tarification.Tests/RemiseParPalierAcceptanceTests.cs:62 ; Réponds à chaque défaut ci-dessus dans le champ `responses` de report_phase : `fixed` si tu l'as corrigé, `contested` avec ta raison si tu estimes qu'il ne faut pas le corriger, `outOfScope` avec ta raison s'il est juste mais que sa correction n'est pas de ton ressort. Un défaut maintenu après contestation doit être corrigé ; le contester encore soumet le désaccord à l'humain. |
| REVIEW | 3 | 23:27:25 | 23:27:25 | 0m00 | 0 |  | — |
| DISTILL | 2 | 23:27:25 | 23:28:02 | 0m37 | 1 | sonnet-5-5 | — |
| REVIEW | 4 | 23:28:02 | 23:29:18 | 1m16 | 5 | sonnet-5-5, haiku-5-5, opus-5-5 | — |
| DELIVER | 1 | 23:29:18 | 23:31:08 | 1m50 | 2 | sonnet-5-5 | — |
| REVIEW | 5 | 23:31:08 | 23:32:54 | 1m45 | 5 | sonnet-5-5, haiku-5-5, opus-5-5 | **revue (correction ciblée)** : [quality-gates#1.1, major, code] Montant.Fraction construit un Montant sans garde de signe, contrairement à De et Multiplie. Avec un taux négatif (Pourcentage.De accepte n'importe quel decimal, cf. Pourcentage.cs:10, hors livrables de cette phase), la remise devient négative. Or la doc de Montant (lignes 4-5) affirme qu'un montant négatif n'existe pas dans ce domaine. Le prix final augmente alors sans erreur. (src/Tarification.Domaine/Montant.cs:24) — gravité : Une remise négative passe silencieusement et fausse le montant à payer, ce qui est un défaut majeur sur un chemin de calcul de prix. — aussi : src/Tarification.Domaine/Pourcentage.cs:10 ; Réponds à chaque défaut ci-dessus dans le champ `responses` de report_phase : `fixed` si tu l'as corrigé, `contested` avec ta raison si tu estimes qu'il ne faut pas le corriger, `outOfScope` avec ta raison s'il est juste mais que sa correction n'est pas de ton ressort. Un défaut maintenu après contestation doit être corrigé ; le contester encore soumet le désaccord à l'humain. |
| REVIEW | 6 | 23:32:54 | 23:32:54 | 0m01 | 0 |  | — |
| DELIVER | 2 | 23:32:54 | 23:33:37 | 0m43 | 1 | sonnet-5-5 | — |
| REVIEW | 7 | 23:33:37 | 23:34:44 | 1m07 | 4 | sonnet-5-5, haiku-5-5 | — |
| DONE | 1 | 23:34:44 | 23:34:44 | 0m00 | 0 |  | — |

Une étape REVIEW de durée nulle suit un rejet de revue : c'est la reprise de la phase, aussitôt
rendue à son producteur (artefact du découpage par essai).

## Rejeux et leurs causes

1. **RESEARCH, essai 1 → 2** — porte `citations` : la recherche citait `tests/Dosage.Tests`, un
   fichier qui n'existe pas dans le dépôt.
2. **DESIGN, essai 1 → 2** — porte `cohérence` : `PrixUnitaire`, `SommeDesArticles`, `FraisDePort`
   cités dans `contracts.md` absents des modèles ; l'agrégat `Panier` de l'ADR-003 absent des modèles.
3. **DISTILL, essai 1 → 2** — revue (`quality-gates`, deux défauts major) : le plan de test se prévalait
   d'une saturation de mutation et d'une couverture jamais mesurées ; trois critères (ac-1, ac-4, ac-5)
   passaient déjà contre le bouchon, sans démontrer qu'ils détectent une implémentation fautive.
4. **DELIVER, correction ciblée** — revue (`quality-gates`, major) : `Montant.Fraction` acceptait un
   taux négatif (remise négative silencieuse), avec occurrence dans `Pourcentage.cs:10`.

## Nouveautés vues en réel

- **Réfutateur (ADR 0069)** appelé 3 fois ; en 2e revue de DISTILL, il a **réfuté** un défaut major de
  quality-gates en citant le fichier de tests (« le résultat mesuré ne contredit pas le plan »).
- **Notes hors du changement** : plusieurs défauts des revues de DELIVER rangés en notes (lignes non
  modifiées par la phase), sans renvoyer le travail.
- **Contrat enrichi** : raisons de gravité et occurrences dans les défauts (voir les motifs ci-dessus).

## Coût : mesure à corriger (défauts de l'adaptateur Claude)

Le total affiché par le pilote (2,27 $) **n'est pas fiable**, pour deux raisons vues dans la trace :

1. **Coût cumulé à la reprise** : avec `--resume`, `total_cost_usd` est le cumul de la session, pas du
   tour (cold-reader : 0,121 → 0,166 → 0,206 → 0,243 $ sur 4 tours) ; additionné, il compte plusieurs
   fois le même coût.
2. **Coût perdu** : chercheur, architectes (opus), réfutateur et un tour d'acceptance n'ont remonté
   aucun coût — le CLI écrit sa ligne finale plus de 5 s après l'outil terminal, et il est arrêté avant.

**Corrigé le 06/11 après ce run** (`runtime-claude`) : seul l'écart avec le cumul déjà compté de la
session est émis ; la ligne finale est attendue jusqu'à 60 s, et la réponse de l'outil terminal dit
au modèle de ne plus rien écrire. Vérifié par `pnpm smoke:claude` (deux tours : 0,0016 $ puis
0,0003 $). Le coût de **ce** run reste inconnu.

Borne basse, en prenant le dernier cumul de chaque session qui en a un : **≈ 1,26 $**, hors chercheur,
architectes et réfutateur. Le coût réel n'est donc pas connu pour ce run.

## Comparaison avec le run Copilot du 05/11 (même story, même commit)

| | Copilot (05/11) | Claude (06/11) |
|---|---|---|
| Durée | 19 min 24 s | 18m24 |
| Tours d'agent | 20 | 34 |
| Rejets | 1 (cohérence en DESIGN) | 4 (citations, cohérence, revue DISTILL, revue DELIVER) |
| ADR | aucun | ADR-003 |
| Questions ouvertes | 2 (la même, posée deux fois) | 4 |
| Tests du livrable | 10/10 | 10/10 |
| Coût | ≈ 374 requêtes premium | inconnu (voir ci-dessus) |
| Branche | `tests/us-2/mcp-copilot-1` | `tests/us-2/mcp-claude-1` |

Un run de chaque : des constats, pas une mesure.
