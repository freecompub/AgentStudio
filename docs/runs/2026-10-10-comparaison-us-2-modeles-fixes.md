# Comparaison extension / workflow skraft — us-2-modeles-fixes — 2026-10-10

Produit par `scripts/banc/comparer.ts` (`docs/10` §7) depuis 2 run(s) : `2026-10-10-us-2-extension-c4433175`, `2026-10-10-us-2-workflow-0b3184b5`.
Les valeurs sont la médiane des runs, suivie des valeurs brutes entre parenthèses.

## 1. Synthèse

| Mesure | extension skraft | workflow skraft |
|---|---|---|
| Livré | 1/1 | 1/1 |
| Durée hors attente humaine | 17m25 (17m25) | 17m53 (17m53) |
| Attente humaine | 0m00 (0m00) | 0m00 (0m00) |
| Requêtes premium | 232.2 (232.2) | 335.4 (335.4) |
| Tokens d'entrée | 5087423 (5087423) | 4019194 (4019194) |
| Tokens de sortie | 82983 (82983) | 61582 (61582) |
| Rejeux | 4 (4) | 1 (1) |
| Interventions humaines | 5 (5) | 6 (6) |

## 2. Par étape

| Run | Étape | Sous-étapes | Durée | Agents | Code | Moteur | Attente humaine | Tours | Appels | Requêtes premium | Tokens entrée | Tokens sortie | Rejeux |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| extension skraft · 2026-10-10-us-2-extension-c4433175 | PRÉPARATION |  | 0m00 | 0m00 | 0m04 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |
| extension skraft · 2026-10-10-us-2-extension-c4433175 | DIFFICULTÉ | classifieur, confirmation | 0m07 | 0m07 | 0m00 | 0m00 | 0m00 | 1 | 1 | 0.2 | 15015 | 53 | 0 |
| extension skraft · 2026-10-10-us-2-extension-c4433175 | RESEARCH | blocage | 2m16 | 2m15 | 0m00 | 0m00 | 0m00 | 3 | 13 | 22 | 356779 | 7949 | 1 |
| extension skraft · 2026-10-10-us-2-extension-c4433175 | QUESTIONS |  | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |
| extension skraft · 2026-10-10-us-2-extension-c4433175 | DESIGN | blocage, revue | 9m00 | 10m19 | 0m01 | 0m00 | 0m00 | 14 | 57 | 127.1 | 2740431 | 47993 | 2 |
| extension skraft · 2026-10-10-us-2-extension-c4433175 | DISTILL | revue | 2m24 | 2m59 | 0m03 | 0m00 | 0m00 | 5 | 17 | 30.3 | 614079 | 11972 | 0 |
| extension skraft · 2026-10-10-us-2-extension-c4433175 | DELIVER | revue | 3m38 | 4m33 | 0m27 | 0m00 | 0m00 | 12 | 40 | 52.7 | 1361119 | 15016 | 1 |
| extension skraft · 2026-10-10-us-2-extension-c4433175 | BILAN |  | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |
| workflow skraft · 2026-10-10-us-2-workflow-0b3184b5 | PRÉPARATION |  | 0m04 | 0m00 | 0m04 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |
| workflow skraft · 2026-10-10-us-2-workflow-0b3184b5 | DIFFICULTÉ | classifieur, confirmation | 0m05 | 0m04 | 0m01 | 0m00 | 0m00 | 1 | 1 | 0.2 | 15038 | 55 | 0 |
| workflow skraft · 2026-10-10-us-2-workflow-0b3184b5 | RESEARCH | blocage | 2m26 | 2m24 | 0m00 | 0m00 | 0m00 | 3 | 13 | 43.4 | 471704 | 8805 | 1 |
| workflow skraft · 2026-10-10-us-2-workflow-0b3184b5 | QUESTIONS |  | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |
| workflow skraft · 2026-10-10-us-2-workflow-0b3184b5 | DESIGN | blocage, revue, ratification | 6m02 | 5m58 | 0m01 | 0m00 | 0m00 | 8 | 32 | 103.7 | 1249123 | 28318 | 0 |
| workflow skraft · 2026-10-10-us-2-workflow-0b3184b5 | DISTILL | revue | 3m59 | 3m55 | 0m03 | 0m00 | 0m00 | 5 | 16 | 85.6 | 565168 | 14816 | 0 |
| workflow skraft · 2026-10-10-us-2-workflow-0b3184b5 | DELIVER | revue | 5m16 | 4m07 | 0m57 | 0m05 | 0m00 | 12 | 49 | 102.5 | 1718161 | 9588 | 0 |
| workflow skraft · 2026-10-10-us-2-workflow-0b3184b5 | BILAN |  | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |

## 3. Rejeux, run par run

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

### workflow skraft · 2026-10-10-us-2-workflow-0b3184b5

1. **RESEARCH**, essai 1, porte, porte « citations »
   - Section manquante : « Recommandation ».
   - Section manquante : « Passage de relais ».

## 4. Rejeux mis en regard, par porte

Un rejet présent d'un seul côté doit être expliqué (différence connue ou hasard du modèle) : aucun écart sans explication.

| Porte | extension skraft | workflow skraft | Explication |
|---|---|---|---|
| citations | 1 (1) | 1 (1) |  |
| cohérence | 1 (1) | 0 (0) | **à expliquer** |
| revue | 2 (2) | 0 (0) | **à expliquer** |

