# Comparaison extension / workflow skraft — us-2-extension-600 — 2026-10-10

Produit par `scripts/banc/comparer.ts` (`docs/10` §7) depuis 2 run(s) : `2026-10-10-us-2-workflow-cffee616`, `2026-10-10-us-2-extension-c4433175`.
Les valeurs sont la médiane des runs, suivie des valeurs brutes entre parenthèses.

## 1. Synthèse

| Mesure | workflow skraft | extension skraft |
|---|---|---|
| Livré | 1/1 | 1/1 |
| Durée hors attente humaine | 55m16 (55m16) | 17m25 (17m25) |
| Attente humaine | 0m00 (0m00) | 0m00 (0m00) |
| Requêtes premium | 264.3 (264.3) | 232.2 (232.2) |
| Tokens d'entrée | 8086465 (8086465) | 5087423 (5087423) |
| Tokens de sortie | 93319 (93319) | 82983 (82983) |
| Rejeux | 5 (5) | 4 (4) |
| Interventions humaines | 5 (5) | 5 (5) |

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
| extension skraft · 2026-10-10-us-2-extension-c4433175 | PRÉPARATION |  | 0m00 | 0m00 | 0m04 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |
| extension skraft · 2026-10-10-us-2-extension-c4433175 | DIFFICULTÉ | classifieur, confirmation | 0m07 | 0m07 | 0m00 | 0m00 | 0m00 | 1 | 1 | 0.2 | 15015 | 53 | 0 |
| extension skraft · 2026-10-10-us-2-extension-c4433175 | RESEARCH | blocage | 2m16 | 2m15 | 0m00 | 0m00 | 0m00 | 3 | 13 | 22 | 356779 | 7949 | 1 |
| extension skraft · 2026-10-10-us-2-extension-c4433175 | QUESTIONS |  | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |
| extension skraft · 2026-10-10-us-2-extension-c4433175 | DESIGN | blocage, revue | 9m00 | 10m19 | 0m01 | 0m00 | 0m00 | 14 | 57 | 127.1 | 2740431 | 47993 | 2 |
| extension skraft · 2026-10-10-us-2-extension-c4433175 | DISTILL | revue | 2m24 | 2m59 | 0m03 | 0m00 | 0m00 | 5 | 17 | 30.3 | 614079 | 11972 | 0 |
| extension skraft · 2026-10-10-us-2-extension-c4433175 | DELIVER | revue | 3m38 | 4m33 | 0m27 | 0m00 | 0m00 | 12 | 40 | 52.7 | 1361119 | 15016 | 1 |
| extension skraft · 2026-10-10-us-2-extension-c4433175 | BILAN |  | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |

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

### extension skraft · 2026-10-10-us-2-extension-c4433175

1. **RESEARCH**, essai 1, porte, porte « citations »
   - Section manquante : « Recommandation ».
   - Section manquante : « Passage de relais ».
2. **DESIGN**, essai 1, porte, porte « cohérence »
   - `ArgumentOutOfRangeException` cité dans contracts.md n'existe pas dans event-model.md ni dans domain-model.md.
   - `ArgumentException` cité dans contracts.md n'existe pas dans event-model.md ni dans domain-model.md.
   - `ArgumentNullException` cité dans contracts.md n'existe pas dans event-model.md ni dans domain-model.md.
