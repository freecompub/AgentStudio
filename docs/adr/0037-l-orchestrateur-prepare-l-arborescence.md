# ADR 0037 — L'orchestrateur prépare l'arborescence, et la trace garde le motif des échecs

- Statut : **décidé**, 2026-09-29
- Contexte amont : ADR 0032 (trace), ADR 0033 (ce qu'un refus répond), ADR 0034 (explorer sans
  shell), D28

## Contexte

Trois runs de suite ont échoué au même endroit : `Document de recherche absent`. La trace de
l'ADR 0032 a livré l'explication, et elle n'était aucune de mes trois hypothèses successives.

**L'outil `create` du CLI ne crée pas les dossiers parents.** Il le documente lui-même :
*« Parent directories must exist before creating the file »*. Le chercheur l'a diagnostiqué seul,
en testant méthodiquement : chemin imbriqué, un seul niveau, `.keep`, fichier à la racine de
`.skraft/` — seul ce dernier passe —, l'outil `edit` avec un `old_str` vide, et jusqu'au lancement
d'un **sous-agent** pour voir si son outil se comporterait autrement. Sa conclusion :

> This is likely a harness limitation rather than something I should route around by breaking the
> path convention. […] the **orchestrator itself needs to create the target directory** rather
> than me.

**Notre garde n'y est pour rien, et y est pour tout.** Le relevé des décisions : 18 lectures
autorisées, 2 écritures autorisées, **zéro refus d'écriture**, 3 refus de shell — dont deux
`mkdir -p`. Le CLI ne sait pas créer le dossier ; nous lui retirons le seul autre moyen. Pris
séparément, chaque choix est défendable : la limite du CLI est sans conséquence en usage normal, où
l'agent a bash, et fermer le shell est justifié. **C'est leur intersection qui laisse le trou**, et
aucun des deux côtés ne pouvait le voir seul.

**Et l'enquête a coûté trois runs parce que la trace ne gardait pas le motif.** Le SDK rend
`{ code, message, remediation }` sur la fin d'un appel d'outil ; notre mapping n'en gardait que
`success: boolean`. Quinze échecs d'écriture, quinze fois « échoué », sans jamais la raison — que
le SDK fournissait. C'est le défaut que l'ADR 0032 était censée corriger, reproduit dans sa propre
implémentation cinq heures plus tard.

## Décision

1. **L'orchestrateur crée l'arborescence de la story à l'initialisation** : `research`, `design`,
   `distill/features`, `reviews`. La liste vit en un seul endroit, à côté des portes qui la lisent —
   `checkDesign` attend `design/`, la porte citations attend `research/` ; deux listes
   divergeraient.
2. **`ensureDir` entre dans l'API d'extension.** Elle n'avait que `writeFile`, et créer un dossier
   vide était impossible. Confinée comme l'écriture : rien hors du dépôt, liens symboliques
   résolus, et soumise à la permission d'écriture — préparer un dossier, c'est préparer une
   écriture.
3. **La fin d'un appel d'outil porte son erreur** — `code`, `message`, `remediation` — jusque dans
   la trace. Une trace qui dit « échoué » sans dire pourquoi ne sert à rien.

## Conséquences

- La question disparaît des deux côtés : l'agent n'a plus à créer de dossier, et n'a plus de raison
  de chercher un shell pour le faire.
- **Règle générale** : quand on retire une capacité, se demander **ce qui en dépendait**. On a fermé
  le shell en pensant aux tests et aux commandes dangereuses ; `mkdir` en dépendait aussi, parce
  qu'on ne s'est pas demandé de quoi les outils du runtime avaient besoin pour fonctionner. C'est le
  pendant de l'ADR 0033 — un refus doit dire ce que le rôle peut faire, et **ce qu'il peut faire
  doit suffire**.
- **Relevé, non traité** : un agent peut lancer des **sous-agents** (`agentId` existe dans les
  événements du SDK). Notre garde s'y applique — le sous-agent n'a pas eu de shell non plus — mais
  ni la trace, ni les plafonds de durée et de contexte ne distinguent ce qui s'y passe. À instruire.
