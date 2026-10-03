# ADR 0045 — Un comportement couvert par l'acceptance n'exige pas de test unitaire

- Statut : **décidé**, 2026-10-03 (option A, choisie par le responsable du projet)
- Contexte amont : SPEC-skraft §7.4 (sous-machine DELIVER), D16 (le LLM ne choisit pas la
  transition), D20 (les preuves sont produites par notre code), ADR 0024 (contenu partagé, contrat
  du cœur), ADR 0041 (une porte reconnaît ses tests à sa propre marque)

## Contexte

Le 03/10, sur la story US-2 du projet d'essai .NET, deux agents ont appliqué des doctrines opposées
sans que la machine puisse arbitrer.

US-2 se réduit à une méthode, `GrilleDePaliers.PalierApplicable`, et à quatre comportements —
seuil atteint, aucun seuil atteint, grille vide, meilleur palier parmi plusieurs — chacun vérifié
par un test d'acceptance gelé depuis DISTILL (ac-2, ac-1, ac-5, ac-3).

1. **Le testeur** (`skraft-test`) suit la skill reprise `test-design-mandates`, dont le mandat 4
   interdit le test unitaire qui duplique l'acceptance ; le plan de test de DISTILL avait noté
   `PalierApplicable` « saturated by AC ». Il a refusé d'écrire le test. La sous-machine DELIVER
   n'offrait aucune autre sortie au pas « test » : rejet, « Aucun fichier modifié ». Au réessai il
   a cédé.
2. **La revue** (lentille `cold-reader`) a ensuite exigé, en défaut majeur, les tests unitaires des
   trois autres branches — ceux que le testeur jugeait redondants.
3. **La correction** ne pouvait pas les écrire : en mode `fix`, les tests unitaires sont gelés par
   empreinte. Deux rejets de revue, sans issue possible, environ 50 requêtes premium chacun.

Aucun agent n'avait tort : chacun appliquait sa consigne. Le défaut était dans la machine, qui ne
disait pas ce qu'est un test suffisant et laissait deux agents en décider avec des règles opposées.

## Décision

1. **Un comportement vérifié par le test d'acceptance du scénario n'exige pas de test unitaire.**
2. **Le testeur peut le déclarer.** `report_phase` gagne un champ facultatif `coveredBy` : il y
   désigne le test existant qui vérifie déjà le comportement, au lieu d'en écrire un.
3. **Le code décide** (`coveredByAcceptance`, `deliver-effects.ts`). La déclaration n'est retenue
   que si : aucun fichier n'a été modifié ; le test désigné est **le test d'acceptance du scénario
   en cours** (pas un autre) ; il **échoue pour une bonne raison** (assertion ou symbole manquant) ;
   et aucun test qui passait ne s'est mis à échouer. Sinon, rejet avec son motif.
4. **Le test d'acceptance devient la cible du pas de code** (`newTest`), dont la porte GREEN exige
   qu'il passe. Il n'entre pas dans la liste des tests unitaires du scénario : la séquence rouge
   puis vert de la porte de fin de scénario ne porte que sur les tests unitaires réellement écrits.
5. **La revue est cadrée** (consigne commune des lentilles, `roles.ts`) : avant de signaler un test
   manquant, chercher le comportement dans les tests d'acceptance ; s'il y est, ce n'est pas un
   défaut.

## Conséquences

- Le conflit de US-2 disparaît des deux côtés : le testeur a une sortie vérifiée, la revue ne
  réclame plus ce que le projet a décidé de ne pas écrire.
- **Moins de tests unitaires**, donc un diagnostic moins fin quand un test d'acceptance casse : il
  dit qu'une règle est violée, pas laquelle des branches. C'est le prix accepté. La mutation et la
  couverture, mesurées à la fin de chaque scénario, restent le filet : une branche que l'acceptance
  ne vérifie pas vraiment laisse survivre des mutants.
- Rien de spécifique à un langage n'entre dans skraft (D10) : le test est désigné par son
  identifiant, comparé par `concerns`, qui sait déjà relier chemins et classes (ADR 0041).
- `coveredBy` est un champ du cœur, facultatif et générique (« un test existant vérifie déjà le
  comportement ») ; seul DELIVER s'en sert aujourd'hui.

## Reste ouvert

- **Une correction de revue ne peut toujours pas ajouter de test.** Cet ADR retire le cas qui l'a
  révélé, pas le mécanisme : un défaut légitime « test manquant » sur un comportement que
  l'acceptance ne couvre pas resterait impossible à corriger en mode `fix`. Piste : faire repartir
  la correction par un pas « test » (rouge vérifié) avant le pas de code, au lieu de geler les
  tests. À décider séparément.
- Non éprouvé sur un run réel au moment de l'écriture.
