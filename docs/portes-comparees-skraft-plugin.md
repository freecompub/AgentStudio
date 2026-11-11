# Nos portes face à celles de skraft-plugin

Comparaison des contrôles exercés par agent-studio et par skraft-plugin `v1.6.1`, phase par phase,
puis déroulé d'une même story dans les deux systèmes.

Les portes des deux côtés ont été relevées dans le code et les fichiers, pas de mémoire : les
leurs dans `skills/*/references/gate-definitions.md` et `quality-gates-evidence-contract`, les
nôtres dans `extensions/skraft/src/{research,design,distill,deliver}.ts` et
`deliver-effects.ts`.

## La différence qui explique toutes les autres

**Chez eux, une porte est une consigne lue par un agent.** Le reviewer charge ses critères, lit les
artefacts, et rend un verdict. Rien ne l'oblige à ouvrir les fichiers qu'il cite.

**Chez nous, une porte est du code qui s'exécute.** Elle lit le dépôt, lance les tests, compare des
empreintes, et rend des *motifs* de refus. Les lentilles LLM viennent ensuite, et reçoivent
consigne de **ne pas revérifier les faits** que le code a établis.

D'où deux familles d'écarts, qu'il ne faut pas confondre :

- ce qu'ils contrôlent et que **nous ne contrôlons pas du tout** ;
- ce qu'ils contrôlent par lecture et que **nous contrôlons par exécution** — ou l'inverse.

Un troisième cas existe, et il est à notre avantage : ce que nous mesurons et qu'ils demandent
seulement à un agent d'affirmer.

## Phase par phase

### RESEARCH — nous contrôlons, eux pas

Leur configuration donne `reviewer: null` pour cette phase : **aucune porte, aucun relecteur**. Le
document de recherche part tel quel vers la conception.

Nous avons une porte `citations`, exécutée par le code :

| Contrôle | Comment |
| --- | --- |
| Sections du gabarit présentes | Comparaison des titres |
| Chaque chemin cité existe dans le dépôt | Liste réelle des fichiers |
| Chaque plage de lignes tient dans le fichier | Comptage des lignes du fichier cité |
| Plages non inversées, URL bien formées | Analyse syntaxique |
| Une seule recommandation | Comptage des items de la section |

**Écart : à notre avantage.** La citation inventée est le mensonge le plus courant d'un agent
chercheur ; c'est aussi celui qu'une machine attrape le mieux.

**Ce que nous ne faisons pas non plus :** juger la *pertinence* de la recherche. Un document dont
toutes les citations sont exactes mais qui a exploré les mauvaises pistes passe sans réserve.

### DESIGN — seize critères chez eux, huit contrôles chez nous

Leurs seize portes (`architecture-review-criteria`) :

| | Critère | Chez nous |
| --- | --- | --- |
| G1 | Tout engagement structurel a un ADR `Accepted` traçable | ⚠️ partiel — nous vérifions la forme et la numérotation des ADR, pas qu'ils couvrent chaque engagement |
| G2 | Aucun ADR n'en contredit un autre ; remplacement inscrit des deux côtés | ✅ **par le code**, dans les deux sens |
| G3 | Domaine et Application ne dépendent pas d'Infrastructure ni d'API | ✅ mais **en DELIVER**, par analyse réelle des imports |
| G4 | Les interfaces applicatives sont définies dans la couche Application | ❌ |
| G5 | Chaque agrégat porte ses propres invariants | ❌ |
| G6 | La carte de contexte déclare chaque relation avec un patron explicite | ❌ |
| G7 | Chaque story correspond à au moins un déclencheur du modèle d'événements | ❌ |
| G8 | Chaque commande produit au moins un événement | ❌ |
| G9 | Aucun agrégat / contexte / Event Sourcing / Saga sans justification de story | ❌ |
| G10 | Matrice de cohérence présente et `PASS` | ⚠️ le document est exigé, son contenu n'est pas vérifié |
| G11 | Un patron coûteux cite une force admissible et une alternative « sans le patron » | ⚠️ consigne de rôle, non vérifiée |
| G12 | Chaque remplacement planifié est réalisé des deux côtés | ✅ **par le code** |
| G13 | Chaque blocage a sa résolution écrite | ✅ autrement — `report_blocker` et décision humaine persistée |
| G14 | Le verdict n'est pas dans le nom de fichier de l'ADR | ❌ |
| G15 | Aucun ADR ne ratifie une contrainte déjà imposée par le projet | ❌ |
| G16 | Des composants comparables partagent la même convention | ❌ |

Et ce que **nous** contrôlons et qu'ils n'ont pas :

