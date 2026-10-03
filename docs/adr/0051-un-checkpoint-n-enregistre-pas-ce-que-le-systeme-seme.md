# ADR 0051 — Un checkpoint n'enregistre pas ce que le système d'exploitation sème

- Statut : **décidé**, 2026-09-29
- Contexte amont : ADR 0003 (checkpoints par commits instantanés), D20 (les preuves sont produites
  par notre code), contrainte de portabilité Windows / macOS / Linux

## Contexte

Pendant les runs du 29/09, des `.DS_Store` sont apparus dans `.skraft/<slug>/` — créés par macOS,
pas par l'agent : aucune écriture de la garde ne les concerne.

Sur le poste de développement ils étaient **invisibles**, parce qu'un `~/.gitignore_global` les
couvre, et que l'instantané d'un checkpoint passe par `git add -A`, qui respecte `.gitignore`. Le
défaut annoncé d'abord — « ils sont enregistrés comme artefacts » — était donc **faux sur cette
machine**, et je l'ai affirmé sans vérifier la chaîne.

Il reste vrai partout où cette configuration n'existe pas : un poste neuf, la CI, un collègue sous
Windows avec `Thumbs.db` et `desktop.ini`. Là, ces fichiers entrent dans l'instantané, donc dans
`changedFiles`, donc dans les artefacts d'une phase — attribués à l'agent — et dans son commit. Un
même run rendrait des empreintes différentes selon le poste, sans que rien du travail ait changé.

C'est une dépendance à la configuration de l'utilisateur pour une propriété que le produit doit
garantir lui-même.

## Décision

1. **Le Workspace exclut ces fichiers de l'instantané.** La liste (`FICHIERS_DU_SYSTEME`) couvre
   macOS (`.DS_Store`, `._*`, `.Spotlight-V100`, `.Trashes`, `.fseventsd`) et Windows
   (`Thumbs.db`, `ehthumbs.db`, `desktop.ini`, `$RECYCLE.BIN`).
2. **Écrit dans le Workspace**, parce qu'il est le seul service qui touche le disque, et parce que
   c'est une connaissance de **plateforme** et non de langage : elle n'a rien à faire dans un
   adaptateur de stack (D10 par analogie).
3. **Par `reset HEAD` après l'ajout**, pas par exclusion de `git add`. Raison mesurée : dès qu'un
   pathspec explicite désigne un fichier ignoré par un `.gitignore`, `git add` **échoue** — y
   compris quand ce même fichier est exclu par un autre pathspec du même appel.
4. **Un fichier déjà suivi n'est pas retiré.** `reset HEAD` a la bonne sémantique aux deux bouts :
   absent de HEAD, il sort de l'index ; présent, il y revient dans sa version de HEAD. Quelqu'un qui
   a commité un `desktop.ini` volontairement le garde.

## Conséquences

- Les artefacts d'une phase ne contiennent plus que ce qu'un agent a écrit, quelle que soit la
  machine et quelle que soit la configuration Git de l'utilisateur.
- `git clean -fdq` du rollback continue de les supprimer du disque. Sans conséquence : personne ne
  s'appuie sur eux.
- **Ce que les tests prouvent, et ce qu'ils gardent.** Trois tests ; un seul discrimine réellement
  le correctif (les fichiers n'apparaissent plus dans le diff). Les deux autres gardent contre une
  *mauvaise* correction — supprimer le fichier du disque, ou retirer de l'instantané un fichier
  volontairement suivi. Ils passent sans le correctif ; c'est leur rôle, et il faut le savoir.
- **NON TRAITÉ** : la liste est fixe. Un environnement qui sème autre chose (un éditeur, un outil de
  synchronisation) n'est pas couvert, et rien ne permet à un projet d'en ajouter. Le `.gitignore` du
  projet reste le bon endroit pour ces cas-là.
