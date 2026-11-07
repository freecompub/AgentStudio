# Profils de stack (J5)

Un profil décrit la chaîne d'un projet — commandes, emplacements, format de rapport — pour que
l'application n'ait pas besoin d'un adaptateur écrit en TypeScript pour ce langage.

## S'en servir

Copier l'exemple qui convient dans `.agent-studio/projet.yaml`, à la racine du projet, puis
l'ajuster (ADR 0071). Le fichier a deux sections, validées chacune selon ses règles :

- `pile` — **comment** lancer les outils : tests, lint, format, mutation, emplacements, canaris.
  Elle est lue à l'ouverture et **l'emporte sur la détection automatique** ; refusée, la raison
  est expliquée dans la conversation et la détection reprend la main. `/stack init` l'écrit pour
  vous, après confirmation, sans toucher au reste du fichier.
- `qualite` — **ce qui est exigé** : chemins du cœur, seuils de couverture et de mutation, règles
  de dépendance. Elle ne lance rien. Sans elle, les valeurs par défaut s'appliquent.

Toute autre clé de premier niveau est refusée. Les anciens `.agent-studio/stack.yaml` et
`.agent-studio/quality.yaml` sont encore lus, avec un avertissement, tant que `projet.yaml`
n'existe pas ; ensuite ils sont ignorés.

La commande `format` est facultative : elle **vérifie** la mise en forme sans rien modifier
(`prettier --check`, `dotnet format --verify-no-changes`), en fin de scénario à côté du lint. Seul
son code de sortie compte ; un écart revient au développeur. Sans elle, la porte note que le
format n'est pas mesuré.

Les programmes nommés doivent figurer dans la liste autorisée par l'administrateur (`admin.json`,
D47/O12). La liste par défaut couvre les lanceurs de tests, linters et outils de mutation
courants ; ni interpréteur, ni client réseau.

## La détection

`detect` dit à quoi l'on reconnaît la pile. Un élément est un nom de fichier, qui doit exister, ou
un fichier qui doit contenir une sous-chaîne (ADR 0072) :

```yaml
detect:
  - { fichier: package.json, contient: '"vitest"' }
  - pyproject.toml
```

Un élément qui correspond suffit. La sous-chaîne n'est pas une expression régulière, et le chemin
est relatif à la racine, sans `..`.

## Les rapports de tests

`tests.report` nomme le lecteur : `junit-xml`, `vitest-json` ou `tap` (ADR 0072). Un rapport TAP
est lu dans `{rapport}` si la commande le nomme, sinon sur la sortie standard (`prove`, `bats`).

```yaml
tests:
  command: [node, --test, --test-reporter=tap, "--test-reporter-destination={rapport}"]
  report: tap
```

Deux pièges vus avec `node --test` (Node 22) : il ne prend pas un dossier en argument (sans chemin,
il trouve lui-même les fichiers `*.test.*`) ; et il ne donne le fichier d'un test qu'en cas
d'échec — un test réussi prend celui de son bloc parent, s'il le donne. `node` est un
interpréteur : il ne figure pas dans la liste des programmes autorisés par défaut, l'administrateur
doit l'y ajouter.

## L'analyse des imports

La section facultative `architecture` (ADR 0072) rend vérifiables les règles de dépendance (« le
domaine n'importe pas l'infrastructure ») : celles de la section `qualite`, ou à défaut celle que
la pile déduit de `infrastructureModules`.

```yaml
architecture:
  fichiers: ["src/**/*.cs"]
  import: '^\s*using\s+(?<module>[\w.]+)\s*;'
  modules:
    Domain: ["src/Tarification.Domaine/**"]
```

- le motif s'applique **ligne à ligne** ; son groupe `module` est ce qui est importé. Il vient du
  dépôt : mêmes gardes que `buildErrors` (300 caractères, pas de quantificateur imbriqué) ;
- un import relatif (`../infrastructure/db.js`) est résolu depuis le fichier ;
- une règle vise un module par son nom, ou un dossier par son chemin (`src/domain`) ;
- un import est interdit s'il est égal à l'interdit, commence par lui suivi de `.`, `/` ou `:`, ou
  si l'un de ses segments lui est égal ; jamais par simple sous-chaîne ;
- les dossiers cachés et de dépendances (`node_modules`, `bin`, `obj`, `target`, `dist`, `vendor`)
  ne sont pas lus, ni un fichier de plus de 1 Mo. L'analyse est textuelle : un import en
  commentaire compte.

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
  pattern: '^(?<file>[^\s(]+\.cs)\(\d+,\d+\): error (?<message>.*)$'
  missingSymbol: ["CS0103", "CS0246"]
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

- **La classification des échecs est générique.** Le lecteur `junit-xml` déduit la raison d'un
  rouge — assertion, symbole manquant, autre — de motifs communs à plusieurs langages. Les
  adaptateurs écrits à la main connaissent leur outil et sont plus précis.

Autrement dit, le profil ci-contre **ne remplace pas encore** l'adaptateur
TypeScript : il montre ce qu'un projet tiers peut déclarer aujourd'hui.