- **ADR en ajout seul.** Modifier un ADR existant est refusé : *« les ADR sont append-only ; en
  rédiger un nouveau qui le remplace »*. Chez eux, rien n'empêche de réécrire l'histoire.
- **Numérotation sans trou ni doublon**, calculée par le code (ADR 0079). Les ADR du projet comptent
  quel que soit leur format, sans être jugés ; un motif dit quel fichier tient le numéro, et lequel
  prendre.
- **Identifiants croisés.** Un nom cité dans `contracts.md` ou `diagrams.md` doit exister dans
  `event-model.md` ou `domain-model.md`. C'est leur G7/G8 pris par l'autre bout : au lieu de
  demander qu'un événement existe pour chaque commande, nous refusons qu'un document cite un nom
  qui n'a été défini nulle part.

**Bilan DESIGN : c'est là que l'écart est le plus large.** Neuf de leurs critères portent sur la
*qualité du modèle de domaine* — agrégats, contextes, commandes, événements — et nous n'en
vérifions aucun par le code.

**Mais** la branche `feat/skraft-agents-skills-md` change la donne : `architecture-review-criteria`
y est reprise telle quelle et donnée **à la demande** à la lentille d'architecture. Ces seize
critères redeviennent donc disponibles, sous leur forme d'origine — une lecture par un agent, avec
la faiblesse que cela implique, mais mieux que rien.

### DISTILL — même intention, contrôles différents

| | Leur critère | Chez nous |
| --- | --- | --- |
| G1 | Bijection critère ↔ scénario | ✅ **par le code** : chaque critère `n` doit avoir un scénario `@ac-n` |
| G2 | Cas limites issus des exemples du domaine | ❌ |
| G3 | Vocabulaire métier, aucun identifiant technique | ❌ (consigne de rôle) |
| G4 | Aucun détail d'implémentation dans les étapes | ❌ (consigne de rôle) |
| G5 | Étapes non ambiguës | ❌ |
| G6 | Le plan d'implémentation couvre tous les scénarios | ⚠️ le plan est exigé, sa couverture n'est pas vérifiée |
| G7 | La matrice de couverture désigne une frontière de cas d'usage valide | ❌ |
| G8 | Au moins un squelette traversant par flux | ❌ |
| G9 | Bijection scénarios `@visual` ↔ specs Playwright | ❌ — sans objet, pas de front |
| G10 | Composants comparables, convention cohérente | ❌ |
| G11 | Un cas d'usage neuf a un test au niveau Application | ❌ |

Et ce que nous contrôlons et **qu'ils n'ont pas du tout** :

- **Les valeurs littérales sont recopiées mot pour mot.** Chaque nombre avec son unité et chaque
  chaîne entre guillemets d'un critère doit se retrouver **dans le scénario** et **dans le test
  d'acceptance**. `10 U`, `12,5 U`, `« Dose plafonnée à 10 U »` : une valeur arrondie, traduite ou
  inventée fait échouer la porte, en nommant la valeur manquante.
- **Chaque test d'acceptance porte le marqueur `ac-n`** de son critère.
- **Les tests d'acceptance sont rouges pour la bonne raison.** Pas rouges « parce que ça ne
  compile pas » : la porte classe l'échec et refuse un rouge de mauvaise raison.
- **Gel des tests d'acceptance** à la sortie de la phase, par empreinte.

**Bilan DISTILL : leurs critères portent sur la *forme* des scénarios, les nôtres sur leur
*fidélité*.** Ce sont deux choses différentes, et aucune ne remplace l'autre.

### DELIVER — c'est ici que nous sommes le plus fort

Leur contrat de preuves (`quality-gates-evidence-contract`) :

| | Leur porte | Chez nous |
| --- | --- | --- |
| G1 | Les tests d'acceptance passent | ✅ **exécutée** |
| G2 | Tous les tests unitaires passent | ✅ **exécutée**, et un test ignoré est un refus |
| G3 | La compilation passe | ✅ implicite : sans rapport, la porte échoue |
| G4 | L'analyse statique passe | ✅ **exécutée** — linter du projet (ADR 0022) |
| G5 | Les règles d'architecture passent | ✅ **exécutée** — analyse réelle des imports |
| G6 | Le score de mutation atteint la barre | ✅ **exécutée**, par fichier source touché |
| G7 | Aucune doublure dans le cœur Domaine/Application | ❌ |
| G8 | Politique de commits conventionnels | ✅ autrement — **c'est le code qui commite** |
| G9 | Aucune altération de test (intégrité RED→GREEN) | ✅ **par les preuves**, pas par lecture |
| G10 | Rouge observé | ✅ **par les preuves horodatées** |
| G11 | La couverture de lignes atteint la barre | ❌ — la mutation est jugée plus sévère |

