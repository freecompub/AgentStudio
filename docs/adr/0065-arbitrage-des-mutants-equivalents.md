# ADR 0065 — Arbitrage des mutants équivalents, tracé

## Statut

Accepté le 2026-10-11 par l'utilisateur (défaut D22 de `docs/12-audit-portes-lentilles-skraft.md`).
Même comportement dans l'extension `skraft` et dans le workflow `workflows/skraft/`.

## Contexte

La porte de mutation de fin de DELIVER exige 100 % sur le domaine. Un **mutant équivalent** (par
exemple `dose > max` muté en `dose >= max` dans `dose > max ? max : dose`) ne peut être tué par
aucun test : aucune entrée ne distingue les deux versions. Depuis D5, chaque échec de la porte
devient un défaut adressé au testeur. Le testeur pouvait contester, mais aucune lentille ne porte
le nom `mutation`, donc personne n'arbitrait. La porte, relancée, échouait de nouveau ; le budget
s'épuisait, puis l'escalade arrivait sans montrer la contestation à l'humain.

L'équivalence de deux programmes n'est pas décidable par un algorithme en général : le code ne
peut pas trancher seul.

## Décision

1. **Un défaut par mutant survivant**, qui garde le mutant exact (fichier, ligne, opérateur, code
   du mutant). Le rapport de mutation donne, par fichier, les mutants tués et jugés, et le code de
   chaque survivant (lecteur Stryker).
2. **Le testeur** tue le mutant, ou le conteste comme équivalent en le démontrant.
3. **Un agent dédié, `skraft-mutation-arbiter`**, distinct du testeur, juge les mutants contestés
   juste après le tour du testeur. Il rend un arbitrage par mutant (`submit_lens_verdict`,
   `rulings` : `accepted` = équivalent, `maintained` = non équivalent).
4. **Équivalent** : une **dérogation** est accordée par l'agent. La porte retire ce seul mutant du
   score (recalcul sur les mutants tués et jugés). **Plafond** : deux dérogations accordées par
   l'arbitre par livraison ; au-delà, l'humain tranche.
5. **Non équivalent, ou plafond atteint** : l'humain tranche (« Arbitrer un mutant »), avec la
   contestation du testeur et l'avis de l'arbitre sous les yeux. « Dérogation » : accordée par
   l'humain. « À corriger » : le testeur doit tuer le mutant, sans recours.
6. **Tout est tracé** :
   - chaque décision (agent ou humain, dérogation ou à corriger) dans la trace de la tâche, entrée
     `arbitrage` (`porte`, `élément`, `contestation`, `décision`, `par`, `raison`). Le moteur la
     lit dans le champ `arbitrages` de l'état, en ajout seul ; le workflow l'écrit par
     `w.arbitrage(…)`, journalisé sans effet ;
   - les dérogations dans `.skraft/<slug>/deliver/derogations.md`, commité avec DELIVER ;
   - dans les faits donnés aux lentilles de la revue de DELIVER, et dans le rapport final.

Un rembobinage de DELIVER efface le code, donc les dérogations en cours ; la trace les garde. Une
correction reprise après un échec garde ses dérogations : le code revient au point où les mutants
ont été mesurés.

## Conséquences

- **Exception assumée au principe « le LLM propose, le code décide »** : un agent peut exempter un
  mutant d'une porte. Elle est bornée : arbitre indépendant du testeur, un mutant précis vérifié par
  le code, plafond, humain au-delà, et traçabilité complète.
- Le cœur gagne une entrée de trace `arbitrage` ; le rapport de mutation gagne `killed`, `total` et
  `replacement` (facultatifs) ; la bibliothèque des workflows gagne `w.arbitrage`.
- Extension : les défauts créés par une porte de fin de DELIVER sont désormais tenus dans
  `reviewThreads`. Avant, ils ne servaient qu'à la consigne, et les réponses du testeur ou du
  développeur à ces défauts étaient ignorées (le workflow les tenait déjà).
- Hors périmètre : la couverture du diff et la suite finale n'ont pas de dérogation. Leur
  contestation n'a toujours pas d'arbitre ; elle finit en escalade sur le motif de la porte.
- La mutation par scénario (`moment: scenario`) n'ouvre pas d'arbitrage : un échec y reprend le
  scénario. Les dérogations déjà accordées y sont appliquées.
