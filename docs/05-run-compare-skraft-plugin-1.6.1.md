# Run comparé : skraft-plugin v1.6.1 sur US-2

Observation du 2026-09-29. Ni un banc de performance, ni un verdict.
Ce document contient le comparatif, les différences de conception, et le travail qui en découle —
fait et restant.

---

## 1. Dispositif

| | agent-studio | skraft-plugin |
| --- | --- | --- |
| Version | branche `fix/plafond-duree-tour` | v1.6.1 (`6d092bd`) |
| Runtime | Copilot CLI | Claude Code 2.1.273, `--plugin-dir` |
| Modèles | un seul | Opus (orchestrateur), Sonnet (sous-agents), Haiku |
| Entrée | `stories/US-2.md` | la **même** |
| Dépôt | copie de `exemple-dotnet-tdd` | copie de `exemple-dotnet-tdd` |

### Ce qui n'est pas comparable, et qu'on ne compare pas

- **Les coûts.** 37,81 $ chez Claude contre des requêtes premium chez Copilot : deux monnaies.
- **Les tokens.** Fournisseurs et façons de compter différentes.
- **Un run contre un run.** La variance d'un LLM est large ; et cinq de nos six runs du 29/09
  étaient occupés par nos propres défauts.
- **L'entrée.** Leur pipeline attend une story produite par leur `Backlog Planner`, dans leur
  format ; on lui a donné la nôtre.

### Ce qui est comparable

Les livrables, les durées de phase, les trajectoires de rejet, et les choix de conception que le
run rend visibles.

---

## 2. Résultats bruts

```
RESEARCH   4,7 min   1 essai    APPROVED
DESIGN    26,8 min   2 essais   APPROVED
DISTILL   19,3 min   1 essai    APPROVED
DELIVER   ~80 min    2 essais   CHANGES_REQUESTED — non close
                                14 commits, 24 tests verts
total      2 h 11    37,81 $
```

| Modèle | Coût |
| --- | ---: |
| claude-sonnet-5 (sous-agents) | 25,64 $ |
| claude-opus-5 (orchestrateur) | 10,47 $ |
| claude-haiku-4.5 | 1,71 $ |

Le processus s'est terminé en `success` mais **le pipeline n'est pas allé au bout** : la seconde
revue de DELIVER n'a pas rendu son verdict. Cause non établie — le plafond de 40 $ posé au
lancement était à 2,19 $ près, mais rien ne le confirme.

Nos durées, pour les phases qu'on a menées : RESEARCH 3 min, DESIGN 12,5 min. **Nous sommes plus
rapides là où nous passons** — nos portes constatent en quelques millisecondes ce que leurs
lentilles doivent relire.

> **Le fait qui compte plus que tout le reste : eux sont allés jusqu'au code, nous jamais.** Aucun
> de nos six runs n'a dépassé DISTILL. Aucune considération sur l'élégance de nos portes ne
> compense ça.

### Ce qu'ils ont livré

```
src/Tarification.Domaine/     Article(8) Reference(13) Taux(20) PalierDeRemise(8)
                              LigneDePanier(20) Quantite(18) Montant(30) Panier(21)
src/Tarification.Application/ CalculDuPanier(25)
tests/                        RemiseParPalierAcceptanceTests(86) CalculDuPanierTests(108) TauxTests(33)
```

Plus les documents de conception, ADR-003/004, le Gherkin, les plans, un dossier de preuves par
porte de qualité, et une prévision QA confrontée à l'issue réelle.

---

## 3. Convergences

1. **Les mêmes documents de conception sont exigés** — `contracts`, `event-model`, `diagrams`,
   `consistency-matrix`, `context-map`. Leur architecte en avait omis trois au premier essai ; leur
   revue les a réclamés. Ce n'est donc pas une différence de périmètre mais de moment.
2. **Les tests d'acceptance sont gelés** des deux côtés.
3. **Les deux pipelines ont recalé DESIGN à l'essai 1 et l'ont passé à l'essai 2.**
4. **Les rapports de revue sont versionnés par essai.** Nous y sommes venus le matin même, ADR 0040.

---

## 4. Divergences de conception

### D1 — Qui tranche une question ouverte

La story porte : *« les paliers sont-ils les mêmes pour toutes les références, ou définis par
référence ? »*

- **Eux** : l'architecte tranche et documente — `adr-003-portee-des-paliers-de-remise.md`.
- **Nous** : le réducteur pose la question à l'humain et attend (`askQuestion`) ; notre architecte a
  conclu « aucun ADR nécessaire ».

Aucun des deux n'a raison dans l'absolu. C'est la divergence la plus structurante du run.

### D2 — Qui constate un manquement