3. **DESIGN**, essai 2, revue, porte « revue »
   - [cold-reader#1.1, major, deliverable] Le modèle de domaine présente GrilleDePaliers comme racine d’agrégat, puis comme objet-valeur composite, et dit explicitement que son rôle reste à confirmer. Cette ambiguïté laisse les invariants, la responsabilité de calcul et les frontières de couche non stabilisées, donc le design n’est pas assez défini pour être validé. (.skraft/us-2/design/domain-model.md:34)
   - [cold-reader#1.2, major, deliverable] Le document transmet explicitement cinq décisions de conception à l’étape suivante (transmission de la grille, raccord ATPayer, opérations monétaires, représentation du taux, emplacement des tests). En phase DESIGN, cela signifie que le contrat métier et l’architecture ne sont pas clos ; le livrable reste incomplet et nécessite un cadrage avant validation. (.skraft/us-2/design/domain-model.md:75)
   - Réponds à chaque défaut ci-dessus dans le champ `responses` de report_phase : `fixed` si tu l'as corrigé, `contested` avec ta raison si tu estimes qu'il ne faut pas le corriger, `outOfScope` avec ta raison s'il est juste mais que sa correction n'est pas de ton ressort. Un défaut maintenu après contestation doit être corrigé ; le contester encore soumet le désaccord à l'humain.
4. **DELIVER**, essai 1, revue, porte « revue »
   - [test-integrity#1.1, major, test] Aucun test ne vérifie les rejets de configuration pourtant clarifiés et prévus pour la boucle interne : seuil invalide, taux hors ]0,100], seuils dupliqués. Les acceptances ne construisent que des configurations valides ; la fabrique appelle même Quantite.De avant PalierDeQuantite, empêchant d'éprouver le seuil par défaut. Les types provisoires sans validation passent donc toute la suite. Ajouter des tests de construction avec assertions sur les exceptions attendues, incluant default(Quantite), et l'acceptation de 100 %. Ce comportement n'est couvert par aucune acceptance existante. (tests/Tarification.Tests/RemiseParQuantiteAcceptanceTests.cs:93)
   - [test-integrity#1.2, major, test] L'immuabilité de la grille, obligation du DESIGN et du plan de réalisation, n'est éprouvée par aucun test. Chaque acceptance fournit un tableau qui n'est jamais modifié ensuite : conserver directement cette collection mutable, comme le fait actuellement GrilleDePaliers, reste indétectable. Ajouter un test qui construit la grille depuis une collection mutable, chiffre une ligne éligible, modifie la collection source puis exige le même résultat. Il ne duplique aucun comportement actuellement vérifié par acceptance. (tests/Tarification.Tests/RemiseParQuantiteAcceptanceTests.cs:93)
   - [test-integrity#1.3, major, test] Le seul cas à plusieurs paliers place le taux maximal au dernier et au plus grand seuil. Il ne distingue pas le maximum promis d'une sélection du dernier palier atteint ou du plus grand seuil : ces remplacements laisseraient toutes les acceptances vertes. La matrice DESIGN exigeait précisément 10 : 12 % et 50 : 5 %, dans les deux ordres, pour une ligne de 50 × 2,00 € avec remise 12,00 €. Ajouter cette vérification complémentaire sans modifier les acceptances gelées ; aucune acceptance existante ne couvre cette distinction. (tests/Tarification.Tests/RemiseParQuantiteAcceptanceTests.cs:38)
   - Réponds à chaque défaut ci-dessus dans le champ `responses` de report_phase : `fixed` si tu l'as corrigé, `contested` avec ta raison si tu estimes qu'il ne faut pas le corriger, `outOfScope` avec ta raison s'il est juste mais que sa correction n'est pas de ton ressort. Un défaut maintenu après contestation doit être corrigé ; le contester encore soumet le désaccord à l'humain.
   - [cold-reader#1.1, major, code] La grille n’applique aucune validation ni copie défensive : le constructeur accepte une liste arbitraire, sans vérifier seuil >= 1, taux dans ]0 %, 100 %], ni unicité des seuils. Le design exige un objet valeur immuable, rejet explicite à la construction et collection non modifiable. Une mutation externe de la liste après construction continue d’affecter la grille, ce qui viole le contrat. (src/Tarification.Domaine/GrilleDePaliers.cs:3)
   - [cold-reader#1.2, major, code] Le calcul de remise via `Multiplie(TauxDeRemise)` ne garantit pas le contrat métier du taux : le design impose un pourcentage strictement > 0 et <= 100, avec rejet explicite quand la configuration est invalide. Ici toute valeur de `TauxDeRemise` est acceptée sans validation, ce qui permet des remises arbitraires et casse le contrat d’intégrité de la grille. (src/Tarification.Domaine/Montant.cs:18)
   - [architecture#1.1, major, code] Les invariants de configuration ratifiés ne sont pas appliqués dans le domaine : TauxDeRemise accepte tout decimal, PalierDeQuantite accepte un Quantite par défaut de valeur 0, et GrilleDePaliers accepte des seuils dupliqués. Ces signatures provisoires de DISTILL subsistent dans la livraison. Un taux nul devient silencieusement une remise nulle ; un taux supérieur à 100 peut produire une remise supérieure au sous-total, puis un rejet tardif lors du calcul de ATPayer. Appliquer le rejet explicite à la construction prévu par design/contracts.md:15-19 et research/clarification.md:15, avant qu'une configuration soit utilisable. (src/Tarification.Domaine/TauxDeRemise.cs:4)
   - [architecture#1.2, major, code] GrilleDePaliers conserve et expose directement la collection reçue. IReadOnlyList n'empêche pas la mutation de la List sous-jacente par l'appelant : modifier cette liste après construction change les remises calculées avec la même grille. Cela contredit l'objet-valeur composite immuable retenu en DESIGN et la copie non modifiable exigée par design/contracts.md:17. Prendre une copie défensive et ne pas exposer de collection modifiable afin que la configuration validée reste stable. (src/Tarification.Domaine/GrilleDePaliers.cs:3)
   - Réponds à chaque défaut ci-dessus dans le champ `responses` de report_phase : `fixed` si tu l'as corrigé, `contested` avec ta raison si tu estimes qu'il ne faut pas le corriger, `outOfScope` avec ta raison s'il est juste mais que sa correction n'est pas de ton ressort. Un défaut maintenu après contestation doit être corrigé ; le contester encore soumet le désaccord à l'humain.

## 4. Rejeux mis en regard, par porte

Un rejet présent d'un seul côté doit être expliqué (différence connue ou hasard du modèle) : aucun écart sans explication.

| Porte | workflow skraft | extension skraft | Explication |
|---|---|---|---|
| citations | 1 (1) | 1 (1) |  |
| cohérence | 0 (0) | 1 (1) | **à expliquer** |
| pas | 2 (2) | 0 (0) | **à expliquer** |
| revue | 2 (2) | 2 (2) |  |

## 5. Écarts de comportement

Différences assumées (`docs/10` §2), à confronter aux écarts observés ci-dessus :

- le workflow fait oublier aux agents leur session après un rembobinage (ADR 0053) ; l'extension ne le faisait pas en DELIVER ;
- plusieurs amendements d'ADR sont traités ensemble dans le workflow ;
- « relancer » après une escalade pendant une correction de revue reprend la correction.

Les deux runs sont livrés. Extension c4433175 : 17m35, 232,2 requêtes équivalentes
SDK ; workflow cffee616 : 55m21, 264,3. L'extension a reçu un plafond de 600 contre
350 pour le workflow, mais les deux consommations restent sous 350. Le run extension
précédent arrêté à 352,5 est conservé dans la comparaison séparée.

Vérifications indépendantes : extension 21/21 tests verts, workflow 13/13.
Les nombres ne mesurent pas seuls la qualité : les clarifications et invariants
de configuration diffèrent. Les modèles effectifs n'étaient pas imposés. Le workflow
a subi deux interruptions pour silence, absentes de ce run extension. Ce couple
ne suffit donc pas à attribuer l'écart au moteur ou à l'augmentation du plafond.

## 6. Lecture comparée des livrables contre US-2

Lecture du 10/10 : story `stories/US-2.md` et documents RESEARCH, DESIGN, DISTILL
et revues des copies livrées cffee616 (workflow) et c4433175 (extension). Les tests
associés ont été lus pour distinguer une promesse documentaire d'une vérification.
Les artefacts des runs n'ont pas été modifiés par cette analyse.

### Fidélité au besoin

Les deux versions reprennent les cinq critères et leurs montants exacts : sous le
seuil zéro, seuil 10 donnant 1,00 €, meilleur palier donnant 12,00 €, deux références
de quantité 6 sans cumul, absence de paliers donnant zéro. La portée commune des
paliers est clarifiée dans les deux. Les contrats ajoutent le raccord cohérent
`ATPayer = SommeDesArticles - Remise + FraisDePort`, absent des exemples de la story
mais nécessaire pour que la remise s'applique. Les deux excluent stockage,
administration, promotions et arrondi général.

### Différences par phase

| Phase | Extension c4433175 | Workflow cffee616 |
| --- | --- | --- |
| RESEARCH | Plus détaillée, quatre options, risques d'invariants et de compatibilité ; clarification séparée | Plus concise, quatre options, portée commune et liens US-3/US-5 ; clarification intégrée |
| DESIGN | GrilleDePaliers immuable, TauxDeRemise, validation explicite ; calcul dans la grille, cumul dans Panier | PaliersDeQuantite et pourcentage decimal ; calcul dans LigneDePanier, cumul dans Panier ; validations non décidées explicitement hors périmètre |
| DISTILL | Six scénarios, dont deux variantes AC-5 ; facture entière observée dans chaque test ; meilleur palier inversé absent avant gel | Cinq critères et variante AC-3 à deux ordres après refus de revue ; seuil inférieur plus avantageux éprouvé avant gel |
| Revues | DESIGN fermé après refus ; DISTILL approuvé malgré trou AC-3 ; DELIVER récupère invariants, immuabilité et discrimination du maximum | DESIGN approuvé avec réserve sur taux ; DISTILL corrige AC-3 ; DELIVER corrige somme multi-lignes et responsabilité de calcul, mais accepte l'absence de bornes comme limite de périmètre |

**Différence métier déterminante** : extension
`research/clarification.md:11-15` impose seuil >= 1, taux dans ]0,100] et rejet des
seuils dupliqués. Workflow `design/contracts.md:64` refuse d'inventer ces bornes.
L'interaction archivée `369c980e-c649-4ee8-9216-b40f476f7013` montre que la
clarification extension est le premier choix proposé, sélectionné par le répondeur
automatique, pas une réponse humaine saisie pour ce run. Les documents parlent
pourtant de « réponse utilisateur ». Les deux livraisons ne réalisent donc pas
exactement le même contrat au-delà des cinq critères.

### Faiblesses constatées

1. **Extension : exigence du maximum récupérée trop tard.** DESIGN
   `consistency-matrix.md` exige déjà 10/12 % contre 50/5 %, dans les deux ordres.
   DISTILL ne l'éprouve pas et sa revue l'approuve. DELIVER review 1 signale enfin
   ce manque ; `RemiseParQuantiteTests` le couvre après correction, hors acceptance
   gelée. La livraison est protégée sur ce point, mais le contrôle DISTILL l'a manqué.
2. **Extension : somme des remises positives non protégée.** Tous les cas positifs
   des tests lus ont une seule ligne ; le seul panier multi-lignes avec grille a
   deux remises nulles. Aucun test n'exige 1 € + 2 € = 3 €. Le code additionne bien,
   mais une régression ne conservant que la dernière remise ne serait pas distinguée
   par ces exemples. Le workflow a reçu exactement ce grief et ajouté
   `CalculDuPanierRemisesTests.Les_remises_de_deux_references_s_additionnent_sur_la_facture`.
3. **Plan extension incomplet après livraison.** DISTILL annonce les invariants à
   réaliser dans la boucle interne ; cette boucle les laisse provisoires jusqu'à
   la revue DELIVER. La revue les récupère correctement, mais l'exécution initiale
   n'a pas couvert toutes les obligations du plan.
4. **Documents DESIGN encore intermédiaires.** Extension `event-model.md` reporte
   publication/persistance à l'étape suivante alors que `contracts.md` les ferme.
   Workflow `domain-model.md` conserve des points « à instruire » que les contrats
   ont déjà tranchés. Les contrats sont plus définitifs que certains documents voisins.
5. **Références et lisibilité.** Les documents citent parfois des versions antérieures
   du code et des lignes déplacées ; leur lecture comme références du livrable final
   peut induire en erreur. Le workflow garde aussi le grief mineur de notation
   « M4 negative — saturated by AC » et « A » non définis, signalé dans sa revue
   DISTILL. L'approbation n'équivaut donc pas à des documents entièrement nettoyés.

Conclusion : extension plus explicite sur les invariants et la compatibilité ;
workflow plus discriminant sur AC-3 dès DISTILL et sur la somme multi-lignes après
revue. Aucun vainqueur documentaire absolu. La quantité de tests ou le verdict
APPROVED ne remplace ni la traçabilité du contrat ni des exemples discriminants.
