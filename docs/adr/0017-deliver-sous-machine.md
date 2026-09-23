# ADR 0017 — DELIVER : sous-machine par scénario, granularités, porte de fin de scénario

- Statut : accepté
- Date : 2026-09-23
- Jalon : S5 (SPEC-skraft §7.4, §8.3 ; SPEC.md D21, D22, §8.3)

## Contexte

DELIVER doit livrer chaque scénario de `impl-plan.md` en TDD, sous le contrôle du code : tests
gelés, preuves produites par `run_tests`, seuils de qualité vérifiés à la fin de chaque scénario.

## Décision

1. **Plan par le code** : à l'entrée de DELIVER, une exécution de référence (preuve
   `DELIVER_BASELINE`) donne les tests d'acceptance ; un scénario par test marqué `ac-<n>`, dans
   l'ordre de la première mention dans `impl-plan.md`. Les tests requalifiés en non-régression
   sont déjà faits. Seuls les tests d'acceptance peuvent être rouges à ce moment.
2. **Deux granularités** (D22) :
   - `turn-per-scenario` (défaut) : un tour `skraft-test` (un test unitaire rouge), puis un tour
     `skraft-dev` (vert et nettoyage), en boucle jusqu'au vert du test d'acceptance.
   - `session-per-step` (difficulté `challenging`, réglage `granularity`, ou bascule automatique
     après un échec de scénario) : rouge, vert et nettoyage en sessions séparées. Un nettoyage refusé
     revient au vert sans escalade.
3. **Portes de pas** (code) : mêmes contrôles que l'extension `tdd`, plus l'empreinte des tests
   d'acceptance. Le rouge enregistre l'empreinte des tests unitaires ; le vert et le nettoyage la
   comparent : une modification de test, même hors outils, annule le tour par rollback au dernier
   point sûr, et le motif est transmis à l'agent.
4. **Garde du cœur** : `agents.run` accepte des motifs `readOnly`. `skraft-test` ne peut pas écrire
   les tests d'acceptance ; `skraft-dev` ne peut écrire aucun test.
5. **Porte de fin de scénario** : acceptance du scénario verte ; suite verte, sauf les tests
   d'acceptance des scénarios suivants, et aucun test ignoré ; au moins un rouge (bonne raison) puis
   un vert dans les preuves pour chaque test unitaire ajouté ; mutation des fichiers de production
   du scénario (100 % pour les couches `Domain`/`Application`, 90 % ailleurs) ; règle de dépendance ;
   longueur des méthodes, niveaux d'indentation et attributs par type.
6. **Barre de qualité configurable** : `.skraft/quality.json` du projet, avec des valeurs par défaut
   (20 lignes, 2 niveaux, 3 attributs). C'est un choix **provisoire**, en attendant `ctx.settings`
   (absent de l'API 0.1).
7. **Stack sans mutation ni analyse d'imports** : pas de rejet. Le contrôle est noté
   « non mesuré » et transmis aux lentilles. Si l'outil existe mais échoue, c'est une panne
   d'environnement (escalade).
8. **Budget** : `maxAttemptsPerPhase` par pas ; un scénario en échec est repris depuis son
   checkpoint ; en sessions séparées, l'escalade intervient au budget. `retry` reprend le scénario
   courant, sans perdre les scénarios livrés.
9. **Identifiants Swift** : `<fichier> > <Cible.Classe>/<test>`, le fichier étant retrouvé depuis
   la classe de test, pour relier le rouge de compilation (fichier seul) au vert du test.

## Conséquences

- `skraft-acceptance` peut écrire dans `@stack:sources` : les signatures minimales nécessaires à la
  compilation des tests d'acceptance (§7.3).
- OUVERT S-O2 (revue par scénario pour `challenging`) : non tranché. La revue a lieu après le
  dernier scénario, comme pour les autres niveaux.
- « Tests qui ne tuent aucun mutant » : non listés, car le rapport de Muter ne relie pas mutants
  et tests.
- Muter n'existe pas sous Linux : la mutation Swift n'est vérifiée qu'au travers de son rapport
  (doublure dans les tests). Le format réel reste à vérifier (§15).
