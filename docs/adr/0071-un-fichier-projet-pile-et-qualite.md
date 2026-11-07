# ADR 0071 — Un seul fichier de projet : la pile et la qualité (`.agent-studio/projet.yaml`)

## Statut

**Accepté** le 2026-11-07 par le responsable du projet (« Ok, ça me convient »), branche
`feat/fichier-projet`. Revient sur les points 1 et 2 de l'ADR 0049 (deux fichiers) ; ses autres
points (cœur par chemins, seuils facultatifs, validation stricte, mutation en fin de phase, barre
hors d'atteinte des agents) restent valables.

## Contexte

Un projet décrit aujourd'hui sa chaîne dans **deux fichiers** : `.agent-studio/stack.yaml` dit
**comment** lancer les outils (tests, lint, mutation, disposition), `.agent-studio/quality.yaml` dit
**ce qui est exigé** (cœur, couverture, mutation, dépendances) — ADR 0049. Il faut savoir qu'une
commande de mutation va dans l'un et son seuil dans l'autre ; une porte de format ajouterait la même
séparation. Le serveur MCP ne reçoit que la pile (argument `pile`), sans barre. skraft-plugin v2 a
réuni sa configuration dans un seul `skraft-config.json` (`docs/16`).

Les deux parties n'ont pas le même niveau de risque : les **commandes sont exécutées** (liste des
programmes autorisés par l'administrateur, écriture confirmée par l'utilisateur, D47) ; les seuils ne
lancent rien.

## Décision

1. **Un fichier, `.agent-studio/projet.yaml`, deux sections** :

   ```yaml
   pile:      # l'ancien stack.yaml, même schéma : comment lancer les outils
     id: dotnet
     detect: [Tarification.sln]
     tests: { command: [dotnet, test, …], report: junit-xml }
     format: { command: [dotnet, format, --verify-no-changes] }
     layout: { … }
   qualite:   # l'ancien quality.yaml, même schéma : ce qui est exigé
     coeur: { domaine: […], application: […] }
     couverture: { domaine: 100, application: 90, reste: 70 }
     mutation: { active: true, moment: fin-de-phase }
   ```

   Toute autre clé de premier niveau est refusée.
2. **Chaque section garde ses règles** : `pile` est validée par le schéma du profil de pile et la
   liste des programmes autorisés ; `qualite` par le schéma de la barre (validation stricte, ADR 0049
   point 5). Une section peut manquer : sans `pile`, la détection s'applique ; sans `qualite`, les
   valeurs par défaut.
3. **Transition** : sans `projet.yaml`, `stack.yaml` et `quality.yaml` (puis `.skraft/quality.json`)
   sont relus, avec un avertissement qui dit de les regrouper. Si `projet.yaml` existe, les anciens
   fichiers sont ignorés, et c'est dit s'ils sont encore là.
4. **Écriture** : `/stack init` écrit la section `pile` de `projet.yaml` en conservant le reste du
   fichier, toujours après confirmation de l'utilisateur.
5. **Hors d'atteinte des agents** : `projet.yaml` rejoint `GELÉS` (extension et workflow) ;
   `.agent-studio/` n'est dans le périmètre d'écriture d'aucun rôle.
6. **Porte de format** : commande facultative `format` dans `pile` (programme autorisé comme les
   autres), exécutée en fin de scénario à côté du lint ; un échec devient une correction ciblée
   adressée au développeur. Sans commande, elle n'est pas mesurée, et c'est noté.

## Conséquences

- Un seul endroit pour décrire un projet ; les anciens fichiers continuent de marcher pendant la
  transition (dont `exemple-dotnet-tdd` à `a7cf6db`).
- Les messages d'erreur nomment la section (`projet.yaml`, section `pile` ou `qualite`) et la clé.
- Serveur MCP : l'argument `pile` garde le format de la section `pile`. Une barre fournie par le
  client n'est pas reprise ici : le workflow lit la barre dans le dépôt.
- Touche `stack-adapters` (lecture), `project-services` (pile), l'extension et le workflow (barre,
  `GELÉS`, porte de format), la commande `/stack` ; tests des deux côtés.
