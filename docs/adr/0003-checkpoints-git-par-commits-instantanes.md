# ADR 0003 — Checkpoints Git par commits instantanés hors branche

- Statut : accepté
- Date : 2026-09-23
- Jalon : J1 (D7, D23, D29)

## Contexte

Un checkpoint doit capturer l'état **complet** de l'arbre de travail (modifications non commitées et
fichiers non suivis compris) avant chaque effet, sans perturber l'utilisateur : ni HEAD, ni l'index, ni
les fichiers ne doivent bouger. Un rollback doit restaurer exactement cet état, y compris si des
commits ont été créés depuis.

## Décision

- **Création** : via un index temporaire (`GIT_INDEX_FILE`) initialisé sur HEAD, `git add -A`,
  `write-tree`, puis `commit-tree -p HEAD`. Le commit est référencé sous
  `refs/agent-studio/checkpoints/<horodatage ms>-<aléa>` ; l'étiquette est le sujet du commit.
  L'identité `agent-studio` est imposée, pour ne pas dépendre de la configuration de l'utilisateur.
- **Diff** : on compare l'arbre du checkpoint à un instantané de l'arbre courant pris de la même façon
  (`--no-renames`, statuts ajouté / modifié / supprimé).
- **Rollback** : `read-tree --reset -u <checkpoint>` pour restaurer les fichiers,
  `clean -fd` pour supprimer les fichiers non suivis apparus depuis, puis `reset --mixed <HEAD du
  checkpoint>` pour remettre la branche et l'index.
- Les fichiers ignorés (`.gitignore`) ne sont ni capturés ni supprimés.

## Conséquences

- Les checkpoints survivent au redémarrage et sont visibles par `git for-each-ref`. Ils ne sont
  jamais poussés, car les refspecs par défaut ne couvrent pas `refs/agent-studio/*`.
- Après un rollback, les changements qui étaient indexés redeviennent non indexés : la distinction
  indexé / non indexé n'est pas conservée. Cette limite est acceptée.
- Il faudra une purge des vieux checkpoints (rétention à définir), sinon les objets s'accumulent
  jusqu'au `gc`.
- Il faut au moins un commit dans le dépôt pour créer un checkpoint.
