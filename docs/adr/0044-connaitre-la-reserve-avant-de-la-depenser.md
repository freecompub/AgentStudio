# ADR 0044 — Connaître la réserve avant de la dépenser

- Statut : **décidé**, 2026-09-29
- Contexte amont : D25 (panne d'environnement = escalade immédiate, sans budget), ADR 0031
  (l'occupation du contexte se mesure, elle ne se devine pas), §10.2 (les jetons ne franchissent
  jamais l'IPC)

## Contexte

Le 29/09, six runs de mesure ont été lancés dans la journée. En fin de journée, l'utilisateur a
supposé être à court de crédit Copilot et a demandé que cette information remonte. Elle était
disponible, à un appel de distance, et rien ne la demandait :

```
premium_interactions   1471 utilisées / 1500   →   28 restantes (1,8 %)
overage_permitted      false                   →   à zéro, les appels sont REFUSÉS
quota_reset_date       2026-10-01
chat, completions      illimités
```

28 requêtes en réserve, pour une phase qui en consomme des dizaines. Une tâche lancée dans cet état
s'arrête forcément à mi-parcours.

Ce qui se passe aujourd'hui quand la réserve s'épuise en cours de route : `session.error` devient
un `EnvFailureError` dont le message est recopié tel quel, puis une escalade dont le motif est ce
texte brut, avec trois options — « relancer », « sauter », « abandonner » — dont la première ne
peut que réechouer. C'est le même travers que l'ADR 0031 : un seuil qu'on ne mesure pas est un
seuil qu'on subit.

## Décision

1. **`GitHubAuth.copilotQuota()`** lit la réserve sur `/copilot_internal/user`, le point d'accès
   que les éditeurs interrogent — d'où l'en-tête `Editor-Version`, sans lequel GitHub refuse.
2. **Il rend `null`, jamais une exception.** `gh` absent, utilisateur déconnecté, point d'accès
   changé, JSON illisible, champs disparus : toutes ces situations donnent « réserve inconnue ».
   Le point d'accès n'est pas documenté publiquement ; tout y est traité comme facultatif. Une
   réserve inconnue ne doit jamais empêcher de travailler.
3. **Le banc l'affiche avant de lancer**, et signale une réserve insuffisante sans rien interdire.
4. **Le canal `auth:quota`** l'expose au renderer, validé par le contrat comme le reste. Ce sont
   des **chiffres** qui franchissent l'IPC, jamais un jeton (§10.2).

## Conséquences

- La décision de lancer ou non reste **humaine**. Rien n'est bloqué : le code dit ce qu'il sait,
  l'utilisateur tranche. Interdire un lancement sur la foi d'un point d'accès non documenté serait
  pire que le mal.
- Les tests portent la charge utile **réellement rendue par GitHub** le 29/09, réduite aux champs
  lus. Si le point d'accès change de forme, c'est un test qui le dira, pas un run à mi-parcours.
- **NON TRAITÉ, et c'est le plus important.** Quand la réserve s'épuise malgré tout, le pipeline
  traite l'erreur comme n'importe quelle panne : message brut, mêmes options, « relancer » en
  premier. Classer les pannes du runtime (quota, authentification, réseau) autrement que par leur
  texte demande d'avoir **observé** l'erreur ; on ne l'a jamais vue. Le projet a déjà tranché ce
  genre de question pour les erreurs de compilation, en classant par code et non par message
  (`buildErrors.missingSymbol`), parce que les messages sont traduits. Il faudra le même traitement
  ici, et il faudra une vraie erreur pour l'écrire.
- **NON FAIT** : le renderer ne montre encore rien. Le canal existe et est testé ; l'affichage
  reste à placer.
