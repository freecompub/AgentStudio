# ADR 0072 — Profils de pile : détection au contenu, analyse des imports, lecteur TAP

## Statut

**Proposé** le 2026-11-07, branche `feat/profils-pile`, à confirmer par le responsable du projet.
Le responsable a demandé de combler les trois manques des profils (critères
`j5-profil-detection-par-contenu`, `j5-profil-architecture`, `j5-lecteur-tap`) ; la forme des
sections ci-dessous est un choix de mise en œuvre.

## Contexte

Un profil de pile (section `pile` de `.agent-studio/projet.yaml`, ADR 0071) décrit la chaîne d'un
projet sans adaptateur écrit à la main. Il fait moins qu'un adaptateur sur trois points :

1. la détection ne regarde que l'**existence** d'un fichier (l'adaptateur TypeScript vérifie que
   `vitest` figure dans `package.json`) ;
2. il n'a pas d'**analyse des imports** : la règle de dépendance (« le domaine n'importe pas
   l'infrastructure ») n'est jamais vérifiée, et la porte le dit ; depuis le retrait de Swift
   (ADR 0061), aucune pile ne la fournit ;
3. il ne lit, pour les tests, que JUnit XML et le JSON de Vitest ; **TAP**, que produisent
   `node --test` et beaucoup d'autres lanceurs, n'est pas lu.

Le profil vient du dépôt, que l'agent peut modifier : son contenu est non fiable (motifs,
chemins), comme pour `buildErrors`.

## Décision

1. **Détection au contenu.** Un élément de `detect` est un nom de fichier (il existe) ou
   `{ fichier, contient }` : le fichier existe et contient cette **sous-chaîne** (pas une expression
   régulière). Un élément qui correspond suffit, comme aujourd'hui. Le chemin est relatif, sans `..`.
   Fichier lu au plus 1 Mo.

   ```yaml
   detect:
     - { fichier: package.json, contient: '"vitest"' }
   ```
2. **Analyse des imports**, section facultative `architecture` :

   ```yaml
   architecture:
     fichiers: ["src/**/*.cs"]
     import: '^\s*using\s+(?<module>[\w.]+)\s*;'
     modules:
       Domain: ["src/Tarification.Domaine/**"]
       Application: ["src/Tarification.Application/**"]
   ```

   - chaque fichier de `fichiers` appartient au premier module dont un motif lui correspond (sinon
     il n'est rangé dans aucun module, et n'est pas jugé) ;
   - `import` est appliqué **ligne à ligne** ; le groupe nommé `module` donne ce qui est importé.
     Mêmes gardes que `buildErrors` : motif de 300 caractères au plus, quantificateur imbriqué
     refusé, lignes et longueur bornées ; fichiers de 1 Mo au plus ;
   - une règle (`module`, `interdits`) vise un module par son **nom**, ou par un **chemin** (`src/domain`
     vise les fichiers sous ce dossier) ;
   - un import est interdit s'il est égal à l'interdit, s'il commence par lui suivi de `.`, `/` ou
     `:`, ou si l'un de ses segments lui est égal (`Tarification.Infrastructure.Db` enfreint
     `Infrastructure`) ;
   - limite assumée : l'analyse est textuelle ; un import en commentaire compte.
3. **Lecteur TAP** (`report: tap`, section `tests`) : versions 13 et 14, sous-tests indentés.
   - `ok` réussi, `not ok` en échec, `# SKIP` ignoré, `# TODO` ignoré (un échec attendu n'est pas
     un rouge) ; `Bail out!` : un échec pour la suite ;
   - identifiant : les titres du test et de ses parents, joints par ` > ` ;
   - fichier : le champ `location` (ou `file`) du bloc YAML de diagnostic s'il existe, rendu
     relatif à la racine ; `node --test` ne le donne qu'aux échecs : un test sans fichier prend
     celui du bloc parent qui le donne, sinon il reste vide — le classement acceptance / unitaire
     passe alors par l'identifiant seul ;
   - message : `message`, sinon `error`, du bloc YAML ; classé comme pour JUnit (assertion, symbole
     manquant, autre) ;
   - le rapport est lu dans `{rapport}` si la commande le nomme (`node --test
     --test-reporter-destination={rapport}`), sinon sur la **sortie standard** : `prove` et `bats`
     n'écrivent qu'à cet endroit.

## Conséquences

- Un profil peut désormais faire tout ce que fait l'adaptateur TypeScript écrit à la main, sauf
  la classification fine des échecs propre à chaque outil.
- La porte de règle de dépendance redevient disponible pour tout projet qui déclare
  `architecture`.
- `profiles/typescript.yaml` passe à la détection au contenu.
