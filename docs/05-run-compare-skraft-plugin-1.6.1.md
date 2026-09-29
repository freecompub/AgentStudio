# Run comparé : skraft-plugin v1.6.1 sur US-2 — observations et pistes

Document d'observation, 2026-09-29. Ni un banc de performance, ni un verdict.

## Dispositif

| | agent-studio | skraft-plugin |
| --- | --- | --- |
| Version | branche `fix/plafond-duree-tour` | v1.6.1 (`6d092bd`) |
| Runtime | Copilot CLI | Claude Code 2.1.273, `--plugin-dir` |
| Modèles | un seul | Opus (orchestrateur), Sonnet (sous-agents), Haiku |
| Entrée | `stories/US-2.md` | la **même** |
| Dépôt | copie de `exemple-dotnet-tdd` | copie de `exemple-dotnet-tdd` |

**Ce qui n'est pas comparable, et qu'on ne comparera pas :**

- **Les coûts.** 37,81 $ chez Claude contre des requêtes premium chez Copilot : deux monnaies.
- **Les tokens.** Fournisseurs et façons de compter différentes.
- **Un run contre un run.** La variance d'un LLM est large ; et cinq de nos six runs du 29/09
  étaient occupés par nos propres défauts.
- **L'entrée.** Leur pipeline attend une story produite par leur `Backlog Planner`, dans leur
  format ; on lui a donné la nôtre.

**Ce qui est comparable :** les livrables, les durées de phase, les trajectoires de rejet, et les
choix de conception que le run rend visibles.

## Résultats bruts

```
RESEARCH   4,7 min   1 essai    APPROVED
DESIGN    26,8 min   2 essais   APPROVED
DISTILL   19,3 min   1 essai    APPROVED
DELIVER   ~80 min    2 essais   CHANGES_REQUESTED — non close
                                14 commits, 24 tests verts
total      2 h 11    37,81 $
```

Le processus s'est terminé en `success` mais **le pipeline n'est pas allé au bout** : la seconde
revue de DELIVER n'a pas rendu son verdict. Cause non établie — le plafond de 40 $ posé au
lancement était à 2,19 $ près, mais rien ne le confirme.

Nos durées, pour les phases qu'on a menées : RESEARCH 3 min, DESIGN 12,5 min. **Nous sommes plus
rapides là où nous passons** — nos portes constatent en quelques millisecondes ce que leurs
lentilles doivent relire. Mais aucun de nos six runs n'a dépassé DISTILL, et eux sont allés
jusqu'au code. C'est le fait le plus important de la journée.

## Convergences

1. **Les mêmes documents de conception sont exigés** — `contracts`, `event-model`, `diagrams`,
   `consistency-matrix`, `context-map`. Leur architecte en avait omis trois au premier essai ; leur
   revue les a réclamés. Ce n'est donc pas une différence de périmètre mais de moment.
2. **Les tests d'acceptance sont gelés** des deux côtés.
3. **Les deux pipelines ont recalé DESIGN à l'essai 1 et l'ont passé à l'essai 2.**
4. **Les rapports de revue sont versionnés par essai** (`design-review-1.md`, `-2.md`). Nous y
   sommes venus le matin même, par l'ADR 0040.

## Divergences de conception

### D1 — Qui tranche une question ouverte

La story porte : *« les paliers sont-ils les mêmes pour toutes les références, ou définis par
référence ? »*

- **Eux** : l'architecte tranche et documente — `adr-003-portee-des-paliers-de-remise.md`.
- **Nous** : le réducteur pose la question à l'humain et attend (`askQuestion`), et notre architecte
  a conclu « aucun ADR nécessaire ».

Aucun des deux n'a raison dans l'absolu. Mais c'est la divergence la plus structurante du run.

### D2 — Qui constate un manquement

