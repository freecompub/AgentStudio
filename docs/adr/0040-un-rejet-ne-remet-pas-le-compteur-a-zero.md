# ADR 0040 — Un rejet ne remet pas le compteur à zéro

- Statut : **décidé**, 2026-09-29
- Amende : ADR 0029 (« un tour interrompu n'est pas un travail jugé mauvais »), point 5
- Contexte amont : ADR 0039 (une session par phase, pas par essai), D24 (défaut de travail =
  réessai), SPEC §6 (checkpoint avant chaque effet)

## Contexte

L'ADR 0029 a retiré le `rollback` du **tour interrompu**, et l'a explicitement gardé pour le
**rejet de porte** : « là, un jugement a eu lieu ». C'était cohérent tant que chaque essai
repartait d'une session neuve : l'agent ne se souvenait de rien, donc effacer ses fichiers ne
contredisait rien.

L'ADR 0039 a changé cette prémisse. L'agent **garde sa session** d'un essai à l'autre. Au deuxième
essai, `skraft-architect-model` arrive avec, dans sa conversation, les appels d'outils qui ont créé
`design/contracts.md`, `design/event-model.md`, `design/domain-model.md`. Il en est certain : il les
a écrits, l'outil a répondu que c'était fait.

Sauf que le `rollback` les a effacés entre-temps. On lui demande alors de *corriger* des fichiers
que le disque ne contient plus. Deux issues, toutes deux mauvaises : il édite un fichier absent et
échoue, ou il retape de mémoire ce qu'il croit avoir écrit — c'est-à-dire tout, et sans le motif du
rejet comme guide puisqu'il refait le trajet entier.

Garder la session **et** effacer les fichiers, c'est garder le souvenir et retirer la chose : la
pire des deux combinaisons.

## Décision

1. **Un réessai n'annule rien.** `failure()` n'émet plus de `rollback` tant que le budget permet un
   nouvel essai — rejet de porte, revue défavorable ou interruption, indifféremment.
2. **L'escalade annule toujours** (inchangé, ADR 0029 point 3) : budget épuisé, panne
   d'environnement, phase sautée. Quand la main repasse à l'humain, le dépôt est propre.
3. Le paramètre `interrompu` de `failure()` disparaît : il ne distinguait plus que ce que la
   décision 1 vient d'unifier. La distinction survit là où elle porte encore — le **message** rendu
   à l'agent, où `tourInterrompu()` dit « interrompu, pas refusé » et « relis, ne recommence pas ».
4. La sous-machine DELIVER garde ses `rollback` : ils ne jettent pas un travail jugé mauvais, ils
   ramènent au **dernier vert prouvé** du cycle rouge/vert (ADR 0017). Ce n'est pas la même chose,
   et l'agent y est relancé sur un état que le code a mesuré.

## Conséquences

- **La sécurité ne change pas**, et ne reposait déjà pas là-dessus : la porte de fin de phase juge
  l'**état final**, quel qu'ait été le chemin. Un essai qui laisse un fichier bancal derrière lui
  sera recalé par elle, comme avant.
- Des fichiers d'un essai précédent peuvent **survivre** à un essai qui ne les réécrit pas. C'est
  voulu : c'est la définition d'une correction. La porte les lira comme le reste.
- L'archivage du livrable rejeté (ADR 0038) reste utile mais n'est plus la seule trace : jusqu'à
  l'escalade, le livrable jugé est encore sur le disque.
- Les `ensureDir` de reconstruction après `rollback` (ADR 0037) ne servent plus que sur le chemin
  d'escalade. Ils y restent nécessaires : `git clean -fdq` supprime les dossiers vides, et git n'en
  suit aucun.
- Le test « GATE_FAIL avec budget → rollback au checkpoint de phase » a été **réécrit** : il
  affirmait la règle qu'on renverse. Ce qu'il protégeait vraiment — relance ciblée, motif transmis,
  budget consommé — est vérifié à l'identique.
