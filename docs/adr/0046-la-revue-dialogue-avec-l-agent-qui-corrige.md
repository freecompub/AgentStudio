# ADR 0046 — La revue dialogue avec l'agent qui corrige

- Statut : **décidé**, 2026-10-03 (proposé par le responsable du projet, précisé ensemble)
- Contexte amont : SPEC-skraft §9 (revue à lentilles, synthèse par le code), §7.4 (DELIVER),
  D16 (le LLM ne choisit pas la transition), ADR 0042 (la revue a droit à un essai), ADR 0045
  (un comportement couvert par l'acceptance n'exige pas de test unitaire)

## Contexte

Le 03/10, sur US-2, la revue de DELIVER a rejeté deux fois la livraison pour un défaut que personne
ne pouvait traiter :

- la lentille `cold-reader` réclamait des tests unitaires ;
- la correction était confiée au développeur, avec les tests **gelés** : il ne pouvait pas les écrire ;
- le testeur, qui aurait pu, n'était pas sollicité — et il jugeait ces tests redondants avec
  l'acceptance, sans pouvoir le dire.

Trois défauts de la machine, pas des agents :

1. **Pas de routage** : tout défaut de revue allait au développeur, qu'il porte sur le code ou sur
   un test.
2. **Pas de droit de réponse** : un agent qui estimait qu'un défaut n'en était pas un n'avait que le
   choix de céder ou d'être rejeté. Le même jour, en DESIGN, un agent avait eu raison deux fois
   contre une porte sans pouvoir le faire valoir.
3. **Pas de mémoire** : le retour après un rejet ne transmettait que les défauts du dernier tour
   (`lastRejection`) ; une phase pouvait épuiser son budget en satisfaisant chaque critique à son
   tour sans jamais les satisfaire ensemble (critère `retour-de-revue-cumulatif`, observé le 29/09).

## Décision

### 1. Une sortie de lentille normalisée, une cible par défaut

`submit_lens_verdict` (JSON validé par schéma) exige pour chaque défaut une **cible** :
`test`, `code` ou `deliverable`. Un défaut, un seul sujet : celui qui touche à la fois un test et le
code est scindé. La lentille propose, **le code vérifie** : quand un fichier est cité, sa nature
(selon la disposition de la stack) fait foi, et l'écart est noté (`targetNote`). Une erreur de
routage coûte un tour entier ; la vérifier ne coûte rien.

**L'identifiant de chaque défaut est attribué par le code** (`lentille#tour.n`), jamais par le
modèle : tout le mécanisme repose sur sa stabilité d'un tour à l'autre.

### 2. Un fil par défaut

Chaque défaut blocker ou major devient un **fil** (`review-thread.ts`, pur), conservé dans l'état
jusqu'au commit de la phase. Ses statuts : ouvert, corrigé, contesté, maintenu, contesté de nouveau,
accepté ; puis, en dernier recours, tranché par l'humain dans un sens ou dans l'autre.

### 3. Routage en DELIVER : les tests d'abord

La correction de revue se fait en deux temps :

1. **Côté tests** (`fix-test`), si des défauts visent les tests : le testeur ajoute les tests
   demandés ou les conteste. Sa porte (`verifyFixTests`) n'exige **pas** de rouge — un test réclamé
   sur du code existant passe souvent d'emblée — mais : des tests unitaires seulement, aucun test
   existant disparu ni cassé, et un rouge éventuel pour une bonne raison. Les rouges deviennent les
   **cibles du développeur**.
2. **Côté code** (`fix`) : le développeur traite ses défauts et fait passer ces cibles, tests gelés
   à leur nouvelle empreinte. La porte de fin de scénario vérifie la séquence rouge puis vert des
   cibles.

Chaque agent ne reçoit que les défauts qui le concernent. Hors DELIVER, la phase n'a qu'un
producteur : il reçoit tout.

### 4. Droit de réponse, une seule fois par défaut

L'agent répond à chaque défaut dans `report_phase.responses` : `fixed`, ou `contested` avec sa
raison (une contestation sans raison ne vaut rien). Au tour suivant, **chaque lentille revoit ses
propres défauts** et la réponse de l'agent, dans son dossier construit par le code — jamais une
transcription. Pour chaque contestation, elle rend un arbitrage (`rulings`) :

- **accepted** : le défaut tombe ;
- **maintained** (ou aucun arbitrage) : il doit être corrigé, et il compte dans la synthèse même si
  la lentille omet de le relister — une revue ne peut pas approuver ce qu'elle vient de maintenir.

### 5. L'humain en dernier recours

Un défaut maintenu, contesté de nouveau, puis maintenu encore est un **désaccord persistant** :
l'état passe en `ARBITRATION` et une demande d'interaction est faite à l'humain (donner raison à
l'agent : le défaut tombe ; à la lentille : à corriger, sans recours). Un défaut maintenu par
l'humain a droit à sa correction même si le budget de la phase est épuisé.

### 6. Mémoire des demandes

Le retour à l'agent liste les fils actifs **et rappelle les demandes déjà corrigées** des tours
précédents, à ne pas défaire.

## Conséquences

- Le blocage de US-2 ne peut plus se produire : un défaut « test manquant » va au testeur, qui peut
  l'écrire ou le contester. Le point resté ouvert dans l'ADR 0045 est réglé.
- Le budget de réessais est inchangé : contester ne donne pas de tour gratuit.
- Le schéma de verdict devient plus exigeant : une lentille qui omet la cible voit son appel refusé
  et doit le corriger, ce qui peut coûter un aller-retour.
- Les revues rejouables (`replayReview`) lisent les nouveaux champs ; les JSON plus anciens restent
  lisibles (champs facultatifs à la lecture).
- Le banc de mesure répond à toute interaction par la première option : en arbitrage, il donne
  raison à l'agent. À garder en tête en lisant un run de banc.
- Non éprouvé sur un run réel au moment de l'écriture.
