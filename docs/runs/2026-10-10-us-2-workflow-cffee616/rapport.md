# Run skraft — US-2.md — 2026-10-10 — workflow skraft

- Mode : workflow skraft ; réponses humaines : `/Users/b283ko/Projet/AgentStudio/docs/runs/reponses-us-2.json` ; plafond : 350 requêtes premium
- Projet : `/tmp/agentstudio-exemple-dotnet-tdd`, branche poussée `tests/us-2/workflow-1`
- État final : fini / DONE
- Indicateur de livraison corrigé après mesure : `livre: true`. Le banc initial lisait uniquement les résultats en clair ; la référence du résultat persisté a été résolue et ses phases incluent DELIVER. Vérification indépendante du livrable : 13/13 tests verts.
- Durée : 55m21, 35 tours, 5 rejets, 8086465 tokens d'entrée
- Requêtes premium : 264.3 d'après le SDK (185 appels), écart de réserve 301

## Étapes

| Étape | Durée | Tours | Rejets | Fins anormales | Appels | Requêtes premium | Modèles | Tokens entrée |
|---|---|---|---|---|---|---|---|---|
| INIT | 0m05 | 0 | 0 |  | 0 | 0 |  | 0 |
| CLASSIFY | 0m07 | 1 | 0 |  | 1 | 0.2 | gpt-6-luna | 15015 |
| CONFIRM_DIFFICULTY | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |
| RESEARCH | 2m13 | 1 | 0 |  | 12 | 1.7 | gpt-6-luna | 432772 |
| BLOCKED | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |
| RESEARCH | 4m13 | 2 | 1 |  | 51 | 5.3 | gpt-6-luna | 3518952 |
| ROUTE | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |
| DESIGN | 5m04 | 2 | 0 |  | 17 | 46.4 | gpt-6.1-sol | 682188 |
| REVIEW | 1m54 | 3 | 0 |  | 15 | 21 | gpt-6-luna, gpt-6.1-sol | 383688 |
| RATIFICATION | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |
| DISTILL | 1m49 | 1 | 0 |  | 7 | 18 | gpt-6.1-sol | 255098 |
| REVIEW | 1m25 | 4 | 1 |  | 8 | 11.4 | gpt-6-luna, gpt-6.1-sol | 253045 |
| DISTILL | 0m53 | 1 | 0 |  | 5 | 9.3 | gpt-6.1-sol | 257141 |
| REVIEW | 1m01 | 4 | 0 |  | 8 | 8.2 | gpt-6-luna, gpt-6.1-sol | 308706 |
| DELIVER | 32m39 | 6 | 2 | silence, silence | 22 | 43.7 | gpt-6.1-sol, claude-opus-5.5 | 583725 |
| REVIEW | 1m19 | 4 | 1 |  | 11 | 34.4 | gpt-6-luna, gpt-6.1-sol | 500225 |
| DELIVER | 1m06 | 2 | 0 |  | 9 | 7.4 | gpt-6.1-sol | 312319 |
| REVIEW | 1m25 | 4 | 0 |  | 19 | 57.1 | claude-opus-5.5, gpt-6.1-sol | 583591 |
| DONE | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |

## Étapes communes (docs/10 §3)

| Étape | Sous-étapes | Durée | Attente humaine | Hors attente | Agents | Code | Moteur | Tours | Appels | Requêtes premium | Tokens entrée | Tokens sortie | Rejets |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PRÉPARATION |  | 0m05 | 0m00 | 0m05 | 0m00 | 0m05 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |
| DIFFICULTÉ | classifieur, confirmation | 0m07 | 0m00 | 0m07 | 0m06 | 0m01 | 0m00 | 1 | 1 | 0.2 | 15015 | 123 | 0 |
| RESEARCH | blocage | 6m26 | 0m00 | 6m26 | 6m25 | 0m00 | 0m00 | 3 | 63 | 7 | 3951724 | 31787 | 1 |
| QUESTIONS |  | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |
| DESIGN | revue, ratification | 6m59 | 0m00 | 6m59 | 6m56 | 0m01 | 0m00 | 5 | 32 | 67.4 | 1065876 | 25051 | 0 |
| DISTILL | revue | 5m08 | 0m00 | 5m08 | 4m58 | 0m06 | 0m00 | 10 | 28 | 47 | 1073990 | 18487 | 1 |
| DELIVER | revue | 36m30 | 0m00 | 36m30 | 35m37 | 0m40 | 0m03 | 16 | 61 | 142.6 | 1979860 | 17871 | 3 |
| BILAN |  | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |

