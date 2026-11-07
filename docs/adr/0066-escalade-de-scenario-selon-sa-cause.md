# ADR 0066 — L'escalade d'un scénario propose des options selon sa cause

## Statut

**Proposé** le 2026-10-13. **Accepté, révisé,** le 2026-11-07 par le responsable du projet, branche
`feat/escalade-scenario`. La révision remplace « rejouer DISTILL » et « mettre en pause » (voir
« Révision du 07/11 »). Concerne l'extension `skraft` et le workflow `workflows/skraft/`, donc aussi le
serveur MCP, avec le même comportement.

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

1. **La cause est connue du code.** Chaque refus porte les tests en échec qu'il a vus et, à la porte
   du scénario, les lignes non couvertes. Au moment de l'escalade :
   - un test en échec qui **passait au début de DELIVER** (référence prise à la planification) est
     un test que la story rend obsolète, ou qu'elle casse : cause 1 ;
   - des lignes du scénario sous le seuil de couverture : cause 2.

   La question posée à l'humain présente le problème en clair, avec les tests ou les lignes, et ce
   que chaque option fera.
2. **Test existant devenu rouge** : option **« Déclarer ces tests obsolètes et continuer »**. Comme
   les défauts hors du changement de la story (06/11) :
   - les tests nommés **sortent des portes** de DELIVER jusqu'à la fin du cycle (retirés des
     résultats que lisent les portes ; les preuves gardent l'exécution complète) ;
   - le scénario reprend, et le cycle peut se terminer ;
   - la décision est **tracée** (arbitrage « tests existants », décision « obsolète »), écrite dans
     `.skraft/<slug>/deliver/derogations.md` et commitée avec la livraison ;
   - le **bilan rappelle** « À corriger après le cycle : mettre à jour <test> ».

   Aucun agent ne modifie un test existant : c'est l'humain qui le met à jour, après le cycle.
3. **Lignes non couvertes** : option **« Exempter ces lignes et continuer »**. La même dérogation
   qu'en fin de DELIVER (ADR 0065) : lignes hors du calcul, à la porte du scénario comme à celle de
   fin de DELIVER ; décision tracée et commitée. Le scénario reprend.
4. « Relancer », « sauter » et « abandonner » restent proposés. Un rembobinage de toute la phase
   DELIVER efface ces décisions avec le code ; les arbitrages, eux, restent dans la trace.

## Révision du 07/11

La proposition du 13/10 offrait, pour un test obsolète, « rejouer DISTILL » (DELIVER effacée) et
« mettre en pause » (l'humain corrige, puis choisit d'où repartir). Deux difficultés :

- revenir au début de DELIVER, ou à DISTILL, se fait par un rollback Git, qui aurait **effacé la
  correction** faite par l'humain pendant la pause ;
- personne ne pouvait mettre à jour un test unitaire pendant le rejeu de DISTILL ; le point à
  trancher retenait l'option A (l'humain le fait).

Le responsable a retenu le principe des défauts hors du changement : le problème est signalé,
l'humain décide, le cycle se termine, et la correction se fait après. Le workflow n'a donc pas à
revenir de DELIVER à DISTILL.

## Conséquences

- Une escalade de scénario ne se termine plus, pour ces deux causes, sur des options qui ne
  peuvent pas réussir.
- Un test déclaré obsolète reste rouge dans le dépôt jusqu'à ce que l'humain le mette à jour ; le
  bilan et `derogations.md` le disent.
- La trace accepte une troisième décision d'arbitrage, « obsolète » (cœur, moteur de tâches,
  workflow).
