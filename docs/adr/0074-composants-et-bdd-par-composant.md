# ADR 0074 — Les composants d'un projet, et le BDD décidé par composant

## Statut

**Proposé** le 2026-11-07, à valider par le responsable du projet avant toute implémentation.
Concerne `stack-adapters`, `project-services` (`/stack init`, `/stack doctor`), l'extension `skraft`
et le workflow `workflows/skraft/` (donc aussi le serveur MCP). Complète l'ADR 0071 (fichier de
projet) et l'ADR 0072 (profils de pile).

## Contexte

**Une seule pile par projet.** `projet.yaml` n'a qu'une section `pile` ; sans elle,
`selectStackAdapter` prend le premier adaptateur qui reconnaît le dépôt. Dans un dépôt qui mélange
les technologies (une API .NET et un front React, par exemple), les portes ne lancent que les
tests, le lint et la mutation d'une des deux piles, avec les emplacements de cette seule pile :
l'autre partie du code n'est pas jugée, alors que les agents peuvent la modifier.

**Le Gherkin n'est jamais exécuté.** DISTILL écrit les scénarios dans `.skraft/<slug>/distill/features/`,
comme spécification, puis des tests d'acceptance ordinaires (xUnit, Vitest), où chaque valeur du
critère est recopiée. Un projet qui fait du BDD — ses `.feature` sont des tests, liés par des
définitions d'étapes (Reqnroll, Cucumber…) — ne peut pas le dire. C'est le cas de la version
d'`exemple-dotnet-tdd` convertie à skraft-plugin v2 (Reqnroll, `Features/`, `Steps/`).

**skraft-plugin v2** (branche `integration/v2-next`, lue le 07/11 ; idée reprise, rien de copié : la v2
n'est pas couverte par l'autorisation) découpe le projet en **composants** (nom, racine, pile,
emplacements, commandes), lance les portes **par composant touché**, et décide le BDD **par
composant** : `bdd: false`, ou une liste de couples `{ runner, features, steps }`, ou des `.feature`
sans exécution ; non décidé, tout run est refusé. `skraft init` détecte le lanceur dans les
manifestes des sous-projets et le couple de dossiers ; `/skraft-init` le fait confirmer.

**Notre détection existe déjà** (`/stack init`, `proposeProfile`, `/stack doctor`), mais elle ne lit
que la racine (fichiers de premier niveau, `package.json`), ne propose que TypeScript et Python, et
ne cherche aucun dossier.

## Décision proposée

### 1. Les composants

1. `projet.yaml` accepte une section **`composants`**, liste de `{ nom, racine, pile }` ; `pile` a le
   schéma d'aujourd'hui (ADR 0071, 0072). La section `pile` seule reste valable : c'est un projet
   à un composant, de racine `.`. Les deux ensemble sont refusés.
2. Les chemins d'un composant (emplacements, `{fichiers}`, couverture, analyse des imports) sont
   **relatifs à sa racine** ; ses commandes s'exécutent dans sa racine. Deux composants dont les
   racines se chevauchent sont refusés.
3. **Un adaptateur composé** présente les composants derrière le même port `StackAdapter` : les
   portes de l'extension et du workflow n'en savent rien.
   - `runTests` : la suite de chaque composant ; identifiants préfixés par la racine (`web: …`)
     pour qu'ils ne se confondent pas ; rapports et couverture réunis.
   - `layout` : réunion des emplacements, ramenés à la racine du projet.
   - `lint`, `format`, `mutation`, `architecture` : chaque composant reçoit les seuls fichiers qui
     sont sous sa racine ; un composant sans l'outil le dit pour ses fichiers (non mesuré).
4. **Seuls les composants touchés** par le pas ou la phase sont lancés aux portes de pas et de
   scénario ; la porte de fin de DELIVER et la référence de début de DELIVER lancent tous les
   composants (rien ne doit casser ailleurs).
