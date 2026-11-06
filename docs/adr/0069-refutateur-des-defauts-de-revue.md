# ADR 0069 — Réfutateur des défauts de revue

## Statut

**Accepté** le 2026-11-06 par le responsable du projet (« on l'intègre chez nous »), branche
`feat/mcp-skraft`. Étude : `docs/16-skraft-plugin-v2.md` §5.3 et §8 ; plan : `progress.md`, 06/11.

## Contexte

Un défaut de revue va aujourd'hui droit au producteur, qui le corrige ou le conteste ; la lentille
arbitre la contestation, puis l'humain si le désaccord persiste (ADR 0046). Un faux positif coûte
donc au moins un tour du producteur, et souvent un arbitrage. Les revues pèsent lourd : sur le run
MCP d'US-2 (`docs/runs/2026-11-05-us-2-mcp/`), 11 des 20 tours d'agent étaient des lentilles.

skraft-plugin v2 (`integration/v2-next`) soumet chaque finding à un agent `finding-refuter` avant le
verdict. La v2 n'est pas couverte par l'autorisation de reprise (versions < v2.0.0) : l'idée est
réimplémentée ici, sans reprendre son prompt ni son code.

## Décision

1. **Un agent `skraft-finding-refuter`**, en lecture seule, sans outil, juge les défauts **nouveaux**
   d'une revue avant la synthèse, dans le workflow (`revue.mjs`, `juger`) et dans l'extension (effet
   `runReview`). Le réducteur de l'extension ne change pas : il reçoit des verdicts déjà filtrés.
2. **Seuls les défauts `blocker` et `major` sont soumis** : un `minor` n'empêche pas l'approbation
   (§9, `docs/15` §3) ; le réfuter coûterait un appel pour ne rien changer au verdict. Une lentille
   qui rend `REJECTED` n'est **pas** soumise : son rejet escalade à l'humain de toute façon, et son
   verdict n'est jamais modifié.
3. **Un appel par lentille** qui a de tels défauts, en parallèle, avec **les mêmes entrées que la
   lentille** (son dossier de revue, sans l'historique de ses fils) et la liste de ses défauts. Il
   juge chaque défaut séparément.
4. **Sortie** : `submit_lens_verdict`, lentille « finding-refuter », un arbitrage (`rulings`) par
   défaut — `accepted` : le défaut est réfuté et tombe ; `maintained` : il tient, ou les entrées ne
   permettent pas de trancher. Même forme que l'arbitre de mutants (ADR 0065) : aucun nouvel outil
   terminal.
5. **Le code décide de ce qui tombe.** Une réfutation n'est retenue que si sa raison cite un
   passage `chemin:ligne` d'un fichier **qui existe** dans le dépôt. Sinon, ou sans arbitrage pour un
   défaut, le défaut est **maintenu**. Dans le doute, le défaut reste : le réfutateur filtre les faux
   positifs démontrés, il ne réécrit pas la revue.
6. **Effet sur le verdict d'une lentille** : une lentille `CHANGES_REQUESTED` dont il ne reste aucun
   défaut `blocker` ni `major` après réfutation compte comme approbatrice — elle n'avait réclamé que
   ces défauts (même règle que `lensesAfterThreads` après un arbitrage).
7. **Traçabilité** : les défauts réfutés restent dans le rapport de revue (`.skraft/<slug>/reviews/`),
   avec la raison du réfutateur ; ils n'ouvrent aucun fil.
8. **Modèle** : classe `strong`. Juger un défaut demande au moins la capacité de la lentille qui l'a
   trouvé ; la classe se règle par projet (ADR 0048).

## Conséquences

- Un faux positif démontré coûte un appel du réfutateur au lieu d'un tour du producteur et d'un
  arbitrage. Un vrai défaut coûte un appel de plus. Le gain n'est pas acquis : il se mesure sur US-2
  (tours, requêtes premium lues dans la trace, défauts réfutés), par un run Copilot fait avec
  l'accord du responsable.
- Les contestations et arbitrages existants (ADR 0046, 0047) ne changent pas : ils portent sur les
  défauts que le réfutateur a maintenus.
- Écartés pour l'instant, à décider avec la mesure : réfuter les `minor` ; la règle du désaccord
  isolé (une seule lentille contre les autres, entrées de toute la revue) ; ne pas rejuger un défaut
  déjà réfuté au même endroit (re-revue incrémentale, `progress.md` 06/11).
- Le contenu de l'agent (`agents/skraft-finding-refuter.agent.md`) ne nomme aucun outil (ADR 0024) ;
  la consigne de sortie est dans la déclaration de l'agent.