La différence de nature est ici la plus marquée. Leur G10 « RED observed » demande à l'agent de
**capturer une preuve** de son rouge et de la déposer ; un agent qui ne le fait pas obtient
`G10: fail`. Chez nous, l'exécution des tests passe par `run_tests`, qui **enregistre lui-même** la
preuve : l'agent n'a rien à déposer, et rien à oublier. `checkRedGreenSequence` relit ensuite les
preuves et exige, pour chaque test unitaire, un rouge **puis** un vert dans cet ordre.

Et surtout, ce que nous faisons et qu'ils ne font nulle part :

- **Les tests d'acceptance sont gelés depuis DISTILL**, vérifié par empreinte à chaque fin de
  scénario. Leur « Iron Rule » est une consigne de prompt ; chez nous, c'est une comparaison.
- **Une porte qui n'a rien mesuré ne produit aucun fait.** Pas de linter pour cette stack ? La
  porte émet une *note* — « Qualité de forme non mesurée » — et non un fait favorable. Un fichier
  que le linter a ignoré est nommé comme non examiné. Même chose pour la mutation et pour la règle
  de dépendance.

Ce dernier point est structurel. Chez eux, une porte non applicable se conclut `not_applicable` et
le reviewer poursuit ; chez nous, l'absence de mesure remonte jusqu'au bilan et jusqu'aux lentilles,
qui ont interdiction de la traiter comme un succès.

### La revue elle-même

| | Eux | Nous |
| --- | --- | --- |
| Questions | Quatre : complétude, adéquation métier, qualité, risque | **Identiques** (reprises) |
| Poids | 0,30 / 0,30 / 0,15 / 0,25 | **Identiques** |
| Note d'une question | La plus basse des lentilles qui y répondent | **Identique** |
| Question non couverte | Force `NEEDS_REWORK` | **Identique**, et bloquant |
| Qui synthétise | L'agent réviseur | **Le code** |
| Score total | Interdit | **Interdit** |

Le seul écart est le dernier rang, et il est décisif : chez eux un agent pondère et conclut ; chez
nous la synthèse est une fonction pure, rejouable à l'identique depuis le seul JSON des verdicts.

## Déroulé d'une même story

Prenons **US-2 du projet exemple** — « Remise par palier de quantité », cinq critères, une question
ouverte — et suivons-la des deux côtés.

### Critère 2 : « Palier « 10 articles ou plus : 5 % », ligne de 10 articles à 2,00 € : remise 1,00 € »

**Phase RESEARCH.** Chez eux, le chercheur produit son document et personne ne le contrôle. Chez
nous, s'il écrit *« voir `src/Tarification.Domaine/Remise.cs:12-40` »* alors que ce fichier n'existe
pas encore, la porte refuse : *« `src/Tarification.Domaine/Remise.cs:12-40` : fichier inexistant
dans le dépôt. »* Il doit corriger avant d'avancer.

**Phase DESIGN.** Chez eux, seize critères sont lus par un reviewer : il vérifie entre autres que
`RemiseParPalier` apparaît bien comme concept du modèle, que la commande a son événement, qu'aucun
patron coûteux n'est adopté sans justification. Chez nous, la porte vérifie que `event-model.md`
existe, que tout identifiant cité dans `contracts.md` est défini dans les documents de modèle, que
les ADR sont bien formés, numérotés sans trou, et non modifiés. **Si l'architecte oublie de définir
un événement pour la commande, leur G8 l'attrape ; notre porte non** — sauf si un autre document
cite un nom non défini.

Sur la branche, la lentille d'architecture peut charger `architecture-review-criteria` et appliquer
leurs seize critères en revue. C'est le rattrapage disponible.

**Phase DISTILL.** C'est ici que nous prenons l'avantage. L'agent écrit un scénario Gherkin et un
test d'acceptance. Supposons qu'il écrive « remise de 1 € » au lieu de « 1,00 € », ou pire, qu'il
arrondisse le palier à « 5 % » en « 5,0 % ».

- **Chez eux** : G3 et G4 regardent le vocabulaire et l'absence de détails techniques. La valeur
  n'est pas comparée au critère d'origine. Le reviewer *peut* le voir, rien ne l'y oblige.
- **Chez nous** : la porte `valeurs` extrait les littéraux du critère — `10`, `5 %`, `10`, `2,00 €`,
  `1,00 €` — et exige chacun **dans le scénario** et **dans le test**. Le refus nomme la valeur :
  *« La valeur « 1,00 € » du critère 2 n'apparaît pas dans le test d'acceptance du critère 2. »*