5. **`/stack init`** détecte chaque sous-projet (un manifeste par dossier, à profondeur bornée,
   dossiers cachés et de dépendances exclus), propose un composant par sous-projet reconnu, et
   écrit `composants` après confirmation, comme il écrit `pile` aujourd'hui. `/stack doctor`
   diagnostique chaque composant.
6. Le serveur MCP accepte, dans son argument `pile`, l'un ou l'autre format.

### 2. Le BDD, décidé par composant

**Principe, décidé par le responsable le 07/11 : le TDD toujours, le BDD au choix.** DELIVER mène
toujours sa boucle TDD (test unitaire rouge, puis code) ; le BDD ne change que la forme des tests
d'acceptance, et seulement pour un composant qui le choisit.

1. La `pile` d'un composant accepte **`bdd`** :
   - `false` ou absent : comme aujourd'hui (Gherkin en spécification dans `.skraft/`, tests
     d'acceptance ordinaires). **Absent ne bloque pas** les projets existants, contrairement à la v2 ;
   - une liste de couples `{ lanceur, features, etapes }` : les `.feature` du projet **sont** les
     tests d'acceptance, liés par les définitions d'étapes du dossier `etapes`.
2. **DISTILL** en BDD : l'agent d'acceptance écrit le `.feature` dans le dossier `features` du
   composant (plus dans `.skraft/`), et les définitions d'étapes avec les signatures minimales pour
   compiler, rouges pour la bonne raison — le même contrat qu'un test d'acceptance aujourd'hui.
   Les valeurs du critère y sont recopiées à l'identique (porte inchangée). Un skill par lanceur.
3. **Le gel** de fin de DISTILL couvre les `.feature` de la story **et** les définitions d'étapes
   qu'elle a écrites ; DELIVER ne les modifie pas (gel absolu, décision du 07/11).
4. **Relier un scénario à son test exécuté** : chaque scénario porte déjà le tag `@ac-<n>` ; la
   porte retrouve le résultat du scénario par ce lien. Comment le lanceur nomme le test généré
   (titre du scénario, nom de la fonctionnalité) est **à vérifier sur la version installée** de
   chaque lanceur avant d'écrire la porte (SPEC §16) ; Reqnroll d'abord, le cas
   d'`exemple-dotnet-tdd`.
5. **Détection** par `/stack init` : un lanceur nommé dans un manifeste du composant (Reqnroll,
   SpecFlow, jest-cucumber, Cucumber-JVM, Cucumber-JS, pytest-bdd, behave), un dossier contenant
   des `.feature`, un dossier d'étapes (`steps`, `stepdefinitions`, `step_definitions`, `bindings`,
   `glue`). Un couple complet est proposé à confirmer ; une moitié seulement, on demande l'autre,
   sans la deviner ; rien, on demande si le composant fait du BDD (`false` sinon).
6. DELIVER garde sa boucle TDD à l'intérieur : un test unitaire rouge, puis le code, jusqu'à ce que
   le scénario du composant passe.

## Ordre de mise en œuvre

1. Composants : schéma, adaptateur composé, portes par composant touché ; tests sur un dépôt mixte
   simulé, puis réel.
2. `/stack init` et `/stack doctor` par composant.
3. BDD : schéma, détection, DISTILL (agent, skill Reqnroll), gel, lien scénario-test ; tests de
   bout en bout dans les deux implémentations, puis un run réel sur la version BDD
   d'`exemple-dotnet-tdd`.

## Conséquences

- Un dépôt mixte est jugé entièrement ; un projet à une pile ne change rien.
- Les identifiants de tests d'un dépôt à plusieurs composants changent (préfixe) : les preuves et
  les références enregistrées avant ne s'y comparent plus.
- Le BDD reste un choix du projet, jamais imposé, et décidé une fois, à l'initialisation.
- Tranché le 07/11 : un composant dont `bdd` n'est pas déclaré n'est **pas** en BDD, et son run n'est
  pas refusé (le BDD est un choix, le TDD la règle).
- Reste à trancher à la validation : la profondeur de détection des sous-projets (proposé : 4
  niveaux sous la racine, comme la v2).
