# ADR 0031 — Borner l'occupation de la fenêtre, pas le cumul des tokens envoyés

- Statut : **décidé**, 2026-09-29
- Amende : **ADR 0027** (plafond de coût d'un tour), dont le seuil par défaut est retiré
- Contexte amont : ADR 0026 (plafond de durée), D37 (usage par état)

## Contexte

L'ADR 0027 coupait un tour au-delà d'**1 M de tokens d'entrée cumulés**, en présentant ce cumul
comme « ce qui a été payé ». Deux runs réels sur US-2 du projet d'essai .NET ont montré que la
décision était fausse sur les deux plans.

**Le seuil.** Sur le second run, DESIGN a épuisé ses trois essais **uniquement** par ce plafond —
1023 k, 1048 k, 1049 k — sans qu'aucune lentille n'ait jamais siégé. Un tour normal
d'`architect-model` sur un projet réel *fait* un million. Le filet était devenu la porte.

**La grandeur.** Le cumul des `inputTokens` ne mesure pas une dépense :

- il compte ce qui a **transité**, cache de prompt compris ; le SDK ne rend les compteurs de cache
  (`ShutdownModelMetricUsage`) qu'au **résumé de fin de session**, jamais par appel, de sorte
  qu'on ne peut pas savoir quelle part du contexte réenvoyé a été servie depuis le cache ;
- il **ne décroît jamais**, même quand le runtime compacte la conversation et vide la fenêtre ;
- Copilot facture en requêtes premium (`cost`), pas en tokens.

Le SDK expose pourtant la mesure qu'il fallait, et que nous n'écoutions pas :
`session.usage_info` donne `currentTokens` (ce qui **occupe** la fenêtre maintenant) et
`tokenLimit` (ce que le modèle peut contenir), plus la ventilation `systemTokens` /
`conversationTokens` / `toolDefinitionsTokens`.

## Décision

1. **Le plafond opératoire est une fraction de la fenêtre de contexte**, défaut **0,9**, et lève
   `TurnContextError`. Il ne repose sur aucun nombre absolu deviné : `tokenLimit` vient du runtime,
   pour le modèle réellement employé, et le seuil suit donc le modèle.
2. **C'est la dernière mesure qui compte, jamais la plus haute atteinte.** Quand le runtime
   compacte, la fenêtre se vide et plus rien ne justifie de couper. Un test le défend : sans lui,
   on réinventerait un compteur qui ne redescend pas — c'est-à-dire le défaut qu'on corrige.
3. **Une limite absente ou nulle ne fait rien couper.** On ne divise pas par une mesure manquante,
   et un `session.usage_info` sans ses deux nombres redevient un simple signe de vie plutôt qu'un
   événement `context` aux champs vides, que chaque lecteur devrait ensuite apprendre à ignorer.
4. **`maxInputTokens` est désactivé par défaut**, pas supprimé : il reste disponible pour qui veut
   borner explicitement la dépense d'un tour.
5. **`totalNanoAiu` est remonté** (`nanoAiu`) : c'est la seule grandeur de **coût réel par appel**
   que le runtime rende. Elle remplace le cumul des tokens d'entrée dans le rôle que je lui avais
   prêté à tort.

## Conséquences

- La porte ne se déclenche plus que quand l'agent est réellement près de ne plus pouvoir
  travailler, et non quand il a beaucoup lu.
- Le pourcentage d'occupation existe désormais dans le cœur pour chaque session. Il **n'est pas
  affiché** : `chat:agent` ne le transporte pas, comme `usage` et `activity`. Le montrer à l'écran
  est un chantier d'interface à part, et c'est le premier à faire — un plafond invisible se
  redécouvre à chaque fois par l'enquête.
- `systemTokens` permettra enfin de chiffrer ce que coûtent nos skills injectées (24 675 caractères
  de prompt système pour `architect-model`), et `conversationTokens` ce que l'agent lit vraiment.
  Rien n'en est encore fait.
- **Non vérifié** : la part du contexte réenvoyé servie par le cache de prompt. L'hypothèse que le
  cache absorbe l'essentiel de la croissance ne peut être ni confirmée ni écartée avec les
  événements par appel ; il faudrait lire le résumé de fin de session.
- L'ADR 0027 garde sa raison d'être — un tour peut être bref et ruineux — mais son seuil par défaut
  était réglé sur une intuition, et l'intuition était fausse d'un facteur sept.
