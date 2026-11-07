# Comparaison extension / workflow skraft — us-2 — 2026-10-10

Produit par `scripts/banc/comparer.ts` (`docs/10` §7) depuis 2 run(s) : `2026-10-10-us-2-workflow-cffee616`, `2026-10-10-us-2-extension-521f0098`.
Les valeurs sont la médiane des runs, suivie des valeurs brutes entre parenthèses.

## 1. Synthèse

| Mesure | workflow skraft | extension skraft |
|---|---|---|
| Livré | 1/1 | 0/1 — arrêts : plafond de 350 requêtes premium atteint (352.5 comptabilisées) |
| Durée hors attente humaine | 55m16 (55m16) | 16m40 (16m40) |
| Attente humaine | 0m00 (0m00) | 0m00 (0m00) |
| Requêtes premium | 264.3 (264.3) | 352.5 (352.5) |
| Tokens d'entrée | 8086465 (8086465) | 5324728 (5324728) |
| Tokens de sortie | 93319 (93319) | 82100 (82100) |
| Rejeux | 5 (5) | 3 (3) |
| Interventions humaines | 5 (5) | 4 (4) |

## 2. Par étape

| Run | Étape | Sous-étapes | Durée | Agents | Code | Moteur | Attente humaine | Tours | Appels | Requêtes premium | Tokens entrée | Tokens sortie | Rejeux |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| workflow skraft · 2026-10-10-us-2-workflow-cffee616 | PRÉPARATION |  | 0m05 | 0m00 | 0m05 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |
| workflow skraft · 2026-10-10-us-2-workflow-cffee616 | DIFFICULTÉ | classifieur, confirmation | 0m07 | 0m06 | 0m01 | 0m00 | 0m00 | 1 | 1 | 0.2 | 15015 | 123 | 0 |
| workflow skraft · 2026-10-10-us-2-workflow-cffee616 | RESEARCH | blocage | 6m26 | 6m25 | 0m00 | 0m00 | 0m00 | 3 | 63 | 7 | 3951724 | 31787 | 1 |
| workflow skraft · 2026-10-10-us-2-workflow-cffee616 | QUESTIONS |  | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |
| workflow skraft · 2026-10-10-us-2-workflow-cffee616 | DESIGN | revue, ratification | 6m59 | 6m56 | 0m01 | 0m00 | 0m00 | 5 | 32 | 67.4 | 1065876 | 25051 | 0 |
| workflow skraft · 2026-10-10-us-2-workflow-cffee616 | DISTILL | revue | 5m08 | 4m58 | 0m06 | 0m00 | 0m00 | 10 | 28 | 47 | 1073990 | 18487 | 1 |
| workflow skraft · 2026-10-10-us-2-workflow-cffee616 | DELIVER | revue | 36m30 | 35m37 | 0m40 | 0m03 | 0m00 | 16 | 61 | 142.6 | 1979860 | 17871 | 3 |
| workflow skraft · 2026-10-10-us-2-workflow-cffee616 | BILAN |  | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |
| extension skraft · 2026-10-10-us-2-extension-521f0098 | PRÉPARATION |  | 0m00 | 0m00 | 0m05 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |
| extension skraft · 2026-10-10-us-2-extension-521f0098 | DIFFICULTÉ | classifieur, confirmation | 0m12 | 0m12 | 0m01 | 0m00 | 0m00 | 1 | 3 | 0.2 | 45553 | 358 | 0 |
| extension skraft · 2026-10-10-us-2-extension-521f0098 | RESEARCH | blocage | 2m44 | 2m44 | 0m00 | 0m00 | 0m00 | 3 | 13 | 25.5 | 385725 | 9758 | 1 |
| extension skraft · 2026-10-10-us-2-extension-521f0098 | QUESTIONS |  | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |
| extension skraft · 2026-10-10-us-2-extension-521f0098 | DESIGN | blocage, revue | 11m31 | 12m45 | 0m01 | 0m00 | 0m00 | 13 | 70 | 297 | 4361728 | 62817 | 2 |
| extension skraft · 2026-10-10-us-2-extension-521f0098 | DISTILL | revue | 2m13 | 2m39 | 0m03 | 0m00 | 0m00 | 5 | 13 | 29.8 | 531722 | 9167 | 0 |
| extension skraft · 2026-10-10-us-2-extension-521f0098 | BILAN | abandon | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |

## 3. Rejeux, run par run

### workflow skraft · 2026-10-10-us-2-workflow-cffee616