| | agent-studio | skraft-plugin |
| --- | --- | --- |
| Mécanisme | porte de code | lentille LLM |
| Moment | avant toute revue | après la revue |
| Coût d'un constat | ≈ 0 | un tour de revue complet |
| Reproductible | oui | non garanti |
| Peut reconnaître une forme équivalente | non | oui |

Illustration chiffrée : passés dans **nos** portes, leurs livrables de DISTILL sont refusés
(2 valeurs du critère 3 non recopiées, 0 test portant `ac-<n>` dans son nom) alors que **leur**
lentille les a approuvés. Réserve importante : deux de leurs quatre lentilles jugeaient sans avoir
pu charger la skill `qa-reporting` qui leur sert de grille (voir A2).

### D3 — Qui produit les preuves

- **Nous** (D20) : `run_tests` est notre handler ; la preuve est enregistrée par le cœur, hors
  d'atteinte de l'agent.
- **Eux** : l'agent lance les commandes et dépose `qg-build.{exit,stdout,sha256}`,
  `qg-acceptance.trx`, `coverage.cobertura.xml`, puis les commite.

Leur jeu de preuves est **plus riche que le nôtre** (couverture, mutation, TRX, empreintes). Mais
un `qg-acceptance.exit` contenant `0` atteste ce que l'agent a bien voulu y écrire, et l'empreinte
SHA-256 est calculée par le même agent : elle détecte une altération *ultérieure*, pas une sortie
fabriquée à l'origine. Leur reviewer produit toutefois un `qg-verify-us-2.json` — une
revérification par un autre agent, qui atténue le problème sans le supprimer.

### D4 — Où vit l'état du pipeline

- **Eux** : `.copilot-tracking/skraft-plans/<slug>/state.json`, **commité dans le dépôt**, avec des
  sauvegardes horodatées, écrit par l'agent via leur CLI `state.mjs`.
- **Nous** : hors du dépôt, dans le moteur de tâches ; le dépôt ne reçoit que les livrables.

### D5 — Le gel des tests, empêcher ou constater

