# ADR 0074 — Les composants d'un projet, et le BDD décidé par composant

## Statut

**Accepté** le 2026-11-07 par le responsable du projet (« Oui ça me convient »), avec la profondeur de
détection de 4 niveaux.
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

## Décision

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
   composants (rien ne doit casser ailleurs). **Reporté le 07/11 par le responsable**, après une
   mesure sur un vrai dépôt mixte : en attendant, chaque porte lance tous les composants, ce qui est
   toujours juste. Le faire demande, dans les deux implémentations, de fusionner la liste des tests
   verts au lieu de la remplacer (sinon une régression d'un composant non lancé n'est plus vue) et de
   lancer toujours le composant du test d'acceptance du scénario en cours.
5. **`/stack init`** détecte chaque sous-projet (un manifeste par dossier, jusqu'à 4 niveaux sous la racine,
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
2. **DISTILL** en BDD : le `.feature` que DISTILL écrit **va au projet**, tel quel, dans le dossier
   `features` du composant (plus dans `.skraft/`, décision du responsable le 08/11) ; l'agent
   d'acceptance écrit aussi les définitions d'étapes, avec les signatures minimales pour compiler,
   rouges pour la bonne raison — le même contrat qu'un test d'acceptance aujourd'hui. Les valeurs du
   critère y sont recopiées à l'identique (porte inchangée). **Un seul skill de méthode**,
   `bdd-step-definitions`, sans langage ni lanceur (révisé le 08/11, voir plus bas).
3. **Le gel** de fin de DISTILL couvre les `.feature` de la story **et** les définitions d'étapes
   qu'elle a écrites ; DELIVER ne les modifie pas (gel absolu, décision du 07/11). À chaque porte,
   le code vérifie que le `.feature` du projet est **exactement** celui que DISTILL a écrit, par son
   empreinte (décision du responsable le 08/11). Les dossiers `features` et `etapes` rejoignent les
   emplacements des tests d'acceptance, que le gel couvre déjà.
4. **Relier un scénario à son test exécuté** : le **titre de chaque scénario commence par son
   critère** (`Scénario: AC-1 Le client chiffre…`, décision du responsable le 08/11). DISTILL
   l'écrit ainsi, une porte le vérifie. Constat sur la version installée (Reqnroll 3.3.4, xUnit,
   JunitXml.TestLogger 4.1.0, 08/11) : le nom du test vient du titre (`AC-1 Le client…` →
   `AC_1LeClient…`, que `acOf` reconnaît déjà) ; le tag `@ac-1` devient un attribut xUnit dans le
   code généré, mais **l'enregistreur JUnit n'écrit aucun attribut** : le tag seul ne suffit pas.
   Le Gherkin du projet peut être en français (`# language: fr`), que notre lecteur comprend.
5. **Détection** par `/stack init` : un lanceur nommé dans un manifeste du composant (Reqnroll,
   SpecFlow, jest-cucumber, Cucumber-JVM, Cucumber-JS, pytest-bdd, behave), un dossier contenant
   des `.feature`, un dossier d'étapes (`steps`, `stepdefinitions`, `step_definitions`, `bindings`,
   `glue`). Un couple complet est proposé à confirmer ; une moitié seulement, on demande l'autre,
   sans la deviner ; rien, on demande si le composant fait du BDD (`false` sinon).
6. DELIVER garde sa boucle TDD à l'intérieur : un test unitaire rouge, puis le code, jusqu'à ce que
   le scénario du composant passe.

### 3. Révision du 08/11 : aucun savoir propre à un langage dans skraft