Puis la porte lance les tests et exige que le test d'acceptance soit **rouge pour la bonne raison**.
Sur .NET, `RemiseParPalier` n'existant pas encore, la compilation échoue : notre profil lit l'erreur
`CS0103`, la classe `missing_symbol`, et la porte accepte ce rouge. Si le test échouait sur une
erreur de syntaxe (`CS1002`), elle le refuserait.

À la sortie, l'empreinte des tests d'acceptance est gelée.

**Phase DELIVER.** L'agent écrit un test unitaire, puis le code.

- **Chez eux** : il doit lancer `dotnet test`, rediriger la sortie, déposer la preuve du rouge,
  puis écrire le code, relancer, committer avec `git commit -s`, remplir un journal de changements
  et assembler un `qg-{story}.json` conforme au schéma. Un oubli dans cette chaîne donne
  `G10: fail` ou un log `inconclusive`.
- **Chez nous** : il appelle `run_tests`. La preuve est enregistrée par le code, horodatée, attachée
  au scénario. Il n'écrit aucun commit — le code le fait. À la fin du scénario, la porte relit les
  preuves et exige un rouge **puis** un vert pour chaque test unitaire cité.

Supposons maintenant que l'agent, pour faire passer son test, **modifie le test d'acceptance**.

- **Chez eux** : G9 « No test modified to pass (Iron Rule) » est un critère que la lentille
  `test-integrity` doit détecter en lisant le diff.
- **Chez nous** : l'empreinte gelée ne correspond plus. La porte refuse avant toute lecture :
  *« Les tests d'acceptance ont été modifiés : ils sont gelés depuis DISTILL. »*

Enfin, la porte mesure la mutation, le lint et les règles de dépendance. Sur le projet .NET tel
qu'il est aujourd'hui, aucun outil de mutation ni linter n'est déclaré, et le profil ne sait pas
analyser les imports. Les trois émettent donc une **note** :

```
Mutation non mesurée : la stack du projet ne propose pas d'outil de mutation.
Qualité de forme non mesurée : le projet n'a pas de linter configuré pour cette stack.
Règle de dépendance non vérifiée : la stack du projet ne sait pas analyser les imports.
```

Ces notes remontent au bilan et aux lentilles. **Aucun fait favorable n'est produit** sur ces trois
points — c'est la différence entre « vérifié » et « non vérifié », que leur `not_applicable` tend à
effacer.

## Ce qu'il faut retenir

**Nous sommes plus forts là où un fait est mesurable** : exécution des tests, preuves du cycle
rouge-vert, gel des tests, fidélité des valeurs littérales, existence des citations, cohérence des
ADR. Ces contrôles ne dépendent pas de la bonne volonté d'un agent.

**Ils sont plus complets là où le jugement prime** : la qualité du modèle de domaine. Neuf de leurs
critères DESIGN n'ont aucun équivalent chez nous, et ce n'est pas un oubli — un agrégat mal placé ne
se détecte pas par une expression régulière. La branche `feat/skraft-agents-skills-md` rend ces
critères disponibles aux lentilles, ce qui est la bonne réponse : les confier au jugement, mais
sans prétendre que le code les a vérifiés.

**Trois manques chez nous méritent une décision**, et non un haussement d'épaules :

1. **Aucune doublure dans le domaine** (leur G7 DELIVER). Mesurable par expression régulière sur
   les tests du domaine ; nous ne le faisons pas.
2. **Couverture de lignes** (leur G11). Nous avons choisi la mutation, plus sévère — mais un projet
   sans outil de mutation n'a alors *aucune* mesure de couverture.

   **Et il y a pire, trouvé en écrivant ce document.** Le prompt de la lentille `quality-gates`
   affirme : *« Les faits — tests, **couverture**, mutation, lint — ont déjà été établis par le
   code, qui seul fait foi »* (`roles.ts:102`). Or **aucun fait de couverture n'est jamais
   produit** : `deliver-effects.ts` en émet pour les tests, la mutation, le lint et les
   dépendances, jamais pour la couverture. La lentille reçoit donc l'assurance qu'une catégorie de
   faits existe, avec consigne de ne pas les revérifier — alors qu'elle sera toujours vide.

   C'est le défaut que tout ce projet traque, remonté d'un cran : ce n'est plus une porte qui
   atteste sans mesurer, c'est un **prompt** qui affirme qu'une mesure a eu lieu. Le mot
   « couverture » doit disparaître de cette phrase, ou la mesure doit exister.
3. **Le plan d'implémentation couvre tous les scénarios** (leur G6 DISTILL). Le document est exigé,
   son contenu ne l'est pas : un plan vide passe.