Le leur **constate** (une lentille relit l'historique Git) ; le nôtre **empêche**
(`testFreezeGuard` refuse l'écriture, `acceptanceHash` compare l'empreinte).

Pendant DELIVER, leur `RemiseParPalierAcceptanceTests.cs` a été modifié **deux fois**, chaque fois
pour suivre un refactoring réclamé par la revue. Voir A1 : c'est notre garde qui a un problème, pas
la leur.

### D6 — Budget d'essais

`maxRetriesPerPhase: 2` chez eux, 3 chez nous. Leur budget est lu par l'orchestrateur, qui est un
LLM ; le nôtre est appliqué par un réducteur pur.

### D7 — Un modèle par classe de rôle

Leur métadonnée `cost_role_class` route les rôles vers des modèles différents : Opus pour
l'orchestrateur, Sonnet pour les sous-agents, Haiku pour l'accessoire. Résultat mesuré :
25,64 $ de Sonnet, 10,47 $ d'Opus, 1,71 $ de Haiku. Nous utilisons un seul modèle pour tout.

## Pistes d'amélioration pour nous

### A1 — Le gel ne distingue pas l'adaptation mécanique de l'altération *(défaut réel)*

Leur refactoring a fait naître `Article` et `Reference` ; la fabrique privée du test d'acceptance a
dû suivre :

```diff
- new(reference, Quantite.De(quantite), Montant.De(prixUnitaire));
+ new(new Article(Reference.De(reference), Montant.De(prixUnitaire)), Quantite.De(quantite));
```

**Les assertions, les valeurs et les scénarios sont inchangés.** Chez nous, `testFreezeGuard`
refuserait l'écriture et `acceptanceHash` échouerait : DELIVER se retrouverait dans une impasse —
le test ne compile plus et ne peut pas être réparé.

Aucune correction évidente : il faudrait comparer ce que le test **vérifie**, pas ce qu'il
**contient**. Aucun de nos tests ne couvre ce cas ; nos scénarios de DELIVER n'ont jamais
refactorisé un objet-valeur.

### A2 — Rien ne vérifie qu'un agent peut faire ce qu'on lui demande *(défaut partagé)*

Deux de leurs lentilles déclarent `[SKILL MISSING] qa-reporting` : leur contenu impose de charger
cette skill, leur frontmatter n'accorde que `Read`, `Grep`, `Glob`. La skill existe pourtant dans
le plugin, et **six agents** l'exigent. Elles ont jugé sans leur grille.

C'est la même intersection que notre chercheur voulant `mkdir` sous une garde qui refuse le shell
(ADR 0037) : ni le contenu ni le manifeste n'est fautif seul.

**Test à écrire chez nous, et il ne coûte rien** : pour chaque rôle du manifeste, vérifier que tout
outil ou skill nommé dans son contenu figure dans ce que le manifeste lui accorde.

À leur crédit : leur lentille **déclare** la dégradation au lieu de juger en silence. C'est notre
propre principe — *ne jamais attester ce qu'on n'a pas mesuré* — appliqué par un agent à
lui-même.

### A3 — On a supprimé le faux positif en supprimant la capacité de voir

Leur revue a recalé DELIVER sur deux constats `medium` :

```
LigneDePanier a trois attributs d'instance → Object Calisthenics règle 8
Remise() enchaîne les points dans ses lambdas → règle 5, loi de Déméter
```

Le reproche est **juste**, et il a produit un vrai changement de modèle (deux objets-valeurs neufs).

Chez nous, personne ne le relèverait : l'ADR 0022 confie la forme au linter du projet, et
`dotnet format` ne connaît pas Object Calisthenics ; et `quality-gates` a été écartée de ce mandat
par l'ADR 0028 après avoir inventé un grief. On a donc supprimé le faux positif **et** la capacité
de voir.

Piste : une règle d'analyseur Roslyn dans le profil de stack plutôt qu'une lentille — mesurable,
reproductible, configurable par projet.

### A4 — Un reproche de forme rendu après coup se propage

Chez eux, la remarque de style arrive à la revue finale ; elle entraîne un refactoring, qui casse
la couverture, qui oblige à retoucher les tests d'acceptance gelés. Quatre commits en cascade.

Chez nous, le linter juge **pendant** la boucle interne, avant le gel. C'est un point où notre
ordonnancement est meilleur, à condition que le linter sache quoi chercher (voir A3).

### A5 — Une prévision avant de livrer

Ils produisent `forecast-us-2.{json,md}` en sortie de DISTILL : ce que la livraison est censée
coûter et produire, confronté après coup à l'issue réelle (`consigner l'issue réelle US-2`). Nous
n'avons aucun équivalent.

### A6 — Router les rôles vers des modèles différents

Voir D7. Une lentille en lecture seule n'a pas besoin du même modèle qu'un architecte. Notre port
`AgentRuntime` et le manifeste pourraient porter cette information ; l'ADR 0020 laisse déjà le
choix du modèle à l'utilisateur.

## Limites du dispositif d'observation

- **La consommation des sous-agents n'est pas ventilable.** Seuls les messages `assistant` du
  niveau principal portent des compteurs ; le `result` final donne un total de session, sans
  répartition par phase ni par agent. Notre trace (ADR 0032), elle, enregistre chaque appel avec sa
  phase et son rôle.
- **Deux erreurs de mesure commises en route**, corrigées : avoir pris une liste de fichiers lue
  par le modèle pour une preuve que le plugin était chargé (premier lancement perdu, ~0,9 $) ; et
  avoir cru que des événements portaient un `usage` alors que la chaîne « usage » apparaissait dans
  la liste des commandes slash.
- **42 `rate_limit_event`** pendant le run : une part de la durée vient du plafonnement d'API, pas
  de leur orchestrateur.