| | agent-studio | skraft-plugin |
| --- | --- | --- |
| Mécanisme | porte de code | lentille LLM |
| Moment | avant toute revue | après la revue |
| Coût d'un constat | ≈ 0 | un tour de revue complet |
| Reproductible | oui | non garanti |
| Reconnaît une forme équivalente | non | oui |

Passés dans **nos** portes, leurs livrables de DISTILL sont refusés — 2 valeurs du critère 3 non
recopiées, 0 test portant `ac-<n>` dans son nom — alors que **leur** lentille les a approuvés.
Réserve importante : deux de leurs quatre lentilles jugeaient sans grille (voir A2).

### D3 — Qui produit les preuves

- **Nous** (D20) : `run_tests` est notre handler ; la preuve est enregistrée par le cœur, hors
  d'atteinte de l'agent.
- **Eux** : l'agent lance les commandes et dépose `qg-build.{exit,stdout,sha256}`,
  `qg-acceptance.trx`, `coverage.cobertura.xml`, puis les commite.

Leur jeu de preuves est **plus riche que le nôtre**. Mais un `qg-acceptance.exit` contenant `0`
atteste ce que l'agent a bien voulu y écrire, et l'empreinte SHA-256 est calculée par le même
agent : elle détecte une altération *ultérieure*, pas une sortie fabriquée à l'origine. Leur
reviewer produit toutefois un `qg-verify-us-2.json` — une revérification par un autre agent, qui
atténue sans supprimer.

### D4 — Où vit l'état du pipeline

- **Eux** : `.copilot-tracking/skraft-plans/<slug>/state.json`, **commité dans le dépôt**, avec des
  sauvegardes horodatées, écrit par l'agent via leur CLI `state.mjs`.
- **Nous** : hors du dépôt, dans le moteur de tâches ; le dépôt ne reçoit que les livrables.

### D5 — Le gel des tests : empêcher ou constater

