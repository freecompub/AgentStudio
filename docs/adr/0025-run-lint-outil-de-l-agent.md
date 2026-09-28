# ADR 0025 — `run_lint` : l'agent consulte le linter pendant son travail, pas après le refus

- Statut : **décidé**, 2026-09-28
- Contexte amont : ADR 0022 (la qualité de forme est jugée par le linter du projet),
  ADR 0024 (agents et skills en Markdown, contrat ajouté par le cœur), D20 (les preuves sont
  produites par le code)

## Contexte

`StackAdapter.lint()` existe depuis l'ADR 0022 et la porte `deliver` s'en sert
(`extensions/skraft/src/deliver-effects.ts`). Mais elle ne l'appelle qu'**au moment de juger**.

Les agents, eux, n'avaient que `run_tests` et `report_blocker`. Le point C4 de la skill
`craft-discipline` leur demande pourtant de vérifier que « le linter ne signale aucune nouvelle
violation » — sans leur donner aucun moyen de le savoir, et sans même citer de commande. L'agent
découvrait donc l'avis du linter quand la porte le recalait, et repartait pour un tour complet :
une phase entière consommée pour une violation de forme que l'outil aurait signalée en quelques
secondes.

Deux autres options ont été écartées :

- **Laisser l'agent lancer le linter lui-même.** Les skills sont reprises telles quelles d'un
  cadre .NET (ADR 0024 §6) et le contrat lui interdit désormais d'exécuter toute commande de
  compilation ou de test. Rouvrir cette porte pour le linter réintroduirait exactement ce qu'on
  vient de fermer : une commande devinée, fausse hors .NET.
- **Ajouter aussi un `run_build`.** `runTests` compile déjà dans les trois piles, et `buildErrors`
  du profil sait nommer les erreurs de compilation. Un second outil d'attestation, indépendant
  des tests, permettrait à l'agent de conclure « ça compile » sans qu'aucun test n'ait tourné.

## Décision

1. **Un outil `run_lint`**, fourni par le cœur (`packages/extension-host/src/lint-tool.ts`), dont
   le handler est notre code. Il appelle `StackAdapter.lint()` — **la même mesure et la même
   source de vérité que la porte**, seulement disponible plus tôt.
2. **Il exige `shell:test`**, comme `run_tests` : le linter est un programme du projet. Le
   manifeste le vérifie, et l'hôte refuse d'activer une extension qui s'en passerait.
3. **Il n'enregistre aucune preuve.** La porte `deliver` relance le linter elle-même. Si cette
   exécution-ci valait preuve, l'agent choisirait le moment de la mesure — et pourrait linter
   avant d'écrire le code fautif.
4. **Le résumé distingue trois états**, dont deux ne valent surtout pas « conforme » :
   - pas de linter configuré (`available: false`) ;
   - linter qui a tourné mais **n'a examiné aucun fichier** (exclusion, filtre de sévérité) ;
   - fichiers examinés, et alors seulement « aucune violation ».

   C'est la règle qui gouverne tout le projet : *une porte ne doit jamais attester ce qu'elle n'a
   pas mesuré*. Le défaut a été réintroduit trois fois en S6 par trois chemins différents ; le
   rendre visible dans le texte lu par l'agent est le seul moyen de ne pas le repayer.
5. **Le contrat l'annonce avec sa réserve** : « s'il répond qu'il n'a rien mesuré, ne te prévaux
   d'aucune conformité. »
6. **Il est donné aux agents qui écrivent du code** : `skraft-test` et `skraft-dev`. Les lentilles
   de revue ne l'ont pas — elles n'exécutent rien et lisent les faits établis par la porte.

## Conséquences

- C4 de `craft-discipline` devient vérifiable par l'agent, sans modifier la skill reprise.
- Une stack sans `lint()` (aujourd'hui aucune, demain peut-être) répond « rien mesuré » plutôt que
  de lever : l'agent n'est pas bloqué, et il ne peut pas en conclure la conformité.
- `STANDARD_TOOLS` remplace l'énumération en dur des outils du cœur dans la validation du
  manifeste ; le prochain outil standard n'aura qu'une ligne à changer.
- **Pas de `run_build`**, pour la raison donnée plus haut. Si le besoin réapparaît, ce sera une
  décision à part : il faudra dire ce que l'agent a le droit d'en conclure.