Décidé par le responsable le 08/11 (« notre travail n'est pas lié à un langage »). Le « skill par
lanceur » du point 2.2 est abandonné : il en faudrait un par lanceur, chacun lié à un langage et
tenu en double (extension, workflow). À la place :

1. **Un skill de méthode**, `bdd-step-definitions`, sur la couche des étapes, valable pour tout
   lanceur : étapes fines qui délèguent à des pilotes en langage métier, faux systèmes externes
   minimaux, builders à valeurs par défaut (le scénario ne porte que les valeurs du critère),
   diagnostics qui nomment la valeur métier, attente d'un effet observable plutôt qu'une pause.
   Idées tirées de Freeman et Pryce, *Growing Object-Oriented Software, Guided by Tests* (ch. 5,
   8, 10, 11, 21 à 23, 27), reformulées, rien de recopié ; exemples en Gherkin et pseudo-code.
2. **Ce qui est propre au lanceur** (syntaxe des liaisons, configuration) vient du projet : les
   conventions relevées par la recherche, et le lanceur et les dossiers déclarés dans le profil.
3. **Ce que le code décide passe par le profil**, comme aujourd'hui : le classement des échecs
   (`failureKind`) et ses canaris de `/stack doctor`. Un **canari BDD** prouve, pour chaque
   composant en BDD, qu'un scénario dont une étape n'a pas de définition — le faux rouge propre au
   BDD — ressort en mauvaise raison, jamais en assertion ni en test ignoré.
4. Pas de porte sur les pauses fixes dans les étapes : elle demanderait des motifs par langage. La
   règle reste dans le skill ; la lentille d'intégrité des tests la relève en revue.

### 4. Le Gherkin de la story, et celui des stories précédentes (08/11)

Constaté au run réel du 08/11 (US-2 sur la version BDD d'`exemple-dotnet-tdd`, où l'US-1 est déjà
en BDD) : le dossier `features` contient les scénarios de **toutes** les stories. La porte des titres
`AC-n` jugeait ceux de l'US-1, et l'agent les a renommés pour la passer ; DELIVER pouvait recevoir le
scénario de l'US-1 qui porte le même critère.

1. Le code relève les `.feature` au **début de DISTILL** (le point de départ de la phase, que
   retrouve aussi une relance). Les scénarios de la story sont ceux qui n'y figuraient pas ; les
   portes `gherkin`, titres et valeurs ne jugent qu'eux, et DELIVER ne reçoit qu'eux.
2. **Un scénario existant modifié ou supprimé, ou l'en-tête d'un fichier existant modifié, est
   refusé** (décision du responsable le 08/11) : il appartient à une story précédente. Le motif dit
   de poser la question si la story change ce comportement. Lignes vides et espaces de fin ne
   comptent pas.
3. Hors BDD, rien ne change : le Gherkin vit dans `.skraft/<slug>/`, vide au début de DISTILL.
4. Les **tests** d'une story précédente portent aussi des marqueurs `ac-n` : la porte du rouge
   d'acceptance les prenait pour des critères de la story (« passe déjà »), et DELIVER en faisait des
   scénarios (`ac-1#2`). Le code garde le relevé de la suite d'INIT (RESEARCH et DESIGN n'écrivent
   aucun test : c'est encore la suite au début de DISTILL, sans exécution de plus). Un test
   d'acceptance de la story est marqué `ac-n` **et** absent de ce relevé ; un test existant qui
   passait et échoue à la porte est refusé (DISTILL ne casse rien) ; DELIVER ne fait de scénarios
   que des tests de la story. Vaut aussi hors BDD.

### 5. La détection, mise en œuvre (08/11)

1. `detecterBdd` (`stack-adapters`, pure) : le **lanceur** est cherché, comme un nom entier, dans le
   texte des manifestes du composant (`package.json`, `pyproject.toml`, `setup.cfg`,
   `requirements*.txt`, `*.csproj`, `pom.xml`, `build.gradle*`) d'après une table de marques par
   lanceur (`Reqnroll`, `SpecFlow`, `@cucumber/cucumber`, `jest-cucumber`, `io.cucumber`,
   `pytest-bdd`, `behave`) ; deux lanceurs cités, aucun n'est retenu. Le dossier des `.feature` est
   leur parent commun ; le dossier des étapes, l'unique dossier au nom usuel. Dépendances et dossiers
   cachés écartés.
2. `/stack init` ajoute la section `bdd` au profil proposé pour un couple complet (confirmée avec
   lui) ; pour une moitié, **un commentaire** dit ce qui est trouvé et ce qui manque — la
   confirmation n'admet qu'un oui ou un non, la moitié manquante n'est pas demandée ; rien, pas de
   section.
3. `/stack doctor` vérifie, pour chaque couple déclaré, des `.feature` dans `features`, un dossier
   `etapes` présent, et le lanceur cité par un manifeste (avertissements).
4. Limite : `/stack init` ne propose de profil que pour TypeScript et Python ; un projet .NET ou Java
   n'a donc pas encore de proposition, BDD compris. Vérifié sur le `main` BDD d'`exemple-dotnet-tdd` :
   la détection rend `reqnroll`, `tests/Tarification.UnitTests/Features`, `…/Steps`.

### 6. Révision du 08/11 : un BDD muet ne démarre pas

Décidée par le responsable le 08/11 : une détection partielle écrivait le profil **sans** `bdd`, et
`bdd` absent valait « pas de BDD ». Un projet BDD démarrait alors dans le mauvais mode, sans que personne
le sache ; une pile donnée au serveur MCP sans `bdd` avait le même effet.

1. **`bdd: false` est un choix déclaré, `bdd` absent n'est rien décidé.** Le profil garde la
   différence (`false` devient une liste vide) ; le port expose `bddNonDecide`, les racines des
   composants dont la pile ne dit rien (l'adaptateur TypeScript intégré, sans profil, n'en décide pas).
2. **Au démarrage de skraft** (INIT, extension et workflow, donc aussi le serveur MCP), le code cherche
   sous ces racines les signes du BDD : un lanceur cité par un manifeste, des `.feature` (un dossier
   d'étapes seul n'en est pas un). S'il en trouve, le run **ne démarre pas**, avant tout appel d'agent :
   le motif dit ce qui est vu et de déclarer `bdd`, ou `bdd: false` (`bddNonDeclare`, une seule copie,
   dans `stack-adapters`).
3. Un projet sans signe de BDD n'est pas concerné : la décision du 07/11 (« absent ne bloque pas ») tient
   pour lui.
4. **`/stack init` demande la moitié manquante** au lieu de l'écrire en commentaire (le §5.2 est
   révisé) : rien n'est écrit, la commande dit ce qui est trouvé, ce qui manque, et la relance qui le
   donne — `/stack init --lanceur <nom>`, `--features <dossier>`, `--etapes <dossier>` (combinables),
   ou `--sans-bdd`, qui écrit `bdd: false`. Le code vérifie ce qui est donné (lanceur connu, dossier
   qui contient un fichier du projet). Les arguments de la commande servent de réponse libre : la
   confirmation n'admet qu'un oui ou un non. Dans un dépôt à composants, une moitié dans l'un d'eux
   arrête aussi l'écriture, et le message dit de compléter la pile du composant à la main.