## 5. Écarts de comportement

Différences assumées (`docs/10` §2), à confronter aux écarts observés ci-dessus :

- le workflow fait oublier aux agents leur session après un rembobinage (ADR 0053) ; l'extension ne le faisait pas en DELIVER ;
- plusieurs amendements d'ADR sont traités ensemble dans le workflow ;
- « relancer » après une escalade pendant une correction de revue reprend la correction.

Workflow 0b3184b5 livré en 17m58 pour 335,4 requêtes équivalentes SDK ;
extension c4433175 livrée en 17m35 pour 232,2. Même plafond 600. Modèles
workflow verrouillés par rôle et vérifiés dans tous les événements usage.
Cold-reader est fixé à gpt-6.1-sol, par choix utilisateur, alors que l'extension
avait aussi utilisé mai-code-1.1-flash : égalité des modèles non totale.

Le workflow a cette fois posé trois questions DESIGN : provenance du barème,
déduction dans ATPayer, validité des configurations. La dernière réponse
automatique autorise taux 0 % et 100 %, contrairement à l'extension qui exclut
zéro. Le répondeur reste un facteur de divergence des contrats, malgré les
modèles fixés. Aucun silence dans ce run. Vérifications indépendantes : workflow
24/24 tests verts, extension 21/21. Pas de conclusion causale sur un seul couple.

## 6. Comparaison des productions finales

Lecture du code, des tests, de RESEARCH, des contrats et de la matrice DESIGN,
du plan DISTILL et des trois revues du workflow 0b3184b5 ; comparaison avec les
artefacts de l'extension c4433175 déjà analysés. Aucun livrable modifié.

| Surface | Extension c4433175 | Workflow 0b3184b5 |
| --- | --- | --- |
| Cinq critères US-2 | Présents | Présents |
| Recherche | Recommande une règle dédiée, puis GrilleDePaliers | Recommande le comportement porté par les objets, puis BaremeDeRemise |
| Répartition du calcul | Grille sélectionne et calcule ; Panier somme | Barème sélectionne le taux ; Ligne calcule ; Panier somme |
| Valeurs | Seuil Quantite, taux record struct | Seuil int, taux record class |
| Bornes du taux | ]0,100] | [0,100] |
| Immutabilité de la configuration | Copie puis Array.AsReadOnly, test de mutation de collection source | Copie puis Array.AsReadOnly, pas de test de mutation de collection source |
| Acceptances | Six exemples, invariants et variantes ajoutés hors fichiers gelés après revue | Dix-neuf exemples dès DISTILL, dont invalides, bornes et somme multi-lignes |
| Revues | DESIGN et DELIVER demandent des corrections, puis approuvent | DESIGN, DISTILL et DELIVER approuvés au premier passage |
| Livrable | 21 tests au total | 24 tests au total |

Les deux calculs métier sont cohérents pour les exemples : maximum parmi les
paliers atteints, aucune somme des quantités entre lignes, somme brute conservée,
déduction de la remise dans ATPayer, appel historique sans barème préservé,
decimal sans arrondi ajouté. Aucun nouveau stockage, service externe ou ADR.

### Différences de protection, pas seulement de nombre de tests

- **Somme multi-lignes : avantage workflow.** Son acceptance
  `Ac4_Le_client_cumule_les_remises_de_lignes_eligibles_avec_le_meme_bareme` exige
  1 € + 1 € = 2 €. L'extension n'a aucun exemple à deux remises positives.
  Le cas workflow distingue la somme de la conservation d'une seule remise,
  mais des montants différents distingueraient aussi la duplication d'une ligne.
- **Immutabilité : avantage extension.** Son test modifie la collection d'origine
  puis exige une facture inchangée. Le workflow produit bien une copie défensive,
  mais aucun de ses 19 exemples ne protège ce contrat contre une future régression,
  alors que la matrice DESIGN le demande.
- **Maximum : les deux sont protégés.** Extension teste les taux inversés dans
  les deux ordres après revue DELIVER. Workflow teste deux ordres de l'exemple
  original et une variante au meilleur taux sur seuil inférieur dès DISTILL.
- **Entrées nulles : extension plus explicite.** Elle refuse panier/grille nuls,
  collection nulle et palier nul par ArgumentNullException. Workflow n'a pas ces
  gardes ; PalierDeRemise peut conserver un TauxDeRemise nul fourni par un appelant
  hors contrat nullable, puis échouer lors du calcul. Aucun des tests workflow ne
  couvre ces entrées. Ce n'est pas un échec des cinq critères US-2, mais une limite
  de sa promesse « toute voie de construction préserve les invariants ».

Le workflow fournit un dossier DISTILL plus complet et synchronisé avec son
contrat, notamment `validite-paliers.feature`. Extension reporte les invalides
à la boucle interne et ne les réalise qu'après revue finale. Dans les deux,
certains documents de modélisation conservent des formulations d'étape intermédiaire
alors que les contrats sont clos. Les approbations workflow « aucun défaut »
ne signalent pas le manque de test d'immuabilité ; les approbations extension
ne signalent pas le manque de test de somme de remises positives.

Conclusion : le workflow a une meilleure couverture extérieure des règles métier
dans ce run ; l'extension a davantage de protection défensive et un test d'immuabilité.
Les deux restent différents sur l'autorisation de zéro, issue des réponses automatiques.
Pas de vainqueur global démontré, ni de garantie exhaustive donnée par APPROVED.