Le leur **constate** (une lentille relit l'historique Git) ; le nôtre **empêche**
(`testFreezeGuard` refuse, `acceptanceHash` compare). Pendant DELIVER, leur
`RemiseParPalierAcceptanceTests.cs` a été modifié **deux fois**. Voir A1 : c'est notre garde qui a
un problème, pas la leur.

### D6 — Budget d'essais

`maxRetriesPerPhase: 2` chez eux, 3 chez nous. Leur budget est lu par l'orchestrateur, qui est un
LLM ; le nôtre est appliqué par un réducteur pur.

### D7 — Un modèle par classe de rôle

Leur métadonnée `cost_role_class` route les rôles vers des modèles différents. Résultat mesuré :
25,64 $ de Sonnet, 10,47 $ d'Opus, 1,71 $ de Haiku. Nous utilisons un seul modèle pour tout.

---

## 5. Travail qui en découle

### A1 — Le gel ne distingue pas l'adaptation mécanique de l'altération — **OUVERT**

Leur refactoring a fait naître `Article` et `Reference` ; la fabrique privée du test a dû suivre :

```diff
- new(reference, Quantite.De(quantite), Montant.De(prixUnitaire));
+ new(new Article(Reference.De(reference), Montant.De(prixUnitaire)), Quantite.De(quantite));
```

**Assertions, valeurs et scénarios inchangés.** Chez nous, `testFreezeGuard` refuserait l'écriture
et `acceptanceHash` échouerait : le test ne compile plus **et** ne peut pas être réparé — DELIVER
est dans une impasse.

Aucune correction évidente : il faudrait comparer ce que le test **vérifie**, pas ce qu'il
**contient**. Aucun de nos tests ne couvre ce cas ; nos scénarios de DELIVER n'ont jamais
refactorisé un objet-valeur.

Critère : `gel-distingue-adaptation-et-alteration`.

### A2 — Rien ne vérifie qu'un agent peut faire ce qu'on lui demande — **FAIT**

Deux de leurs lentilles déclarent `[SKILL MISSING] qa-reporting` : leur contenu impose de charger
cette skill, leur frontmatter n'accorde que `Read`, `Grep`, `Glob`. La skill **existe** dans le
plugin, et **six agents** l'exigent. Elles ont jugé sans leur grille.

Même intersection que notre chercheur réclamant `mkdir` sous une garde qui refuse le shell
(ADR 0037) : ni le contenu ni le manifeste n'est fautif seul.

À leur crédit : leur lentille **déclare** la dégradation au lieu de juger en silence. C'est notre
propre principe — *ne jamais attester ce qu'on n'a pas mesuré* — appliqué par un agent à lui-même.

**Cinq tests écrits** dans `extensions/skraft/test/agents-skills.test.ts`. Ils lisent le contenu
**partagé** (pas le contrat, qui est dérivé du manifeste donc cohérent par construction) et le
confrontent au manifeste :

```
qui dit « lance les tests » a `run_tests`
qui dit « rédige un ADR » a `render_adr`
qui nomme un dossier de livrables a le droit d'y écrire
aucune skill exigée d'un rôle n'est absente du paquet      ← le cas qa-reporting
toute skill exigée d'un rôle lui est accordée par le manifeste
```

Vérifiés par mutation, pour qu'ils ne passent pas à vide :

```
run_tests retiré à skraft-acceptance   →  × « qui dit "lance les tests" a run_tests »
skill inexistante exigée d'un rôle     →  × « aucune skill exigée n'est absente du paquet »
```

Piège rencontré en les écrivant : déduire la clé de rôle du nom d'agent échoue —
`skraft-lens-test-integrity` contient « test » et tombait sur le rôle du testeur. L'appariement est
explicite.

### A3 — On a supprimé le faux positif en supprimant la capacité de voir — **OUVERT**

Leur revue a recalé DELIVER sur deux constats `medium` :

```
LigneDePanier a trois attributs d'instance        → Object Calisthenics règle 8
Remise() enchaîne les points dans ses lambdas     → règle 5, loi de Déméter
```

Le reproche est **juste**, et il a produit un vrai changement de modèle (deux objets-valeurs neufs).

Chez nous, personne ne le relèverait : l'ADR 0022 confie la forme au linter du projet, et
`dotnet format` ne connaît pas Object Calisthenics ; et l'ADR 0028 a écarté `quality-gates` de ce
mandat après qu'elle eut inventé un grief.

Piste : une règle d'analyseur Roslyn déclarée dans le profil de stack — mesurable, reproductible,
configurable par projet — plutôt qu'un jugement de LLM.

Critère : `qualite-de-forme-au-dela-du-formatage`.

### A4 — Un reproche de forme rendu après coup se propage — **rien à faire**

Chez eux, la remarque de style arrive à la revue finale ; elle entraîne un refactoring, qui casse
la couverture, qui oblige à retoucher les tests d'acceptance gelés. Quatre commits en cascade.

Chez nous, le linter juge **pendant** la boucle interne, avant le gel. Notre ordonnancement est
meilleur, à condition que le linter sache quoi chercher (A3).

### A5 — Une prévision avant de livrer — **à discuter**

Ils produisent `forecast-us-2.{json,md}` en sortie de DISTILL : ce que la livraison est censée
coûter et produire, confronté après coup à l'issue réelle. Nous n'avons aucun équivalent.

### A6 — Router les rôles vers des modèles différents — **à discuter**

Voir D7. Une lentille en lecture seule n'a pas besoin du même modèle qu'un architecte. Notre port
`AgentRuntime` et le manifeste pourraient porter cette information ; l'ADR 0020 laisse déjà le
choix du modèle à l'utilisateur.

---

## 6. Limites du dispositif d'observation

- **La consommation des sous-agents n'est pas ventilable.** Seuls les messages `assistant` du
  niveau principal portent des compteurs ; le `result` final donne un total de session, sans
  répartition par phase ni par agent. Notre trace (ADR 0032) enregistre, elle, chaque appel avec sa
  phase et son rôle.
- **42 `rate_limit_event`** pendant le run : une part de la durée vient du plafonnement d'API, pas
  de leur orchestrateur.
- **Deux erreurs de mesure commises, corrigées :**
  1. `--plugin-dir` pointé sur la racine du dépôt, qui n'est qu'un *marketplace* : le plugin ne
     s'est pas chargé et l'agent a **improvisé** le pipeline avec des `general-purpose` après avoir
     lu les prompts sur le disque. Coût du faux départ : ~0,9 $.
  2. Avoir pris la récitation des 31 noms de fichiers par le modèle pour une preuve de chargement.
     **La vérification qui vaut est la liste `agents` de l'événement `init`**, pas ce que le modèle
     raconte.

---

## 7. Comment rejouer

```bash
git clone https://github.com/SebastienDegodez/skraft-plugin.git && (cd skraft-plugin && git checkout v1.6.1)
git clone --no-hardlinks ~/Projets/exemple-dotnet-tdd copie && (cd copie && git checkout main)

cd copie && claude -p "Utilise l'agent skraft:skraft-orchestrator pour dérouler le pipeline SKRAFT
complet sur la story affinée stories/US-2.md. N'improvise pas le pipeline toi-même : délègue." \
  --plugin-dir ../skraft-plugin/plugins/skraft-framework \
  --permission-mode bypassPermissions --max-budget-usd 40 \
  --output-format stream-json --verbose > run.jsonl
```

`--plugin-dir` prend le dossier **du plugin** (celui qui porte `plugin.json`), pas la racine du
dépôt. Vérifier le chargement sur l'événement `init` :

```bash
head -1 run.jsonl | python3 -c "import json,sys; e=json.load(sys.stdin); print(len(e['agents']), 'skraft:skraft-orchestrator' in e['agents'])"
```
