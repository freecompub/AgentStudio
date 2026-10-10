# Run skraft — US-2.md — 2026-10-10 — extension skraft

- Mode : extension skraft ; réponses humaines : `/Users/b283ko/Projet/AgentStudio/docs/runs/reponses-us-2.json` ; plafond : 350 requêtes premium
- Projet : `/tmp/agentstudio-exemple-dotnet-tdd`, branche poussée `tests/us-2/extension-1`
- État final : ABORTED / —
- Durée : 0m09, 3 tours, 0 rejets, 0 tokens d'entrée
- Requêtes premium : 0 d'après le SDK (0 appels), écart de réserve 0

## Étapes

| Étape | Durée | Tours | Rejets | Fins anormales | Appels | Requêtes premium | Modèles | Tokens entrée |
|---|---|---|---|---|---|---|---|---|
| INIT | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |
| CLASSIFY | 0m01 | 1 | 0 | panne | 0 | 0 |  | 0 |
| ESCALATED | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |
| CLASSIFY | 0m00 | 1 | 0 | panne | 0 | 0 |  | 0 |
| ESCALATED | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |
| CLASSIFY | 0m00 | 1 | 0 | panne | 0 | 0 |  | 0 |
| ESCALATED | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |
| ABORTED | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |

## Étapes communes (docs/10 §3)

| Étape | Sous-étapes | Durée | Attente humaine | Hors attente | Agents | Code | Moteur | Tours | Appels | Requêtes premium | Tokens entrée | Tokens sortie | Rejets |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PRÉPARATION |  | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |
| DIFFICULTÉ | classifieur, escalade | 0m01 | 0m00 | 0m01 | 0m00 | 0m01 | 0m00 | 3 | 0 | 0 | 0 | 0 | 0 |
| BILAN | abandon | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |

## Rejets et leurs motifs

## Relevés de réserve

- 2026-10-10T12:13:48.107Z — départ : 41507
- 2026-10-10T12:13:48.308Z — CLASSIFY : 41507
- 2026-10-10T12:13:48.892Z — ESCALATED : 41507
- 2026-10-10T12:13:48.906Z — CLASSIFY : 41507
- 2026-10-10T12:13:49.229Z — ESCALATED : 41507
- 2026-10-10T12:13:49.234Z — CLASSIFY : 41507
- 2026-10-10T12:13:49.531Z — ESCALATED : 41507
- 2026-10-10T12:13:49.535Z — ABORTED : 41507
- 2026-10-10T12:13:54.092Z — fin : 41507
