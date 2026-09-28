# ADR 0026 — Un plafond de durée par tour, au-dessus du chronomètre d'inactivité

- Statut : **décidé**, 2026-09-28
- Contexte amont : D30 (« pas de délai fixe sur le travail des agents : surveillance d'inactivité »),
  D24/D25 (défaut de travail = réessai, défaut d'environnement = escalade), SPEC §6.4

## Contexte

D30 est tranché : un tour d'agent n'a pas de délai fixe, seulement un chronomètre d'**inactivité**
réarmé par chaque événement de session et par chaque battement d'outil long. Sa raison est bonne —
« un agent qui travaille ne doit pas être coupé ».

Le 2026-09-28, la tâche `skraft-pipeline` lancée sur US-2 du projet d'essai .NET a produit ceci :

```
10:13:59  session ouverte   skraft-architect-model
                            ← 1 h 55 min 41 s sans aucune transition
12:09:40  effet en échec    TIMEOUT
```

Le chronomètre d'inactivité n'a rien vu : l'agent émettait sans cesse, donc il était réarmé à
chaque fois. Il ne s'est déclenché qu'une fois l'agent réellement muet, au bout de près de deux
heures. La phase DESIGN a consommé **4 230 824 tokens d'entrée pour 8 requêtes** — 529 k par
requête — et son résultat a été rejoué depuis le checkpoint à l'annulation. Rien ne bornait la
durée totale d'un tour.

D30 dit qu'un agent qui travaille ne doit pas être coupé. Cette tâche montre qu'un agent peut
« travailler » deux heures pour un résultat jeté : **l'activité n'est pas la progression.**

## Décision

1. **Un plafond de durée totale par tour**, en plus du chronomètre d'inactivité. Défaut **30
   minutes**, réglable (`maxMs` dans `RunTurnOptions`, `agentMaxTurnMs` dans la configuration).
2. **Rien ne le réarme** — ni un événement de session, ni un battement d'outil. C'est un plafond,
   pas un chronomètre. Un test le vérifie explicitement, sans quoi il redeviendrait un second
   chronomètre d'inactivité et ne servirait à rien.
3. **Il ne raccourcit jamais le chronomètre d'inactivité** : un silence de 5 minutes reste un
   silence, même si le plafond est loin.
4. **Une erreur distincte, `TurnBudgetError`**, et non `TurnTimeoutError`. Les deux sont des
   `WorkDefectError` — donc réessai et non escalade (D24) — mais le motif lu par l'humain dit
   lequel s'est produit : « il ne répond plus » et « il n'en finissait pas » n'appellent pas la
   même correction. Le nom traverse la frontière de processus, comme les autres (`rpc/endpoint.ts`).
5. **Le défaut est large exprès.** 30 minutes laisse passer un tour légitime, suite de tests
   comprise ; notre propre suite tient en 2 minutes. Ce n'est pas un ordonnanceur, c'est un filet.

## Conséquences

- D30 est **amendé, pas renversé** : il n'y a toujours pas de délai fixe *sur la réponse* de
  l'agent, et le chronomètre d'inactivité reste le mécanisme principal. Le plafond borne le pire
  cas. SPEC §6.4 est mis à jour en conséquence.
- Un tour coupé par le plafond est un `WorkDefectError` : le réducteur le traite en `TIMEOUT`, donc
  en réessai si le budget de la phase le permet. Une session neuve repart d'un contexte vide, ce
  qui traite aussi, accessoirement, l'enflure de contexte observée — mais ne la corrige pas :
  c'est un chantier distinct, encore ouvert.
- Ce plafond ne dit rien du **coût**. Un tour peut rester sous 30 minutes et consommer un demi-
  million de tokens. Borner le contexte d'une session reste à faire.