## Rejets et leurs motifs

### RESEARCH — porte « citations »

- `stories/US-2.md:14-15` : plage hors du fichier, qui compte 14 lignes.
- `stories/US-3.md:14-16` : plage hors du fichier, qui compte 15 lignes.
- `stories/US-5.md:8-14` : plage hors du fichier, qui compte 13 lignes.
- `stories/US-2.md:8-15` : plage hors du fichier, qui compte 14 lignes.

### REVIEW — porte « revue »

- [cold-reader#1.1, major, test] Le scénario AC-3 ne distingue pas la règle formulée comme « remise la plus avantageuse » du choix du palier au seuil le plus élevé : avec des taux croissants (5 % au seuil 10, 12 % au seuil 50), ces deux stratégies donnent toutes deux 12,00 €. Or le modèle de domaine et le plan d’implémentation précisent que les taux ne sont pas supposés croissants et que la remise maximale doit être retenue. Ajoutez une acceptation discriminante avec un taux plus élevé sur un seuil inférieur, afin que l’intention métier soit vérifiable sans déduire qu’un seuil supérieur est toujours préférable. (.skraft/us-2/distill/features/tarification-remise-quantite.feature:14)
- [test-integrity#1.1, major, test] Le test du « plus avantageux » utilise des seuils et taux croissants, avec le meilleur palier en dernière position. Toute la suite laisserait donc passer une sélection du plus grand seuil ou du dernier palier applicable, au lieu du montant maximal. Le DESIGN exige explicitement de vérifier un taux plus avantageux sur un seuil inférieur (consistency-matrix.md), mais cette vérification manque dans les acceptances ; la couverture annoncée comme saturée ne l'est pas sur cette règle. Ajouter une variante d'acceptance avec deux paliers atteints dont le seuil inférieur donne la meilleure remise, et vérifier l'indépendance du résultat à leur ordre. Il ne s'agit pas d'ajouter un test unitaire dupliquant une acceptance existante. (tests/Tarification.Tests/RemiseParQuantiteAcceptanceTests.cs:40)
- Réponds à chaque défaut ci-dessus dans le champ `responses` de report_phase : `fixed` si tu l'as corrigé, `contested` avec ta raison si tu estimes qu'il ne faut pas le corriger, `outOfScope` avec ta raison s'il est juste mais que sa correction n'est pas de ton ressort. Un défaut maintenu après contestation doit être corrigé ; le contester encore soumet le désaccord à l'humain.

### DELIVER — porte « pas test (ac-2) »

- Aucune activité de l'agent depuis 300 s

### DELIVER — porte « pas dev (ac-2) »

- Aucune activité de l'agent depuis 300 s

### REVIEW — porte « revue (correction ciblée) »

- [cold-reader#1.1, major, code] Le calcul choisit le taux maximal mais le type ne borne ni ne valide `Pourcentage`. Or `Montant` interdit les valeurs négatives et `Facture.ATPayer` soustrait la remise du total : un taux négatif échoue lors de `Montant.De`, tandis qu'un taux supérieur à 100 % peut faire échouer le calcul du montant payable. La règle métier sur les taux admissibles n'est pas visible dans ces fichiers, ce qui laisse l'appelant face à une entrée apparemment permise mais à un échec tardif. Rendre l'invariant explicite et rejeter une configuration invalide à sa création, ou exprimer autrement la politique autorisée. (src/Tarification.Domaine/PaliersDeQuantite.cs:7)
- [test-integrity#1.1, major, test] L'addition des remises de plusieurs lignes n'est discriminée par aucune acceptance du projet : tous les cas positifs ont une seule ligne, et le seul cas à deux lignes attend zéro. Dans Panier.SommeDesRemises, remplacer `total + paliers.RemisePour(ligne)` par `paliers.RemisePour(ligne)` laisserait donc toute la suite verte tout en ne conservant que la remise de la dernière ligne. La couverture de lignes à 100 % ne protège pas cette règle du DESIGN. Ajouter une acceptance à la frontière Chiffrer avec deux références bénéficiant chacune d'une remise positive différente, et affirmer leur somme dans Facture.Remise ainsi que le montant payable ; par exemple 10 × 2,00 € et 20 × 2,00 €, palier 10 / 5 %, remise totale 3,00 € et montant payable 57,00 €. Aucun test unitaire dupliqué n'est demandé. (tests/Tarification.Tests/RemiseParQuantiteAcceptanceTests.cs:67)
- [architecture#1.1, major, code] La responsabilité du calcul de remise a été déplacée par rapport au DESIGN approuvé : contracts.md attribue explicitement le calcul indépendant à LigneDePanier et la somme à Panier. Ici, PaliersDeQuantite.RemisePour inspecte la quantité et le sous-total de la ligne et effectue tout le calcul ; LigneDePanier reste dépourvue de ce comportement et Panier appelle directement la collection de paliers. Les couches restent conformes à ADR-001, mais la répartition des responsabilités ne respecte pas le modèle retenu. Porter le calcul de remise sur LigneDePanier et faire sommer ces résultats par Panier ; PaliersDeQuantite peut conserver la sélection du palier applicable. (src/Tarification.Domaine/PaliersDeQuantite.cs:5)
- Réponds à chaque défaut ci-dessus dans le champ `responses` de report_phase : `fixed` si tu l'as corrigé, `contested` avec ta raison si tu estimes qu'il ne faut pas le corriger, `outOfScope` avec ta raison s'il est juste mais que sa correction n'est pas de ton ressort. Un défaut maintenu après contestation doit être corrigé ; le contester encore soumet le désaccord à l'humain.

## Relevés de réserve

- 2026-10-10T15:03:21.484Z — départ : 40773
- 2026-10-10T15:03:21.553Z — INIT : 40773
- 2026-10-10T15:03:26.880Z — CLASSIFY : 40773
- 2026-10-10T15:03:33.929Z — CONFIRM_DIFFICULTY : 40773
- 2026-10-10T15:03:33.939Z — RESEARCH : 40773
- 2026-10-10T15:05:47.172Z — BLOCKED : 40731
- 2026-10-10T15:05:47.185Z — RESEARCH : 40731
- 2026-10-10T15:10:00.422Z — ROUTE : 40722
- 2026-10-10T15:10:00.460Z — DESIGN : 40722
- 2026-10-10T15:15:04.934Z — REVIEW : 40686
- 2026-10-10T15:16:59.314Z — RATIFICATION : 40686
- 2026-10-10T15:16:59.776Z — DISTILL : 40686
- 2026-10-10T15:18:48.647Z — REVIEW : 40686
- 2026-10-10T15:20:13.908Z — DISTILL : 40632
- 2026-10-10T15:21:07.328Z — REVIEW : 40632
- 2026-10-10T15:22:07.982Z — DELIVER : 40632
- 2026-10-10T15:54:47.377Z — REVIEW : 40569
- 2026-10-10T15:56:06.126Z — DELIVER : 40569
- 2026-10-10T15:57:12.566Z — REVIEW : 40569
- 2026-10-10T15:58:37.501Z — DONE : 40472
- 2026-10-10T15:58:40.941Z — fin : 40472
