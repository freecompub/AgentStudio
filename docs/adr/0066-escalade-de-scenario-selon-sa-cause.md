# ADR 0066 — L'escalade d'un scénario propose des options selon sa cause

## Statut

**Proposé** le 2026-10-13, à valider par le responsable du projet. Concerne l'extension `skraft` et
le workflow `workflows/skraft/`, avec le même comportement.

## Contexte

Un scénario de DELIVER qui échoue est repris, puis escaladé à l'humain une fois son budget épuisé.
L'escalade propose toujours « relancer », « sauter », « abandonner », quelle que soit la cause.
Deux causes ne peuvent pas être résolues par ces options.

1. **Un test existant devenu rouge.** La story change un comportement que décrit un test plus
   ancien : ce test est obsolète. Les portes des pas exigent une suite verte, donc le pas vert est
   refusé à chaque essai. Personne ne peut mettre ce test à jour : le développeur ne touche pas aux
   tests, le testeur ne fait que des ajouts (D10), et l'agent d'acceptance n'écrit pas les tests
   unitaires.
2. **Des lignes non couvertes** (code défensif inatteignable) écrites pendant le scénario. La
   porte du scénario les refuse, mais elle n'a pas de défaut à contester, donc l'arbitrage de
   l'ADR 0065 n'est pas atteint.

## Décision

1. **La cause est connue du code.** Au moment de l'escalade, le dernier refus dit :
   - quels tests rouges **existaient et passaient avant DELIVER** (référence prise au début de la
     phase), donc la cause 1 ;
   - quelles lignes du scénario restent non couvertes, donc la cause 2.

   La question posée à l'humain présente le problème en clair, avec les tests ou les lignes.
2. **Test existant devenu rouge.** Les options sont :
   - **« Rejouer DISTILL »** : DELIVER est rembobinée et ses sessions oubliées (ADR 0050). DISTILL
     est rejouée avec le problème en motif, puis DELIVER est refaite entièrement ;
   - **« Mettre en pause »** : la tâche attend que l'humain corrige lui-même. À la reprise, on lui
     demande d'où repartir : « ce scénario », « toute la phase DELIVER » ou « DISTILL » ;
   - « relancer », « sauter » et « abandonner » restent proposés.
3. **Lignes non couvertes.** En plus de « relancer », « sauter » et « abandonner », une option
   **« exempter ces lignes »** accorde la même dérogation qu'en fin de DELIVER (ADR 0065) : lignes
   hors du calcul, décision tracée et commitée. Le scénario est ensuite relancé.
4. Chaque choix est tracé (entrée `arbitrage` ou rejet), comme les autres décisions humaines.

## Point à trancher avant de coder

**Qui met à jour un test unitaire obsolète quand on « rejoue DISTILL » ?** L'agent d'acceptance
n'écrit que les tests d'acceptance, les sources et `.skraft/`. Trois possibilités :

- **A.** Rejouer DISTILL ne sert qu'aux tests **d'acceptance** obsolètes. Pour un test
  **unitaire**, seule « mettre en pause » est proposée : l'humain le met à jour lui-même.
- **B.** Le temps de ce rejeu, l'agent d'acceptance reçoit le droit d'écrire **le seul fichier**
  du test obsolète cité, avec sa justification dans `test-plan.md`.
- **C.** Pas de rejeu de DISTILL pour un test unitaire. Après confirmation de l'humain que le test
  est obsolète, le testeur de DELIVER le met à jour (le même droit, limité à ce fichier).

## Conséquences

- Une escalade de scénario ne se termine plus, pour ces deux causes, sur des options qui ne
  peuvent pas réussir.
- « Mettre en pause » introduit une reprise avec choix du point de départ : un nouveau type de
  question dans les deux implémentations.
- Le workflow doit pouvoir revenir de DELIVER à DISTILL : `workflow.mjs` enchaîne aujourd'hui les
  phases sans retour en arrière.
