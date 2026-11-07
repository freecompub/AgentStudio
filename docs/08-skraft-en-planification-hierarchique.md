# skraft en planification hiérarchique (YAML) : approche abandonnée

Proposition du 2026-10-04, **abandonnée le 2026-10-05** au profit des workflows rejouables
(`docs/09-workflows-rejouables.md`, ADR 0052 et 0053).

Le contenu complet (format, catalogue, recette `skraft.yaml`, douze scripts Python, test de
parité) reste lisible dans l'historique : commit `df4eed3`, dossier `fonctionnalites/`, et ce
fichier dans sa version de ce commit.

## Ce qui était proposé

Une fonctionnalité serait un dossier téléversé : un fichier YAML décrivant entrées, sessions,
actions, contrôles et orchestration en tâches et méthodes (planification hiérarchique, HTN), plus
des scripts Python pour le code propre. Aucun TypeScript.

## Pourquoi on l'abandonne

1. **Le YAML était devenu un langage de programmation sans les outils d'un langage.** Conditions
   (`si:` à grammaire fermée), boucles, politiques d'échec à quatre issues, références du type
   `sorties.tests-ajoutes.controles.nouveaux-tests-verts-ou-rouges-pour-bonne-raison.rouges` :
   790 lignes, sans typage, sans débogueur, sans pas-à-pas.
2. **Il ne suffisait pas.** Deux comportements réels de skraft ne s'y exprimaient pas : l'essai
   garanti de la première revue (ADR 0042) et la correction d'un défaut maintenu par arbitrage
   humain malgré un budget épuisé. La revue elle-même devait devenir une primitive opaque de la
   plateforme.
3. **Les fautes y étaient invisibles.** Deux défauts de séquence (diff relevé avant le tour de
   l'architecte, réessai qui reposait le checkpoint) n'ont été vus qu'en relisant ; le test de
   cohérence ne pouvait pas les voir. Une comparaison à la main en a trouvé dix autres (repris
   dans `docs/09` §13).
4. **Il doublait le code.** Les portes, déjà écrites et testées en TypeScript, étaient recopiées
   en Python, puis il fallait des tests de parité pour vérifier que les deux copies disaient la
   même chose (pièges : `\w` ASCII contre Unicode, `localeCompare`).
5. **Il ne visait personne.** Un non-développeur n'écrit pas ce YAML ; un développeur préfère du
   code.

## Ce qu'on garde

- **La cause réelle de la difficulté** : écrire skraft a coûté parce qu'il a fallu une machine à
  états écrite à la main (`reducer.ts`, `deliver-machine.ts`, une quarantaine de champs d'état qui
  ne servent qu'à savoir où l'on en est). Les workflows rejouables s'attaquent à elle.
- **La règle des sessions** (toutes détruites à la fin de l'orchestration), précisée et étendue au
  crash : ADR 0053.
- **`creation-seule`** pour les ADR, à la place de l'outil `render_adr` : à trancher pendant la
  migration (`docs/09` §13).
- **Les écarts entre la recette et le code**, qui sont des questions sur le comportement de
  skraft, indépendantes du format : `docs/09` §13.
