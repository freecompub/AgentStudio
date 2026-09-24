# ADR 0012 — Licence de skraft-plugin et prompts de substitution

- Statut : **décidé — option C** (autorisation de l'auteur), 2026-09-24. Reprise non commencée :
  conditions à réunir ci-dessous.
- Date : 2026-09-23, mis à jour le 2026-09-24
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

## Décision (2026-09-24)

Le responsable du projet retient l'**option C** : l'auteur de skraft-plugin autorise la reprise.
O9 et D42 sont donc tranchés, et la reprise des prompts, skills et politiques est permise.

**Avant toute copie, trois conditions restent à réunir :**

1. **La trace écrite de l'autorisation** — l'option C l'exige explicitement. Elle doit être versée au
   dépôt (par exemple `docs/licences/autorisation-skraft.md`) : qui autorise, quoi, à quelle date.
2. **La licence accordée** — une autorisation ne dit pas sous quelle licence redistribuer. Il faut
   savoir si l'extension `skraft` reste sous la licence de l'application, ou sous une autre.
   Sans cette précision, la GPL-3.0-or-later continue de s'appliquer par défaut.
3. **L'accès au dépôt source** — skraft-plugin 1.5.2 n'est pas présent sur le poste de développement.
   Aucune reprise n'est matériellement possible avant de l'obtenir.

Tant que ces trois points ne sont pas réunis, le code livré reste celui de l'option A, décrit
ci-dessous. Il fonctionne : rien n'est bloqué, seule la qualité des prompts reste une inconnue.

## Décision provisoire appliquée jusqu'ici (option A)

**Option A appliquée par défaut** (SPEC-skraft §0.3) : aucune ligne de prompt, de skill ni de code n'est
copiée du dépôt source. Le réducteur, les portes, les schémas et la synthèse de revue sont notre propre
conception (SPEC-skraft §5 à §11). Les rôles reçoivent des **prompts de substitution** minimaux,
rédigés à partir de la spécification et non du dépôt.

## Reste à faire

- Verser la trace écrite de l'autorisation et préciser la licence de redistribution.
- Obtenir le dépôt skraft-plugin 1.5.2.
- Appliquer ensuite le plan de reprise (SPEC-skraft §4) : remplacer les prompts de substitution de
  `extensions/skraft/src/roles.ts` et la table de pondération des lentilles
  (`extensions/skraft/src/review.ts`, aujourd'hui des règles minimales).

## Conséquences

- S1 à S6 peuvent avancer sans attendre la décision ; la qualité des prompts de substitution est la
  variable à surveiller lors des runs réels.
- Aucun artefact actuel du dépôt n'est dérivé de skraft-plugin.
