# Fonctionnalités téléversables

**Proposition du 2026-10-04** (`docs/08-skraft-en-planification-hierarchique.md`). Aucun code de
production ne charge encore ces fichiers.

Une fonctionnalité est **un dossier** qu'un utilisateur téléverse : un fichier YAML qui décrit tout
(entrées, sessions, actions, tâches), et les fichiers qu'il cite (prompts d'agents, skills,
scripts). Pas de TypeScript, pas d'extension à compiler. La plateforme valide le dossier au
téléversement, l'exécute, et vérifie.

| Fichier | Rôle | Propriétaire |
|---|---|---|
| `fonctionnalite.schema.json` | le format : chaque sorte d'élément a une liste fermée de propriétés | la plateforme |
| `catalogue.yaml` | ce que la plateforme fournit sans déclaration : opérations, primitives, vérifications, outils, avec leurs paramètres | la plateforme |
| `skraft/` | skraft décrit comme une fonctionnalité | l'auteur de skraft |

## `skraft/`

| Fichier | Contenu |
|---|---|
| `skraft.yaml` | la recette complète |
| `scripts/*.py` | le code propre à skraft (lecteur de story, difficulté, portes de recherche, de conception, Gherkin, valeurs, rouge d'acceptance, plan, contrat, ratification, rapport), porté depuis `extensions/skraft/src/` |
| `agents/`, `skills/` | copies de celles de l'extension ; un test vérifie qu'elles sont identiques |
| `LICENSE` | GPL-3.0-or-later, comme l'extension |

**Contrat d'un script** : paramètres en JSON sur l'entrée standard, résultat `{ "motifs": [...],
"sorties": {...} }` sur la sortie standard ; code de retour 0 = ok, 1 = ko, autre = erreur
d'environnement. Aucun shell ; répertoire courant : la racine du dépôt ; lecture seule sauf
déclaration contraire. Python 3, bibliothèque standard seulement.

## Vérification

```bash
pnpm vitest run --project ext-skraft test/fonctionnalite-generique.test.ts
```

- la recette respecte le schéma ;
- tout nom appelé existe (recette ou catalogue) avec des paramètres connus et complets, toute
  référence vise une entrée, un fait, un réglage ou une étape déclarés, rien n'est inutilisé ;
- chaque script rend **la même chose** que la fonction TypeScript dont il est le portage (sauté
  sans Python 3).
