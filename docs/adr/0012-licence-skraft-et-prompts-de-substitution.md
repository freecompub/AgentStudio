# ADR 0012 — Licence de skraft-plugin et prompts de substitution

- Statut : **en attente de décision** (O9 / D42 ouverts : la décision revient au responsable du projet)
- Date : 2026-09-23
- Jalon : S0 (SPEC-skraft §0.3, §4, §14)

## Contexte

skraft-plugin 1.5.2 est distribué sous **GPL-3.0-or-later**. D41 prévoit de réutiliser ses 22 prompts
d'agents, 36 skills, politiques de `domain/` et la commande `artifact adr`, **sous réserve** de D42
(compatibilité de la licence avec la distribution de l'extension). O9 demande de trancher avant S1.

La GPL impose, en cas de distribution d'une œuvre dérivée, de la distribuer sous GPL avec ses sources.
La question est donc de savoir si l'extension `skraft` qui reprendrait ces textes et ce code est une
œuvre dérivée, et si elle peut être distribuée avec l'application ou séparément.

## Options

| Option | Effet | Condition |
| --- | --- | --- |
| A. Aucune reprise | Prompts, skills et politiques réécrits entièrement par nous | Aucune ; plus de travail de rédaction |
| B. Extension `skraft` sous GPL-3.0-or-later | Reprise autorisée ; l'extension (et elle seule) est distribuée sous GPL avec ses sources | Isolation réelle (processus séparé, API `ctx` publique) ; avis juridique sur la frontière avec l'application |
| C. Autorisation de l'auteur | Reprise sous une autre licence accordée par Sébastien Degodez | Accord écrit de l'auteur |

## Décision provisoire (en attendant l'arbitrage)

**Option A appliquée par défaut** (SPEC-skraft §0.3) : aucune ligne de prompt, de skill ni de code n'est
copiée du dépôt source. Le réducteur, les portes, les schémas et la synthèse de revue sont notre propre
conception (SPEC-skraft §5 à §11). Les rôles reçoivent des **prompts de substitution** minimaux,
rédigés à partir de la spécification et non du dépôt.

## À décider

- Choix entre A, B et C, par le responsable du projet, après avis juridique pour B.
- Si B ou C : appliquer le plan de reprise (SPEC-skraft §4) et remplacer les prompts de substitution.

## Conséquences

- S1 à S6 peuvent avancer sans attendre la décision ; la qualité des prompts de substitution est la
  variable à surveiller lors des runs réels.
- Aucun artefact actuel du dépôt n'est dérivé de skraft-plugin.
