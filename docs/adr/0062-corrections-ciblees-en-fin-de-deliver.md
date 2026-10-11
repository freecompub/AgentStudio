# ADR 0062 — Corrections ciblées en fin de DELIVER

## Statut

Accepté le 2026-10-11 par l'utilisateur (défaut D5 de `docs/12-audit-portes-lentilles-skraft.md`).
Étend l'ADR 0049, qui le faisait pour la seule mutation.

## Contexte

Quand une porte de fin de DELIVER échoue, l'extension et le workflow rejouaient toute la phase.
Or à ce moment tous les scénarios sont verts : chacun passe aussitôt sa porte de fin (diff vide),
aucun agent ne travaille, et la même porte échoue de nouveau sur le même code. Chaque tour consomme
un essai, jusqu'à l'escalade. Le motif — « ligne 14 de `Panier.cs` non couverte » — n'atteint
personne.

L'ADR 0060 a rendu le cas fréquent : la couverture du diff porte sur tout ce que la tâche a modifié,
y compris les squelettes écrits en DISTILL, que seule la porte de fin de phase voit.

## Décision

Une porte de fin de DELIVER qui désigne son correcteur ne fait plus rejouer la phase. Chaque motif
devient un défaut de revue (ADR 0046), corrigé depuis le dernier vert par l'agent concerné :

| Porte | Correcteur | Consigne |
| --- | --- | --- |
| mutation | testeur | tuer le mutant ; code superflu → `outOfScope`, au développeur |
| couverture du diff | testeur | exercer les lignes par un comportement observable ; code superflu → `outOfScope` |
| suite finale | développeur | faire repasser le test existant sans le modifier |

Une revue de DELIVER « changements demandés » sans défaut bloquant ni majeur suit la même règle :
ses défauts **mineurs** deviennent des fils (`minorThreads`) et sont corrigés comme des majeurs,
par l'agent de leur cible. La première revue de la phase y a droit même budget épuisé (ADR 0042).

Un échec **sans correcteur** — revue « changements demandés » sans aucun défaut, phase qui n'a
produit aucun fichier — escalade **sans consommer d'essai** : personne ne peut y répondre, l'humain
décide. L'escalade rembobine la phase, comme toutes les autres (ADR 0040, 0050).

La correction consomme un essai, comme toute correction de revue ; budget épuisé, escalade.
Les deux implémentations le font : `CORRECTIONS_DE_FIN` dans `extensions/skraft/src/reducer.ts`
et dans `workflows/skraft/livraison.mjs`.

## Conséquences

- Une porte de fin en échec fait travailler un agent avec un motif précis au lieu de rejouer la
  phase à vide.
- Plus aucun échec de fin de DELIVER ne rejoue la phase à vide : il y a un correcteur, ou
  l'humain. Reste le délai dépassé pendant la revue, qui rejoue la phase pour relancer la revue.
- Un défaut mineur coûte désormais un essai en DELIVER, là où il en coûtait un sans effet.
