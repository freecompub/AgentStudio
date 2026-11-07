# Run skraft — US-2.md — 2026-10-10 — workflow skraft

- Mode : workflow skraft ; réponses humaines : `/Users/b283ko/Projet/AgentStudio/docs/runs/reponses-us-2.json` ; plafond : 600 requêtes premium
- Projet : `/tmp/agentstudio-exemple-dotnet-tdd`, branche poussée `tests/us-2/workflow-2`
- État final : fini / DONE
- Durée : 17m58, 29 tours, 1 rejets, 4019194 tokens d'entrée
- Requêtes premium : 335.4 d'après le SDK (111 appels), écart de réserve 279

## Étapes

| Étape | Durée | Tours | Rejets | Fins anormales | Appels | Requêtes premium | Modèles | Tokens entrée |
|---|---|---|---|---|---|---|---|---|
| INIT | 0m04 | 0 | 0 |  | 0 | 0 |  | 0 |
| CLASSIFY | 0m05 | 1 | 0 |  | 1 | 0.2 | gpt-6-luna | 15038 |
| CONFIRM_DIFFICULTY | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |
| RESEARCH | 0m19 | 1 | 0 |  | 3 | 6.9 | gpt-6.1-sol | 57323 |
| BLOCKED | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |
| RESEARCH | 2m07 | 2 | 1 |  | 10 | 36.5 | gpt-6.1-sol | 414381 |
| ROUTE | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |
| DESIGN | 1m49 | 2 | 0 |  | 10 | 40.4 | claude-sonnet-5.5, gpt-6.1-sol | 432338 |
| BLOCKED | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |
| DESIGN | 0m06 | 1 | 0 |  | 1 | 9.5 | gpt-6.1-sol | 36580 |
| BLOCKED | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |
| DESIGN | 0m04 | 1 | 0 |  | 1 | 1.4 | gpt-6.1-sol | 38031 |
| BLOCKED | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |
| DESIGN | 2m58 | 1 | 0 |  | 9 | 25.1 | gpt-6.1-sol | 473014 |
| REVIEW | 1m04 | 3 | 0 |  | 11 | 27.4 | gpt-6.1-sol | 269160 |
| RATIFICATION | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |
| DISTILL | 3m02 | 1 | 0 |  | 8 | 28.2 | gpt-6.1-sol | 331102 |
| REVIEW | 0m57 | 4 | 0 |  | 8 | 57.4 | gpt-6.1-sol | 234066 |
| DELIVER | 4m18 | 8 | 0 |  | 40 | 72.8 | gpt-6.1-sol | 1368252 |
| REVIEW | 0m58 | 4 | 0 |  | 9 | 29.7 | gpt-6.1-sol | 349909 |
| DONE | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |

## Étapes communes (docs/10 §3)

| Étape | Sous-étapes | Durée | Attente humaine | Hors attente | Agents | Code | Moteur | Tours | Appels | Requêtes premium | Tokens entrée | Tokens sortie | Rejets |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PRÉPARATION |  | 0m04 | 0m00 | 0m04 | 0m00 | 0m04 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |
| DIFFICULTÉ | classifieur, confirmation | 0m05 | 0m00 | 0m05 | 0m04 | 0m01 | 0m00 | 1 | 1 | 0.2 | 15038 | 55 | 0 |
| RESEARCH | blocage | 2m26 | 0m00 | 2m26 | 2m24 | 0m00 | 0m00 | 3 | 13 | 43.4 | 471704 | 8805 | 1 |
| QUESTIONS |  | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |
| DESIGN | blocage, revue, ratification | 6m02 | 0m00 | 6m02 | 5m58 | 0m01 | 0m00 | 8 | 32 | 103.7 | 1249123 | 28318 | 0 |
| DISTILL | revue | 3m59 | 0m00 | 3m59 | 3m55 | 0m03 | 0m00 | 5 | 16 | 85.6 | 565168 | 14816 | 0 |
| DELIVER | revue | 5m16 | 0m00 | 5m16 | 4m07 | 0m57 | 0m05 | 12 | 49 | 102.5 | 1718161 | 9588 | 0 |
| BILAN |  | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |

## Rejets et leurs motifs

### RESEARCH — porte « citations »

- Section manquante : « Recommandation ».
- Section manquante : « Passage de relais ».

## Relevés de réserve

- 2026-10-10T19:52:29.342Z — départ : 39712
- 2026-10-10T19:52:29.419Z — INIT : 39712
- 2026-10-10T19:52:33.900Z — CLASSIFY : 39712
- 2026-10-10T19:52:38.713Z — CONFIRM_DIFFICULTY : 39712
- 2026-10-10T19:52:38.724Z — RESEARCH : 39712
- 2026-10-10T19:52:57.396Z — BLOCKED : 39691
- 2026-10-10T19:52:57.406Z — RESEARCH : 39691
- 2026-10-10T19:55:04.794Z — ROUTE : 39691
- 2026-10-10T19:55:04.808Z — DESIGN : 39691
- 2026-10-10T19:56:54.236Z — BLOCKED : 39630
- 2026-10-10T19:56:54.256Z — DESIGN : 39630
- 2026-10-10T19:57:00.725Z — BLOCKED : 39630
- 2026-10-10T19:57:00.744Z — DESIGN : 39630
- 2026-10-10T19:57:04.953Z — BLOCKED : 39630
- 2026-10-10T19:57:04.971Z — DESIGN : 39630
- 2026-10-10T20:00:02.539Z — REVIEW : 39630
- 2026-10-10T20:01:06.106Z — RATIFICATION : 39630
- 2026-10-10T20:01:06.532Z — DISTILL : 39541
- 2026-10-10T20:04:08.842Z — REVIEW : 39541
- 2026-10-10T20:05:05.890Z — DELIVER : 39541
- 2026-10-10T20:09:24.227Z — REVIEW : 39433
- 2026-10-10T20:10:21.928Z — DONE : 39433
- 2026-10-10T20:10:25.421Z — fin : 39433
