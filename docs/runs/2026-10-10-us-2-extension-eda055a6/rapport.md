# Run skraft — US-2.md — 2026-10-10 — extension skraft

- Mode : extension skraft ; réponses humaines : `/Users/b283ko/Projet/AgentStudio/docs/runs/reponses-us-2.json` ; plafond : 350 requêtes premium
- Projet : `/private/var/folders/q0/zz_gtf8x0cb9dvz3q9bfjhs40000gp/T/mesure-skraft-gV7DrI`
- État final : ABORTED / DELIVER
- Durée : 11m43, 32 tours, 9 rejets, 4225975 tokens d'entrée
- Requêtes premium : 113.6 d'après le SDK (113 appels), écart de réserve 105

## Étapes

| Étape | Durée | Tours | Rejets | Fins anormales | Appels | Requêtes premium | Modèles | Tokens entrée |
|---|---|---|---|---|---|---|---|---|
| INIT | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |
| CLASSIFY | 0m06 | 1 | 0 |  | 1 | 0.2 | gpt-6-luna | 15011 |
| CONFIRM_DIFFICULTY | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |
| ROUTE | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |
| DISTILL | 0m46 | 1 | 0 |  | 6 | 11.7 | gpt-6.1-sol | 190243 |
| REVIEW | 0m27 | 4 | 0 |  | 15 | 25.2 | gpt-6.1-sol | 311074 |
| DISTILL | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |
| DELIVER | 3m35 | 8 | 2 |  | 31 | 29.2 | gpt-6.1-sol | 850600 |
| ESCALATED | 0m00 | 0 | 1 |  | 0 | 0 |  | 0 |
| DELIVER | 3m22 | 9 | 2 |  | 30 | 22.1 | gpt-6.1-sol | 1236470 |
| ESCALATED | 0m00 | 0 | 1 |  | 0 | 0 |  | 0 |
| DELIVER | 3m21 | 9 | 2 |  | 30 | 25.3 | gpt-6.1-sol | 1622577 |
| ESCALATED | 0m00 | 0 | 1 |  | 0 | 0 |  | 0 |
| ABORTED | 0m00 | 0 | 0 |  | 0 | 0 |  | 0 |

## Étapes communes (docs/10 §3)

| Étape | Sous-étapes | Durée | Attente humaine | Hors attente | Agents | Code | Moteur | Tours | Appels | Requêtes premium | Tokens entrée | Tokens sortie | Rejets |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PRÉPARATION |  | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |
| DIFFICULTÉ | classifieur, confirmation | 0m06 | 0m00 | 0m06 | 0m05 | 0m00 | 0m00 | 1 | 1 | 0.2 | 15011 | 136 | 0 |
| QUESTIONS |  | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |
| DISTILL | revue | 1m13 | 0m00 | 1m13 | 1m53 | 0m03 | 0m00 | 5 | 21 | 36.8 | 501317 | 4587 | 0 |
| DELIVER | escalade | 10m19 | 0m00 | 10m19 | 8m40 | 1m39 | 0m00 | 26 | 91 | 76.6 | 3709647 | 19281 | 9 |
| BILAN | abandon | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0m00 | 0 | 0 | 0 | 0 | 0 | 0 |

## Rejets et leurs motifs

### DELIVER — porte « scénario ac-2 »

- Couverture : src/Tarification.Application/CalculDuPanier.cs à 75 % (minimum 90 %), 3 ligne(s) couverte(s) sur 4.
- Couverture : src/Tarification.Domaine/Panier.cs à 87.5 % (minimum 90 %), 7 ligne(s) couverte(s) sur 8.

### DELIVER — porte « scénario ac-2 »

- Couverture : src/Tarification.Application/CalculDuPanier.cs à 75 % (minimum 90 %), 3 ligne(s) couverte(s) sur 4.
- Couverture : src/Tarification.Domaine/Panier.cs à 87.5 % (minimum 90 %), 7 ligne(s) couverte(s) sur 8.

### ESCALATED — porte « scénario ac-2 »

- Couverture : src/Tarification.Application/CalculDuPanier.cs à 75 % (minimum 90 %), 3 ligne(s) couverte(s) sur 4.
- Couverture : src/Tarification.Domaine/Panier.cs à 87.5 % (minimum 90 %), 7 ligne(s) couverte(s) sur 8.

### DELIVER — porte « scénario ac-2 »

- Couverture : src/Tarification.Application/CalculDuPanier.cs à 75 % (minimum 90 %), 3 ligne(s) couverte(s) sur 4.
- Couverture : src/Tarification.Domaine/Panier.cs à 87.5 % (minimum 90 %), 7 ligne(s) couverte(s) sur 8.

### DELIVER — porte « scénario ac-2 »

- Couverture : src/Tarification.Application/CalculDuPanier.cs à 75 % (minimum 90 %), 3 ligne(s) couverte(s) sur 4.
- Couverture : src/Tarification.Domaine/Panier.cs à 87.5 % (minimum 90 %), 7 ligne(s) couverte(s) sur 8.

### ESCALATED — porte « scénario ac-2 »

- Couverture : src/Tarification.Application/CalculDuPanier.cs à 75 % (minimum 90 %), 3 ligne(s) couverte(s) sur 4.
- Couverture : src/Tarification.Domaine/Panier.cs à 87.5 % (minimum 90 %), 7 ligne(s) couverte(s) sur 8.

### DELIVER — porte « scénario ac-2 »

- Couverture : src/Tarification.Application/CalculDuPanier.cs à 75 % (minimum 90 %), 3 ligne(s) couverte(s) sur 4.
- Couverture : src/Tarification.Domaine/Panier.cs à 87.5 % (minimum 90 %), 7 ligne(s) couverte(s) sur 8.

### DELIVER — porte « scénario ac-2 »

- Couverture : src/Tarification.Application/CalculDuPanier.cs à 75 % (minimum 90 %), 3 ligne(s) couverte(s) sur 4.
- Couverture : src/Tarification.Domaine/Panier.cs à 87.5 % (minimum 90 %), 7 ligne(s) couverte(s) sur 8.

### ESCALATED — porte « scénario ac-2 »

- Couverture : src/Tarification.Application/CalculDuPanier.cs à 75 % (minimum 90 %), 3 ligne(s) couverte(s) sur 4.
- Couverture : src/Tarification.Domaine/Panier.cs à 87.5 % (minimum 90 %), 7 ligne(s) couverte(s) sur 8.

## Relevés de réserve

- 2026-10-10T14:07:51.751Z — départ : 41041
- 2026-10-10T14:07:51.935Z — CLASSIFY : 41041
- 2026-10-10T14:07:57.909Z — CONFIRM_DIFFICULTY : 41041
- 2026-10-10T14:07:57.918Z — ROUTE : 41041
- 2026-10-10T14:07:57.923Z — DISTILL : 41041
- 2026-10-10T14:08:43.989Z — REVIEW : 41041
- 2026-10-10T14:09:11.072Z — DISTILL : 41041
- 2026-10-10T14:09:11.317Z — DELIVER : 41041
- 2026-10-10T14:12:46.384Z — ESCALATED : 40966
- 2026-10-10T14:12:46.549Z — DELIVER : 40966
- 2026-10-10T14:16:08.894Z — ESCALATED : 40936
- 2026-10-10T14:16:09.065Z — DELIVER : 40936
- 2026-10-10T14:19:30.395Z — ESCALATED : 40936
- 2026-10-10T14:19:30.564Z — ABORTED : 40936
- 2026-10-10T14:19:32.409Z — fin : 40936
