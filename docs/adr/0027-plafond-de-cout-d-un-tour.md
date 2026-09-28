# ADR 0027 — Un plafond de coût par tour : le cumul des tokens d'entrée

- Statut : **amendé par l'ADR 0031**, 2026-09-29 — le seuil par défaut de 1 M est retiré ; le
  plafond opératoire porte désormais sur l'occupation de la fenêtre de contexte.
- Statut initial : **décidé**, 2026-09-28
- Contexte amont : ADR 0026 (plafond de durée d'un tour), D30, D24/D25

## Contexte

L'ADR 0026 borne la **durée** d'un tour. Le même run du 2026-09-28 montre que la durée ne dit rien
du coût :

| Phase | Tokens d'entrée | Par tour |
| --- | --- | --- |
| RESEARCH | 573 358 | 143 k |
| **DESIGN** | **4 230 824** | **529 k** |
| REVIEW | 662 408 | 83 k |

Un tour peut être bref et ruineux, ou long et sobre. Le plafond de durée n'aurait pas empêché un
tour de dix minutes à un million de tokens.

La cause est structurelle, pas accidentelle : **chaque appel au modèle renvoie tout le contexte**,
donc le repaie. Un tour de N appels d'outil coûte en O(N²), et rien ne bornait N. L'agent
architecte lisait le dépôt, appelait un outil, relisait, rappelait — chaque aller-retour emportant
tout ce qui précédait.

Le signal existait déjà et n'était pas exploité : l'événement `usage` du runtime porte
`inputTokens`, et `task-agent-runner.ts` ne s'en servait que pour *compter après coup*.

## Décision

1. **Un plafond du cumul des tokens d'entrée par tour.** Défaut **1 M**, réglable
   (`maxInputTokens`, `agentMaxInputTokens`). Il est lu en direct sur l'événement `usage`, pendant
   le tour, et non à sa fin.
2. **Le cumul ne décroît jamais.** C'est ce qui a été **payé**, pas ce qui tient en mémoire.
   Regarder la taille du dernier appel ne couperait rien : les appels rétrécissent souvent alors
   que la facture monte. Un test le défend avec une suite d'appels décroissants.
3. **Une erreur distincte, `TurnCostError`**, séparée de `TurnBudgetError` (durée) et de
   `TurnTimeoutError` (silence). Trois causes, trois motifs lus par l'humain : « il ne répond
   plus », « il n'en finissait pas », « il coûtait trop ». Comme les autres, c'est un
   `WorkDefectError` — réessai borné par le budget de la phase, pas escalade.
4. **Le défaut est large.** 1 M est environ sept fois un tour normal observé ; il aurait coupé le
   tour pathologique bien avant ses 529 k moyens sur huit tours, sans menacer un tour légitime.

## Conséquences

- **Ceci est un coupe-circuit, pas une réduction du contexte.** Le contexte continue de croître de
  la même façon ; on cesse seulement de payer au-delà d'un seuil. Un réessai repart d'une session
  neuve, donc d'un contexte vide — ce qui atténue, sans corriger la croissance elle-même.
- **Le vrai correctif reste à faire**, et il n'est pas dans le cœur : c'est de donner à l'agent
  moins à lire. Un dossier de passation construit par le code plutôt qu'un dépôt à explorer.
  À instruire séparément.
- Le coût reste **invisible pendant** la tâche : il est enregistré par phase
  (`tasks/<id>/usage/<taskId>.json`) et ne remonte pas à l'écran. Le responsable a découvert les
  4,2 M tokens en lisant un fichier. Rendre la dépense visible en direct est un chantier distinct.
