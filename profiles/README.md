# Profils de stack (J5)

Un profil décrit la chaîne d'un projet — commandes, emplacements, format de rapport — pour que
l'application n'ait pas besoin d'un adaptateur écrit en TypeScript pour ce langage.

## S'en servir

Copier le profil qui convient dans `.agent-studio/stack.yaml`, à la racine du projet, puis
l'ajuster. Il est lu à l'ouverture et **l'emporte sur la détection automatique**. S'il est refusé,
la raison est expliquée dans la conversation et la détection reprend la main.

Les programmes nommés doivent figurer dans la liste autorisée par l'administrateur (`admin.json`,
D47/O12). La liste par défaut couvre les lanceurs de tests, linters et outils de mutation
courants ; ni interpréteur, ni client réseau.

## Les canaris

La section `canaries` est ce qui rend un profil **vérifiable**. Ce sont des tests dont la bonne
réponse est connue d'avance : le code les écrit un par un dans une copie isolée du projet, lance
la commande de test déclarée, et contrôle que l'échec obtenu porte le classement attendu. Aucun
LLM n'est consulté — l'oracle est dans le code.

`{marque}` est remplacée par un identifiant unique, dans le nom du fichier comme dans son
contenu. C'est elle qui permet de retrouver les résultats du canari parmi ceux du projet ; le
schéma l'exige, sauf pour le canari `syntax`, qui ne produit souvent aucun résultat.

Quatre genres, et la gravité d'un écart dépend d'une seule question : *la porte peut-elle encore
juger ?* Les portes RED tiennent `assertion` et `missing_symbol` pour des rouges légitimes, et
rejettent `other_error`.

| Genre | Ce qu'on attend | Si c'est autre chose |
| --- | --- | --- |
| `passed` | le test passe | problème : la commande ou son rapport est en cause |
| `assertion` | classé `assertion` | `missing_symbol` : avertissement — `other_error` : problème |
| `missing_symbol` | classé `missing_symbol` | `assertion` : avertissement — `other_error` : problème |
| `syntax` | **jamais** `assertion` ni `missing_symbol` | problème : du code qui ne compile pas franchirait la porte RED |

Un canari par exécution : celui qui ne compile pas empêcherait les autres de s'exécuter.

## Les erreurs de compilation

Sur un langage compilé, un symbole absent **arrête la compilation** : la commande de test ne
produit alors aucun rapport, et c'est pourtant le rouge le plus courant du cycle TDD — « la
fonction que je viens d'appeler n'existe pas encore ». La section `buildErrors` dit comment lire
ces erreurs, sans quoi ce rouge légitime n'atteint jamais la porte.

```yaml
buildErrors:
  pattern: '^(?<file>[^\s:]+\.swift):\d+:\d+: error: (?<message>.*)$'
  missingSymbol: ["cannot find", "no such module"]
```

Le motif est appliqué **ligne à ligne**, et les groupes nommés `file` et `message` sont
obligatoires. `missingSymbol` liste des **sous-chaînes**, pas des expressions régulières : ce sont
les messages qui désignent le seul échec de compilation légitime. Tout le reste — syntaxe, types,
configuration — est classé `other_error` et rejeté par la porte RED. En cas de doute le classement
est `other_error` : refuser un rouge correct fait perdre un tour, l'accepter à tort laisse passer
du code qui ne compile pas.

Ce motif vient du dépôt du projet, donc d'une source non fiable. Il est refusé s'il porte un
quantificateur imbriqué (`(…+)+`, la forme qui fait exploser le moteur) ou s'il dépasse
300 caractères, et son application est bornée en nombre de lignes comme en longueur de ligne. Un
moteur d'expressions régulières ne s'interrompt pas : la seule protection est de ne jamais lui
donner de quoi s'emballer.

Un projet interprété n'a pas besoin de cette section : le lanceur produit un rapport même quand un
symbole manque.

## Ce qu'un profil ne sait pas encore exprimer

Ces limites sont réelles : un profil est aujourd'hui **moins capable** qu'un adaptateur écrit à la
main. Elles sont inscrites dans `features.json`.

- **La détection ne regarde que l'existence de fichiers**, jamais leur contenu. L'adaptateur
  TypeScript, lui, vérifie que `vitest` figure dans les dépendances du `package.json` ; le profil
  se rabat sur la présence d'un `vitest.config.ts`, ce qui est plus fragile.
- **L'analyse des imports n'a pas de section.** Avec un profil, `ctx.stack.architecture()` renvoie
  `null` : la règle de dépendance n'est pas vérifiée, et la porte de fin de scénario le dit au
  lieu d'inventer un résultat. L'adaptateur Swift sait le faire, un profil non.
- **La classification des échecs est générique.** Le lecteur `junit-xml` déduit la raison d'un
  rouge — assertion, symbole manquant, autre — de motifs communs à plusieurs langages. Les
  adaptateurs écrits à la main connaissent leur outil et sont plus précis.

Autrement dit, les deux profils ci-contre **ne remplacent pas encore** les adaptateurs Swift et
TypeScript : ils montrent ce qu'un projet tiers peut déclarer aujourd'hui.