1. **RESEARCH**, essai 1, porte, porte « citations »
   - `stories/US-2.md:14-15` : plage hors du fichier, qui compte 14 lignes.
   - `stories/US-3.md:14-16` : plage hors du fichier, qui compte 15 lignes.
   - `stories/US-5.md:8-14` : plage hors du fichier, qui compte 13 lignes.
   - `stories/US-2.md:8-15` : plage hors du fichier, qui compte 14 lignes.
2. **DISTILL · revue**, essai 1, revue, porte « revue »
   - [cold-reader#1.1, major, test] Le scénario AC-3 ne distingue pas la règle formulée comme « remise la plus avantageuse » du choix du palier au seuil le plus élevé : avec des taux croissants (5 % au seuil 10, 12 % au seuil 50), ces deux stratégies donnent toutes deux 12,00 €. Or le modèle de domaine et le plan d’implémentation précisent que les taux ne sont pas supposés croissants et que la remise maximale doit être retenue. Ajoutez une acceptation discriminante avec un taux plus élevé sur un seuil inférieur, afin que l’intention métier soit vérifiable sans déduire qu’un seuil supérieur est toujours préférable. (.skraft/us-2/distill/features/tarification-remise-quantite.feature:14)
   - [test-integrity#1.1, major, test] Le test du « plus avantageux » utilise des seuils et taux croissants, avec le meilleur palier en dernière position. Toute la suite laisserait donc passer une sélection du plus grand seuil ou du dernier palier applicable, au lieu du montant maximal. Le DESIGN exige explicitement de vérifier un taux plus avantageux sur un seuil inférieur (consistency-matrix.md), mais cette vérification manque dans les acceptances ; la couverture annoncée comme saturée ne l'est pas sur cette règle. Ajouter une variante d'acceptance avec deux paliers atteints dont le seuil inférieur donne la meilleure remise, et vérifier l'indépendance du résultat à leur ordre. Il ne s'agit pas d'ajouter un test unitaire dupliquant une acceptance existante. (tests/Tarification.Tests/RemiseParQuantiteAcceptanceTests.cs:40)
   - Réponds à chaque défaut ci-dessus dans le champ `responses` de report_phase : `fixed` si tu l'as corrigé, `contested` avec ta raison si tu estimes qu'il ne faut pas le corriger, `outOfScope` avec ta raison s'il est juste mais que sa correction n'est pas de ton ressort. Un défaut maintenu après contestation doit être corrigé ; le contester encore soumet le désaccord à l'humain.
3. **DELIVER**, essai 1, porte, porte « pas test (ac-2) »
   - Aucune activité de l'agent depuis 300 s
4. **DELIVER**, essai 2, porte, porte « pas dev (ac-2) »
   - Aucune activité de l'agent depuis 300 s
5. **DELIVER · revue**, essai 3, porte, porte « revue (correction ciblée) »
   - [cold-reader#1.1, major, code] Le calcul choisit le taux maximal mais le type ne borne ni ne valide `Pourcentage`. Or `Montant` interdit les valeurs négatives et `Facture.ATPayer` soustrait la remise du total : un taux négatif échoue lors de `Montant.De`, tandis qu'un taux supérieur à 100 % peut faire échouer le calcul du montant payable. La règle métier sur les taux admissibles n'est pas visible dans ces fichiers, ce qui laisse l'appelant face à une entrée apparemment permise mais à un échec tardif. Rendre l'invariant explicite et rejeter une configuration invalide à sa création, ou exprimer autrement la politique autorisée. (src/Tarification.Domaine/PaliersDeQuantite.cs:7)
   - [test-integrity#1.1, major, test] L'addition des remises de plusieurs lignes n'est discriminée par aucune acceptance du projet : tous les cas positifs ont une seule ligne, et le seul cas à deux lignes attend zéro. Dans Panier.SommeDesRemises, remplacer `total + paliers.RemisePour(ligne)` par `paliers.RemisePour(ligne)` laisserait donc toute la suite verte tout en ne conservant que la remise de la dernière ligne. La couverture de lignes à 100 % ne protège pas cette règle du DESIGN. Ajouter une acceptance à la frontière Chiffrer avec deux références bénéficiant chacune d'une remise positive différente, et affirmer leur somme dans Facture.Remise ainsi que le montant payable ; par exemple 10 × 2,00 € et 20 × 2,00 €, palier 10 / 5 %, remise totale 3,00 € et montant payable 57,00 €. Aucun test unitaire dupliqué n'est demandé. (tests/Tarification.Tests/RemiseParQuantiteAcceptanceTests.cs:67)
   - [architecture#1.1, major, code] La responsabilité du calcul de remise a été déplacée par rapport au DESIGN approuvé : contracts.md attribue explicitement le calcul indépendant à LigneDePanier et la somme à Panier. Ici, PaliersDeQuantite.RemisePour inspecte la quantité et le sous-total de la ligne et effectue tout le calcul ; LigneDePanier reste dépourvue de ce comportement et Panier appelle directement la collection de paliers. Les couches restent conformes à ADR-001, mais la répartition des responsabilités ne respecte pas le modèle retenu. Porter le calcul de remise sur LigneDePanier et faire sommer ces résultats par Panier ; PaliersDeQuantite peut conserver la sélection du palier applicable. (src/Tarification.Domaine/PaliersDeQuantite.cs:5)
   - Réponds à chaque défaut ci-dessus dans le champ `responses` de report_phase : `fixed` si tu l'as corrigé, `contested` avec ta raison si tu estimes qu'il ne faut pas le corriger, `outOfScope` avec ta raison s'il est juste mais que sa correction n'est pas de ton ressort. Un défaut maintenu après contestation doit être corrigé ; le contester encore soumet le désaccord à l'humain.

### extension skraft · 2026-10-10-us-2-extension-521f0098

1. **RESEARCH**, essai 1, porte, porte « citations »
   - `tests/Tarification.Tests/CalculDuPanierTests.cs:13-55` : plage hors du fichier, qui compte 50 lignes.
   - `tests/Tarification.Tests/CalculDuPanierTests.cs:1-55` : plage hors du fichier, qui compte 50 lignes.
   - `tests/Tarification.Tests/CalculDuPanierTests.cs:16-55` : plage hors du fichier, qui compte 50 lignes.
2. **DESIGN**, essai 1, porte, porte « cohérence »
   - `ArgumentOutOfRangeException` cité dans contracts.md n'existe pas dans event-model.md ni dans domain-model.md.
3. **DESIGN**, essai 2, revue, porte « revue »
   - [cold-reader#1.1, blocker, deliverable] La matrice de cohérence ne respecte pas le gate G10 de la revue d’architecture : elle n’expose pas la ligne de validation attendue `consistency-gate: PASS` et son nom ne suit pas le format attendu `consistency-matrix-{story}.md`. Sans cette preuve explicite, le design n’a pas de trace de cohérence formelle pour US-2, ce qui invalide la phase DESIGN. (.skraft/us-2/design/consistency-matrix.md)
   - Réponds à chaque défaut ci-dessus dans le champ `responses` de report_phase : `fixed` si tu l'as corrigé, `contested` avec ta raison si tu estimes qu'il ne faut pas le corriger, `outOfScope` avec ta raison s'il est juste mais que sa correction n'est pas de ton ressort. Un défaut maintenu après contestation doit être corrigé ; le contester encore soumet le désaccord à l'humain.

## 4. Rejeux mis en regard, par porte

Un rejet présent d'un seul côté doit être expliqué (différence connue ou hasard du modèle) : aucun écart sans explication.

| Porte | workflow skraft | extension skraft | Explication |
|---|---|---|---|
| citations | 1 (1) | 1 (1) |  |
| cohérence | 0 (0) | 1 (1) | **à expliquer** |
| pas | 2 (2) | 0 (0) | **à expliquer** |
| revue | 2 (2) | 1 (1) |  |

## 5. Écarts de comportement

Différences assumées (`docs/10` §2), à confronter aux écarts observés ci-dessus :

- le workflow fait oublier aux agents leur session après un rembobinage (ADR 0053) ; l'extension ne le faisait pas en DELIVER ;
- plusieurs amendements d'ADR sont traités ensemble dans le workflow ;
- « relancer » après une escalade pendant une correction de revue reprend la correction.

Écarts observés : workflow livré ; extension arrêtée au plafond pendant la revue
DISTILL, avant DELIVER. DESIGN et ses revues coûtent 297 requêtes équivalentes SDK
côté extension, contre 67,4 côté workflow. L'extension a repris DESIGN sur une
incohérence de modèle puis sur une exigence de format de matrice soulevée par une
lentille. Le workflow a subi deux interruptions pour silence en DELIVER.

**Limites** : un seul couple mesuré ; associations de modèles non imposées et
modèles effectifs différents. Le même répondeur choisit le premier choix proposé
aux blocages sans règle configurée, ce qui ne garantit pas des précisions métier
identiques. Ces résultats ne démontrent donc pas à eux seuls un avantage causal
du moteur workflow. L'indicateur de livraison du workflow a été corrigé depuis
son résultat persisté (annotation dans son rapport), sans rejouer le run.