## Ordre de mise en œuvre

1. Composants : schéma, adaptateur composé ; tests sur un dépôt mixte simulé, puis réel. **Fait le
   07/11** (branche `feat/composants`), sans les composants touchés (reportés, point 4).
2. `/stack init` et `/stack doctor` par composant. **Fait le 07/11.**
3. BDD : schéma, DISTILL et DELIVER, gel, lien scénario-test, tests de bout en bout dans les deux
   implémentations (**faits le 08/11**) ; puis canari BDD, skill de méthode, détection, et un run
   réel sur un projet BDD (le premier : la version BDD d'`exemple-dotnet-tdd`).

## Conséquences

- Un dépôt mixte est jugé entièrement ; un projet à une pile ne change rien.
- Les identifiants de tests d'un dépôt à plusieurs composants changent (préfixe) : les preuves et
  les références enregistrées avant ne s'y comparent plus.
- Le BDD reste un choix du projet, jamais imposé, et décidé une fois, à l'initialisation.
- Tranché le 07/11 : un composant dont `bdd` n'est pas déclaré n'est **pas** en BDD, et son run n'est
  pas refusé (le BDD est un choix, le TDD la règle). **Révisé le 08/11** (§6) : sauf s'il montre des
  signes de BDD.
- Tranché le 07/11 : les sous-projets sont détectés jusqu'à 4 niveaux sous la racine.
