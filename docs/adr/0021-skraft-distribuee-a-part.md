# ADR 0021 — skraft distribuée à part, non signée pour l'instant

- Statut : **décidé**
- Date : 2026-09-24
- Jalon : hors jalon (suite de S6)

## Contexte

`skraft` était livrée avec l'application, au même titre que `tdd` : compilée par
`build-extensions.mjs` et activée à l'ouverture de tout projet. Cela ne correspond ni à sa nature
— une méthode de travail parmi d'autres, pas une fonction du socle — ni à sa distribution, qui doit
rester séparable de celle de l'application (D41, ADR 0012).

Une extension livrée avec l'application échappe de fait au parcours d'installation : ni
empaquetage, ni accord de l'utilisateur, ni vérification de signature.

## Décision

**`skraft` sort des extensions livrées** et se distribue en paquet `.asx`, installé depuis un
fichier comme n'importe quelle extension tierce.

- Elle reste dans ce dépôt : les tests continuent de tourner dans le même `pnpm test`, et les
  paquets internes se résolvent sans publication sur un registre.
- Elle n'est **pas signée pour l'instant**, donc elle exige le **mode développeur**
  (`developerMode: true` dans `admin.json`). L'installation est refusée sans lui.
- Deux commandes la produisent :

  ```bash
  pnpm ext:build extensions/skraft <dossier>   # compile l'entrée et écrit manifest.json
  pnpm ext:pack <dossier> skraft.asx           # empaquette, sans signature
  ```

`tdd` reste livrée avec l'application : elle sert de méthode par défaut.

## Préalable réglé en même temps

Une extension distribuée séparément ne doit connaître que `@agent-studio/extension-api` (D10). Or
`skraft` et `tdd` importaient `EnvFailureError`, `WorkDefectError` et `matchesAny` du cœur. Ces
symboles sont désormais définis dans `extension-api`, que le cœur réexporte.

Ces erreurs franchissent la frontière de processus **par leur `name`**, jamais par `instanceof`
(`extension-host/src/rpc/endpoint.ts`) : le contrat est le nom, et un test le verrouille.

## Conséquences

- L'utilisateur doit installer `skraft` lui-même, et activer le mode développeur pour cela. Sur
  macOS, `admin.json` réside dans `/Library/Application Support/agent-studio/`, donc son écriture
  demande des droits d'administration : c'est un frein assumé tant que l'extension n'est pas signée.
- Les tests de bout en bout de `skraft` (S1 à S6) sont inchangés : ils compilaient déjà l'extension
  et l'activaient dans un processus isolé. Un test supplémentaire couvre le parcours d'installation
  lui-même (`extensions/skraft/test/install.test.ts`).
- Le bundle de `tdd` passe de 766,8 Ko à 23,8 Ko : il tirait zod à travers le cœur sans s'en servir.

## À reprendre plus tard

- **Signer `skraft`** avec une clé d'éditeur, pour se passer du mode développeur. Cela suppose de
  décider où vit la clé et qui inscrit l'éditeur dans `admin.json`.
- **O5** conditionne ce point : tant que les profils et éditeurs approuvés viennent d'un fichier
  système, l'installation reste réservée à un poste administré.
