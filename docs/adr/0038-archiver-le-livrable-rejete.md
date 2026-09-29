# ADR 0038 — Archiver le livrable avant que le rollback ne l'efface

- Statut : **décidé**, 2026-09-29
- Contexte amont : ADR 0029 (une interruption n'est pas un verdict), ADR 0032 (trace), D20 (preuves)

## Contexte

Cinquième run sur US-2. Pour la première fois, RESEARCH **produit** un document, et la porte le
juge sur son contenu :

> `src/Tarification.Domaine/LigneDePanier.cs:5-8` : plage hors du fichier, qui compte 7 lignes.

Reproche juste et actionnable. Mais à la demande « montre-moi ce qu'il a produit », le document
était introuvable :

- le rejet de porte déclenche un `rollback`, qui exécute `read-tree --reset -u` puis
  **`git clean -fdq`** — le fichier n'était pas commité, il a disparu ;
- la trace enregistre qu'un outil a été appelé, jamais **avec quoi** : `create` y figure, son
  contenu non.

On ne peut donc pas examiner ce qu'un agent a produit **au moment précis où une porte le refuse**,
c'est-à-dire exactement quand on voudrait le lire. C'est aussi ce qui empêchait, la veille, de
distinguer « il n'a jamais écrit » de « il a écrit et on a rembobiné ».

## Décision

1. **Avant tout rollback, les fichiers que le checkpoint va effacer sont archivés dans la trace.**
   `changedFiles(checkpoint)` en donne la liste exacte ; chacun est lu et enregistré avec son
   chemin et une étiquette qui situe le moment (« DESIGN essai 2 »).
2. **Dans la trace, pas dans le dépôt.** Elle vit déjà hors du projet, ne le pollue pas, et surtout
   `git clean -fdq` effacerait tout ce qu'on écrirait à côté.
3. **La trace s'ouvre aux extensions**, par une API étroite : `ctx.trace.rejected(taskId, étiquette,
   fichiers)`. La distinction posée par l'ADR 0032 sert ici pour la première fois — `evidence`
   **atteste** et une porte s'y appuie ; `trace` **raconte** et aucune porte ne doit s'y appuyer.
   Une extension qui pourrait forger des preuves serait un problème ; une extension qui archive ce
   qu'elle a produit, non.
4. **L'archivage ne peut pas faire échouer la tâche** : un échec d'écriture est journalisé en
   avertissement, et le rollback a lieu quand même.

## Conséquences

- Le document rejeté et le motif qui le condamne se lisent **côte à côte** dans la trace. C'est la
  matière d'une revue ; jusqu'ici on n'avait que le verdict.
- Le test qui verrouille la liste des capacités exposées à une extension — matérialisation de la
  règle de sécurité n°1 — a dû être mis à jour. C'est son rôle : obliger à justifier chaque ajout à
  cette surface plutôt que de l'y glisser.
- **Le contenu est tronqué à 8 000 caractères**, comme le reste de la trace, en le disant. Un
  document de recherche y tient ; un gros livrable serait coupé.
- Ceci est la **quatrième** omission de la même famille relevée en deux jours : la commande refusée,
  les compteurs de cache, le motif d'échec d'un outil, et maintenant le contenu jugé. À chaque fois
  l'information existait et n'était pas conservée. La trace enregistre désormais les décisions, les
  échecs avec leur motif, et les livrables rejetés — **mais toujours pas les arguments des outils**.
