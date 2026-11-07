# ADR 0063 — Question ou silence d'une lentille : le producteur ne paie plus

## Statut

Accepté le 2026-10-11 par l'utilisateur (décision du 2026-10-10, défaut D4 de
`docs/12-audit-portes-lentilles-skraft.md`).

## Contexte

Une lentille qui dépassait son délai ou finissait sans verdict faisait lever un « tour
interrompu » : un essai de la phase était consommé, le producteur refaisait toute la phase et
recevait « reprends ton tour interrompu », alors que son tour s'était terminé normalement.

L'audit supposait aussi qu'une lentille pouvait poser une question. Ce n'était pas le cas : les
lentilles n'avaient pas l'outil `report_blocker` (extension : pas de `tools` dans `manifest.ts` ;
workflow : pas d'`outils` dans `workflow.mjs`). La branche « Blocage inattendu » ne servait jamais.

## Décision

1. Les quatre lentilles reçoivent `report_blocker`, dans les deux implémentations. Leur consigne
   leur demande de poser la question d'une décision métier que ni la story ni les réponses ne
   tranchent, au lieu de deviner.
2. Une question nouvelle part à l'humain (« Question de la revue (<phase>, <lentille>) »). La
   réponse rejoint celles de la story et les faits donnés aux lentilles. La phase est rejouée
   depuis le début avec le motif « Question de la revue (<lentille>) : … — Réponse de
   l'utilisateur : … », **sans consommer d'essai**. En DELIVER, où tout est déjà vert, seule la
   revue est relancée (ADR 0062).
3. Une question déjà tranchée est renvoyée à la lentille avec sa réponse ; reposée, « revue
   impossible ».
4. Au-delà de **2 questions de revue par phase**, escalade : le budget ne borne plus ces rejeux.
5. Une lentille muette ou en délai dépassé est relancée **seule**, une fois ; au second échec,
   escalade « revue impossible : <lentille>, <raison> », sans essai consommé.
6. Le rejeu est tracé sous la porte `question de revue`, avec la question et la réponse.

Mise en œuvre : extension — événement `LENS_BLOCKED`, `afterReviewQuestion` et
`reviewQuestions` (réducteur), `runLens` (effets) ; workflow — `reviser`, `lentille`,
`questionDeRevue` (`revue.mjs`) et le rejet `nonCompte` d'`essayer` (`packages/workflow`).

## Conséquences

- Une revue ne fait plus refaire au producteur un travail qu'elle n'a pas pu juger.
- Une lentille peut maintenant interrompre la tâche pour poser une question : jusqu'à deux par
  phase, puis escalade.
- Le moteur d'agents relance déjà une fois un agent qui finit sans sortie : une lentille « muette »
  l'a été deux tours de suite avant d'être relancée seule.
