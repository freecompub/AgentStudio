# skraft en planification hiérarchique : actions et méthodes

Proposition du 2026-10-04, **pas une décision** : un ADR suivra si la direction est retenue.
But : décrire skraft entièrement en **tâches, méthodes et actions** (planification hiérarchique,
HTN), pour savoir si un orchestrateur générique piloté par fichier peut le porter sans perte.
Chaque élément renvoie au code qui le réalise aujourd'hui (`extensions/skraft/src/`).

---

## 0. Les entrées de la recette

Une recette déclare **ce qu'elle reçoit** : sans cela, « la story » n'est définie nulle part, et
une action qui lit `story.criteres` ne peut pas être vérifiée avant le lancement. Aujourd'hui cette
définition est cachée dans le code (`SkraftInput`, `parseStory`) ; elle devient la première section
du fichier. Trois sortes d'entrées.

### 0.1 Les entrées fournies au lancement

```yaml
entrees:
  story:
    type: fichier
    format: story-markdown          # lecteur du catalogue (§0.3) : valide et découpe le fichier
    obligatoire: true
    aide: "Fichier de la story, relatif à la racine du dépôt"
  confirmer-difficulte:
    type: booleen
    defaut: true                    # mode simple : l'humain confirme le niveau proposé
  granularite:
    type: choix
    valeurs: [tour-par-scenario, sessions-par-pas]
    obligatoire: false              # absente : déduite de la difficulté (D22)
  phases:
    type: liste
    valeurs: [RESEARCH, DESIGN, DISTILL, DELIVER]
    obligatoire: false              # surcharge de l'ordre, réservée aux essais
```

Elles arrivent par la commande (`/skraft stories/US-2.md --auto`) ou par un **formulaire que
l'interface génère depuis cette déclaration** : type, valeurs, défaut et aide suffisent à le
construire.

### 0.2 Le contexte fourni par la plateforme

Toujours présent, jamais saisi ; déclaré pour que la recette dise ce dont elle dépend :

```yaml
contexte:
  depot: {}                          # arbre de travail, historique Git
  stack: { fichier: ".agent-studio/stack.yaml" }     # comment lancer les outils
  barre: { fichier: ".agent-studio/quality.yaml" }   # ce qui est exigé (ADR 0049)
  modeles: {}                        # modèle par classe de rôle (ADR 0048)
```

### 0.3 Le format d'une entrée : un lecteur du catalogue

Comme une vérification, un format **se nomme** dans le fichier et **s'écrit en code**. Le lecteur
valide l'entrée et la découpe en champs typés, que les actions référencent ensuite.

`story-markdown` (aujourd'hui `parseStory`, `story.ts`) :

| Exigé dans le fichier | Champ produit | Type |
|---|---|---|
| titre `# <IDENTIFIANT> — <titre>` (ex. `# US-2 — Remise par palier`) | `story.id`, `story.titre`, `story.slug` | texte |
| le paragraphe qui suit (« En tant que… je veux… afin de… ») | `story.enonce` | texte |
| section `## Critères d'acceptation`, liste numérotée, au moins un | `story.criteres[]` : `n`, `texte`, `litteraux` | liste |
| section `## Questions ouvertes`, facultative | `story.questions-ouvertes[]` | liste |

Les `litteraux` (nombres avec unité, chaînes entre guillemets) sont extraits par le code : c'est
sur eux que porte la vérification `valeurs-recopiees` de DISTILL.

**Une entrée invalide arrête tout avant le premier agent**, donc sans coût : « Titre attendu
« # <IDENTIFIANT> — <titre> » », « Aucun critère d'acceptation numéroté » → escalade (relancer,
abandonner).

### 0.4 Les actions référencent des champs, et le chargement le vérifie

```yaml
distiller:
  entrees: [story.criteres, story.enonce, conception]
```

Au chargement de la recette, chaque référence est confrontée aux champs que produisent les
lecteurs déclarés : `story.critere` (faute de frappe) ou une entrée jamais déclarée sont refusés
**avant le lancement**, avec le nom fautif.

### 0.5 Des entrées propres à une recette d'utilisateur

Un utilisateur qui écrit sa recette déclare ses propres entrées, avec les **types de base**
(`texte`, `booleen`, `nombre`, `choix`, `liste`, `fichier`, `fichiers` par motif) et, pour un
fichier, un format :

```yaml
entrees:
  ticket:
    type: fichier
    format: json
    schema:                          # JSON Schema déclaré dans la recette, validé par le code
      type: object
      required: [titre, tables]
      properties:
        titre: { type: string }
        tables: { type: array, items: { type: string } }
  base-cible:
    type: choix
    valeurs: [postgres, sqlserver]
```

Pour un format qui ne s'exprime pas en schéma, les deux mêmes sorties que pour les vérifications :
un **script du projet** (lancé par le code, programmes autorisés, qui rend du JSON confronté au
schéma déclaré), ou un **lecteur fourni par une extension**.

---

## 1. Vocabulaire et règles

| Terme | Définition | Qui décide |
|---|---|---|
| **Action** | ce qui s'exécute directement : un tour d'**agent**, une opération du **code**, ou une décision **humaine** | — |
| **Préconditions** | ce qui doit être vrai pour lancer l'action | le code |
| **Effets** | ce que l'action doit avoir produit : des **vérifications du catalogue**, exécutées après coup | le code |
| **Tâche** | un but nommé, atteint par l'une de ses méthodes | — |
| **Méthode** | une façon de décomposer une tâche en sous-tâches, avec une **condition d'application** | le code, sur des faits |
| **Recette** | une tâche de plus haut niveau et ses méthodes : un workflow complet (`skraft`) | — |

**Règles d'exécution**

1. **Le LLM ne choisit jamais la transition** (D16). Une condition de méthode ne lit que des
   **faits** calculés par le code (§2). Le LLM peut *proposer* une décomposition (le plan
   d'implémentation de DISTILL) ; le code la valide avant de s'en servir.
2. **Les effets sont vérifiés, jamais supposés.** On planifie en cours d'exécution : chaque action
   est suivie de ses vérifications, et la décomposition suivante dépend de leur résultat.
3. **Échec d'une action**, dans cet ordre :
   1. **réessai** de l'action, avec les motifs de rejet, tant que le budget le permet ;
   2. **méthode suivante** de la tâche, s'il y en a une ;
   3. **escalade** à l'humain (relancer, sauter, abandonner).
4. **Pas de recherche combinatoire** : chaque action coûte des requêtes. Les méthodes s'essaient
   dans l'ordre déclaré, une fois chacune.
5. **Rembobiner fait oublier** : un retour au checkpoint s'accompagne de l'oubli des sessions des
   rôles concernés (ADR 0050), sinon l'agent se souviendrait de fichiers effacés.

---

## 2. Les faits disponibles pour les conditions

Calculés et enregistrés par le code ; seule matière autorisée dans une condition `si:`.

| Fait | Valeurs | Établi par |
|---|---|---|
| `difficulte` | `simple`, `medium`, `medium-hard`, `challenging` | classement confirmé (§3.2) |
| `granularite` | `tour-par-scenario`, `sessions-par-pas` | l'entrée `granularite` si fournie, sinon déduite de la difficulté (`levelEffects`) |
| `lentilles` | sous-ensemble des 4 lentilles | déduit de la difficulté |
| `essais-max` | 2 ou 3 | déduit de la difficulté |
| `questions-ouvertes` | liste, répondues ou non | `story.questions-ouvertes`, puis la recherche |
| `adr-proposes` | liste | porte de DESIGN |
| `scenario.deja-vert` | oui / non | exécution des tests par le code |
| `scenario.echecs` | nombre | réducteur |
| `defauts-actifs` | par cible (`test`, `code`, `livrable`) | fils de défauts (ADR 0046) |
| `barre` | contenu de `quality.yaml` | lecture validée (ADR 0049) |

Effets de la difficulté, repris de `levelEffects` :

| Difficulté | Recherche | Granularité | Lentilles | Essais |
|---|---|---|---|---|
| `simple` | sautée | tour par scénario | cold-reader, test-integrity | 2 |
| `medium` | sautée | tour par scénario | les 4 | 3 |
| `medium-hard` | faite | tour par scénario | les 4 | 3 |
| `challenging` | faite | sessions par pas | les 4 | 3 |

En DESIGN, la lentille `quality-gates` n'est pas convoquée (`lensesForPhase`) : aucune mesure
n'existe encore.

---

## 3. Les actions

Notation : `executant` = `agent:<rôle>`, `code` ou `humain:<profils>`. `effets` = vérifications
du catalogue ; un effet manqué est un **rejet avec motifs**.

### 3.1 Actions du code

```yaml
initialiser-story:                     # effects.ts « init »
  executant: code
  entrees: [entrees.story]             # fichier lu par le lecteur story-markdown (§0.3)
  effets:
    - story-valide: {}                 # §0.3 : titre, critères numérotés
    - branche-creee: { nom: "skraft/{story.slug}" }
    - dossiers-crees: [research, design, distill/features, reviews]
  sorties-faits: [slug, story, indicateurs-difficulte, questions-ouvertes]

proposer-difficulte:                   # calcul pur, gradeDifficulty
  executant: code
  entrees: [indicateurs-difficulte]
  sorties-faits: [difficulte-proposee]

poser-checkpoint:                      # « checkpointPhase »
  executant: code
  sorties-faits: [checkpoint-de-phase]

rembobiner:                            # « rollback » + « forgetSessions » (ADR 0050)
  executant: code
  entrees: [checkpoint, roles-de-la-phase]
  effets: [arbre-identique-au-checkpoint, sessions-oubliees]

commiter-phase:                        # « commitPhase »
  executant: code
  entrees: [phase]
  effets: [rapports-de-revue-reecrits, commit-cree]

appliquer-statuts-adr:                 # « applyAdrStatuses »
  executant: code
  entrees: [adr-ratifies]
  effets: [statut-ecrit-dans-chaque-adr]

planifier-scenarios:                   # « planDeliver »
  executant: code
  preconditions:
    - tests-acceptance-geles-intacts: {}        # empreinte de DISTILL
    - suite-verte-hors-acceptance: {}           # « La suite est rouge avant DELIVER »
  entrees: [distill/impl-plan.md, resultats-de-la-suite]
  sorties-faits: [scenarios]                    # ordre du plan, puis critères non cités ; non-régressions faites

ouvrir-scenario:                       # « startScenario »
  executant: code
  sorties-faits: [checkpoint-de-scenario, scenario.deja-vert]

controler-fin-de-scenario:             # « scenarioGate »
  executant: code
  effets:
    - tests-acceptance-geles-intacts: {}
    - test-acceptance-du-scenario-vert: {}
    - suite-verte-hors-en-attente: {}
    - sequence-rouge-puis-vert: {}              # pour chaque test unitaire du scénario
    - couverture: {}                            # seuils de quality.yaml
    - lint: {}
    - dependances: {}
    - mutation: { si: "barre.mutation.moment == scenario" }

controler-fin-de-livraison:            # « runGate » DELIVER
  executant: code
  effets:
    - livrables-produits: {}
    - mutation: { si: "barre.mutation.moment == fin-de-phase" }   # ADR 0049

releve-contrat:                        # au moment de la revue de DELIVER (ADR 0047)
  executant: code
  sorties-faits: [noms-du-contrat-presents]

rapport-final:                         # « finalReport »
  executant: code
```

### 3.2 Actions d'agent

Contraintes communes à tous les agents : aucun Git, aucun shell, tests lancés seulement par
l'outil `run_tests` (preuves enregistrées par le code), fichiers gelés (`GELÉS`) en lecture seule,
contrat d'exécution du cœur en dernier dans le prompt (ADR 0024).

```yaml
classer:                               # rôle skraft-classifier, classe de modèle light
  executant: agent:skraft-classifier
  entrees: [story.enonce, story.criteres, indicateurs-difficulte, difficulte-proposee]
  sortie: submit_difficulty
  effets:
    - niveau-connu: {}                 # sinon relance du classifieur, budget compté

rechercher:                            # skraft-researcher, standard
  executant: agent:skraft-researcher
  entrees: [story.enonce, story.criteres, story.questions-ouvertes, reponses-humaines, motifs-precedents]
  contraintes: { ecriture: [".skraft/{story.slug}/**"], outils: [list_files, report_blocker] }
  sortie: report_phase
  effets:                              # porte « citations », researchGate
    - document: { chemin: "research/research.md", sections: [
        "Périmètre et critères de succès", "Fichiers analysés", "Recherches effectuées",
        "Conventions du projet", "Découvertes", "Approches évaluées", "Recommandation",
        "Passage de relais"] }
    - citations: { document: "research/research.md", ignorer: [".skraft/**"] }
    - urls-bien-formees: { document: "research/research.md" }
    - une-seule-recommandation: { document: "research/research.md" }
  sorties-faits: [questions-ouvertes]

modeliser:                             # skraft-architect-model, strong
  executant: agent:skraft-architect-model
  entrees: [story.enonce, story.criteres, research.md, reponses-humaines, motifs-precedents]
  contraintes: { ecriture: [".skraft/{story.slug}/**"], outils: [list_files, report_blocker] }
  sortie: report_phase
  effets: []                           # jugés avec la décision, à la porte de DESIGN

decider:                               # skraft-architect-decide, strong
  executant: agent:skraft-architect-decide
  entrees: [story.enonce, story.criteres, event-model.md, domain-model.md, motifs-precedents]
  contraintes:
    ecriture: [".skraft/{story.slug}/**"]    # docs/adr : SEULEMENT par l'outil render_adr
    outils: [list_files, render_adr, report_blocker]
  sortie: report_phase
  effets:                              # porte « cohérence », checkDesign
    - document: { chemin: "design/event-model.md" }
    - noms-definis: { definitions: [event-model.md, domain-model.md], citations: [contracts.md, diagrams.md] }
    - adr-nouveaux-bien-formes: {}     # titre, sections, statut Proposed, nom sans verdict, pas une « bonne pratique »
    - adr-numerotation-continue: {}
    - adr-existants-inchanges: {}      # append-only
    - remplacements-consignes: { registre: supersessions.md }
  sorties-faits: [adr-proposes]

distiller:                             # skraft-acceptance, standard
  executant: agent:skraft-acceptance
  entrees: [story.criteres, story.enonce, conception, emplacement-des-tests-acceptance, motifs-precedents]
  contraintes:
    ecriture: [".skraft/{story.slug}/**", "@stack:acceptanceTests", "@stack:sources"]
    outils: [list_files, run_tests, report_blocker]
  sortie: report_phase
  effets:
    - gherkin-valide: {}               # porte « gherkin »
    - valeurs-recopiees: { depuis: story.criteres.litteraux }   # porte « valeurs » : mot pour mot
    - document: { chemin: "distill/test-plan.md" }
    - rouge-d-acceptance: {}           # chaque critère : un test marqué ac-<n>, rouge pour une bonne raison,
                                       # sauf non-régression justifiée dans le plan de test
  sorties-faits: [empreinte-tests-acceptance, non-regressions]

ecrire-test-rouge:                     # skraft-test, pas « test »
  executant: agent:skraft-test
  entrees: [scenario, story.criteres, gherkin, test-acceptance, tests-deja-ecrits, motifs-precedents]
  contraintes: { ecriture: ["@stack:unitTests"], outils: [list_files, run_tests, run_lint, report_blocker] }
  sortie: report_phase
  effets:                              # verifyUnitRed
    - seulement-tests-unitaires-modifies: {}
    - un-seul-nouveau-test: {}
    - rouge-pour-une-bonne-raison: {}  # assertion ou symbole manquant
    - aucune-regression: {}
  variante:                            # ADR 0045 : sortie coveredBy
    declarer-couvert-par-acceptance:
      effets:
        - aucun-fichier-modifie: {}
        - test-designe-est-celui-du-scenario: {}
        - rouge-pour-une-bonne-raison: {}

coder:                                 # skraft-dev, pas « dev » (tour par scénario)
  executant: agent:skraft-dev
  entrees: [scenario, test-a-faire-passer, motifs-precedents]
  contraintes:
    ecriture: ["@stack:sources"]
    lecture-seule: ["@stack:acceptanceTests", "@stack:unitTests"]
    outils: [list_files, run_tests, run_lint, report_blocker]
  sortie: report_phase
  effets:                              # verifyUnitGreen
    - tests-geles-intacts: {}          # empreinte prise au rouge
    - production-modifiee: {}
    - suite-verte-hors-en-attente: {}
    - test-du-pas-vert: {}

faire-passer-au-vert:                  # skraft-dev, pas « green » (sessions par pas) — mêmes effets que coder
  executant: agent:skraft-dev
  herite: coder

nettoyer:                              # skraft-dev, pas « refactor »
  executant: agent:skraft-dev
  herite: coder
  effets-retires: [production-modifiee]          # un nettoyage peut ne rien changer
  sur-echec: rembobiner-sans-escalade             # SPEC §8.3 : retour au vert, scénario poursuivi

corriger-tests:                        # skraft-test, pas « fix-test » (ADR 0046)
  executant: agent:skraft-test
  entrees: [defauts-actifs-cible-test, rappels]
  contraintes: { ecriture: ["@stack:unitTests"], outils: [list_files, run_tests, report_blocker] }
  sortie: report_phase                 # avec responses : fixed / contested / outOfScope
  effets:                              # verifyFixTests
    - seulement-tests-unitaires-modifies: {}
    - aucun-test-existant-disparu-ni-casse: {}
    - test-ajoute-vert-ou-rouge-pour-une-bonne-raison: {}
  sorties-faits: [cibles-du-developpeur]          # les tests ajoutés encore rouges

corriger-code:                         # skraft-dev, pas « fix »
  executant: agent:skraft-dev
  entrees: [defauts-actifs-cible-code, cibles-du-developpeur, rappels]
  contraintes:
    ecriture: ["@stack:sources"]
    lecture-seule: ["@stack:acceptanceTests", "@stack:unitTests"]
  sortie: report_phase                 # avec responses
  effets:
    - tests-geles-intacts: {}
    - production-modifiee: {}
    - suite-verte: {}
    - cibles-vertes: {}
    - contrat-intact: {}               # ADR 0047 : aucun nom du contrat retiré

relire:                                # une par lentille : cold-reader, test-integrity, architecture, quality-gates
  executant: agent:skraft-lens-{lentille}
  entrees: [livrables, code, tests, faits-etablis, mes-defauts-precedents]   # dossier propre à chaque lentille
  contraintes: { ecriture: [] }
  sortie: submit_lens_verdict          # verdict, défauts (cible obligatoire), arbitrages
  effets: []                           # un jugement ne se vérifie pas : il est synthétisé (§4.10)
```

### 3.3 Actions humaines

Jamais d'attente bloquante : une demande d'interaction persistée, réinjectée comme décision.

```yaml
confirmer-difficulte:      { executant: "humain:po|developpeur|architecte", options: [simple, medium, medium-hard, challenging] }
repondre-question-ouverte: { executant: "humain:po", options: [repondre, reporter] }
repondre-blocage:          { executant: "humain:po|developpeur|architecte|administrateur", options: choix-de-l-agent }
ratifier-adr:              { executant: "humain:architecte", options: [accepter, rejeter, demander-un-amendement] }
arbitrer-desaccord:        { executant: "humain:developpeur|architecte|administrateur", options: [donner-raison-a-l-agent, donner-raison-a-la-lentille] }
decider-escalade:          { executant: "humain:developpeur|architecte|administrateur", options: [relancer, sauter, abandonner] }
```

---

## 4. Les méthodes

Notation : une tâche liste ses méthodes **dans l'ordre d'essai** ; `si:` est la condition
d'application ; `sous-taches:` s'exécutent en séquence, sauf `pour-chaque`.

### 4.1 La recette

```yaml
livrer-story:
  methodes:
    - nom: complete
      si: "difficulte in [medium-hard, challenging]"
      sous-taches: [preparer, phase(rechercher-phase), questions-ouvertes, phase(concevoir), phase(distiller-phase), phase(livrer), rapport-final]
    - nom: sans-recherche
      si: "difficulte in [simple, medium]"
      sous-taches: [preparer, questions-ouvertes, phase(concevoir), phase(distiller-phase), phase(livrer), rapport-final]
```

### 4.2 Préparer

```yaml
preparer:
  methodes:
    - nom: confirmee-par-l-humain
      si: "entrees.confirmer-difficulte"
      sous-taches: [initialiser-story, proposer-difficulte, classer, confirmer-difficulte]
    - nom: automatique
      sous-taches: [initialiser-story, proposer-difficulte, classer]
  sur-echec:
    initialiser-story: { escalade: [relancer, abandonner] }     # story invalide
    classer:           { reessai: essais-max, puis: { escalade: [relancer, abandonner] } }
```

### 4.3 Une phase : le cadre commun

Toutes les phases de travail passent par ce cadre ; c'est ce qui garantit checkpoint, revue,
réessai, escalade et commit identiques partout.

```yaml
phase(travail):
  methodes:
    - nom: avec-revue
      si: "phase in [DESIGN, DISTILL, DELIVER]"                  # REVIEWED_PHASES
      sous-taches: [poser-checkpoint, travail, revue-de-phase, ratification-si-besoin, commiter-phase]
    - nom: sans-revue
      sous-taches: [poser-checkpoint, travail, commiter-phase]
  sur-echec-d-un-effet:
    reessai: essais-max                  # même agent, motifs transmis, rien rembobiné (ADR 0040)
    puis: [rembobiner, { escalade: [relancer, sauter, abandonner] }]
  sur-blocage-d-agent: [repondre-blocage, reprendre-l-action]   # sans consommer d'essai
```

### 4.4 Rechercher, concevoir, distiller

```yaml
rechercher-phase:
  methodes:
    - sous-taches: [rechercher]

concevoir:
  methodes:
    - nom: modeliser-puis-decider       # deux sessions (§7.2) ; un réessai reprend les deux
      sous-taches: [modeliser, decider]

distiller-phase:
  methodes:
    - sous-taches: [distiller]
```

### 4.5 Questions ouvertes

```yaml
questions-ouvertes:
  methodes:
    - nom: rien-a-demander
      si: "questions-ouvertes.non-repondues == []"
      sous-taches: []
    - nom: demander
      sous-taches: [pour-chaque(question-non-repondue, repondre-question-ouverte)]
```

### 4.6 Ratification

```yaml
ratification-si-besoin:
  methodes:
    - nom: rien-a-ratifier
      si: "adr-proposes == []"
      sous-taches: []
    - nom: ratifier
      sous-taches: [pour-chaque(adr-propose, ratifier-adr), appliquer-statuts-adr]
  # « demander un amendement » relance decider avec le motif de l'humain.
```

### 4.7 Livrer

```yaml
livrer:
  methodes:
    - sous-taches: [planifier-scenarios, pour-chaque(scenario-moteur, implementer-scenario), controler-fin-de-livraison]
  sur-echec:
    controler-fin-de-livraison:
      mutation: corriger-revue           # chaque mutant survivant = défaut adressé au testeur (ADR 0049)
```

### 4.8 Implémenter un scénario

```yaml
implementer-scenario:
  sous-taches-avant: [ouvrir-scenario]
  methodes:                              # dans l'ordre
    - nom: deja-vert
      si: "scenario.deja-vert"
      sous-taches: [controler-fin-de-scenario]
    - nom: un-tour
      si: "granularite == tour-par-scenario and scenario.echecs == 0"
      sous-taches: [boucle(cycle-un-tour), controler-fin-de-scenario]
    - nom: sessions-separees             # aussi le repli d'un échec de « un-tour » (D22)
      sous-taches: [boucle(cycle-en-sessions), controler-fin-de-scenario]
  boucle:
    jusqu-a: "test-acceptance-du-scenario-vert"
    plafond: 20                          # cycles par scénario (D24)
  sur-echec:
    rembobiner: checkpoint-de-scenario
    puis: methode-suivante
    au-dela-du-budget: { escalade: [relancer, sauter, abandonner] }
```

### 4.9 Un cycle TDD

```yaml
cycle-un-tour:
  methodes:
    - nom: couvert-par-acceptance        # ADR 0045
      si: "agent-declare-couvert"        # proposition de l'agent, VÉRIFIÉE par les effets de la variante
      sous-taches: [ecrire-test-rouge.declarer-couvert-par-acceptance, coder]
    - nom: test-puis-code
      sous-taches: [ecrire-test-rouge, coder]

cycle-en-sessions:
  methodes:
    - nom: couvert-par-acceptance
      si: "agent-declare-couvert"
      sous-taches: [ecrire-test-rouge.declarer-couvert-par-acceptance, faire-passer-au-vert, nettoyer]
    - nom: test-vert-nettoyage
      sous-taches: [ecrire-test-rouge, faire-passer-au-vert, nettoyer]

sur-echec-d-un-pas:
  rembobiner: dernier-point-sur          # checkpoint du pas
  reessai: essais-max
  puis: echec-du-scenario                # → méthode suivante de implementer-scenario
```

### 4.10 La revue de phase

```yaml
revue-de-phase:
  methodes:
    - sous-taches:
        - releve-contrat                 # DELIVER seulement
        - en-parallele(pour-chaque(lentille, relire))
        - synthese                       # code : identifiants, cibles corrigées, arbitrages, verdict
  resultat:
    approuvee: suite
    rejetee: { escalade: [relancer, sauter, abandonner] }        # deux lentilles REJECTED
    desaccord-persistant: [arbitrer-desaccord, synthese]
    changements-demandes:
      si: "phase == DELIVER"
      faire: corriger-revue
      sinon: reessai-de-la-phase         # retour complet, rappel des demandes corrigées
```

### 4.11 Corriger après revue (ADR 0046, 0047)

```yaml
corriger-revue:
  methodes:
    - nom: tests-puis-code
      si: "defauts-actifs.test != []"
      sous-taches: [corriger-tests, corriger-code-si-besoin, controler-fin-de-scenario, revue-de-phase]
    - nom: code-seul
      sous-taches: [corriger-code, controler-fin-de-scenario, revue-de-phase]
  regles:
    - "les réponses ne s'appliquent qu'au pas validé ; un défaut sans réponse est tenu pour traité (endTurn)"
    - "outOfScope : le défaut part à l'autre agent, une seule fois"
    - "contesté puis maintenu deux fois : arbitrer-desaccord"
    - "échec de controler-fin-de-scenario : rembobiner, fils restaurés, premier pas selon les défauts actifs"
  budget: essais-max                     # au-delà, sauf défaut maintenu par l'humain : escalade

corriger-code-si-besoin:
  methodes:
    - si: "defauts-actifs.code != [] or cibles-du-developpeur != []"
      sous-taches: [corriger-code]
    - sous-taches: []
```

### 4.12 Décider d'une escalade

```yaml
apres-escalade:
  methodes:
    - si: "decision == relancer"
      sous-taches: [reprendre-la-tache-echouee]         # budget remis à zéro
    - si: "decision == sauter and origine == phase"
      sous-taches: [rembobiner, phase-suivante]
    - si: "decision == abandonner"
      sous-taches: []                                    # tâche close
```

---

## 5. Ce que l'exercice montre

**Ce qui s'exprime sans perte.** Le cadre commun des phases (§4.3), le choix entre méthodes sur
des faits, la boucle par scénario, les replis (« un tour » vers « sessions séparées »), la revue et
la correction routée, les étapes humaines. Les portes deviennent ce qu'elles sont réellement : les
**effets** des actions.

**Ce qui demande des primitives écrites en code** (le fichier les nomme, le code les exécute) :

| Primitive | Pourquoi elle ne se décrit pas |
|---|---|
| `boucle(...)` avec plafond | la condition d'arrêt dépend d'une exécution des tests |
| `en-parallele(...)` | les lentilles travaillent isolées, simultanément |
| `synthese` | règles de §9.3, fils de défauts, arbitrages : du code testé |
| `rembobiner` | rollback + oubli des sessions + recréation des dossiers |
| `pour-chaque(...)` sur une liste proposée par un agent | la liste (plan d'implémentation) doit être validée avant usage |
| les fichiers gelés et leurs empreintes | prises et comparées par le code |

**Les écarts trouvés en l'écrivant**, à trancher :

1. **Les deux architectes sont jugés ensemble.** `modeliser` n'a pas d'effet propre ; un rejet de
   DESIGN relance les deux. Un effet `document: domain-model.md` sur `modeliser` détecterait plus
   tôt un modèle absent.
2. **Le budget d'essais est partagé** entre les portes de forme et la revue d'une phase (ADR 0042
   donne un essai garanti à la première revue). En HTN, chaque action aurait naturellement son
   budget ; c'est un choix à expliciter.
3. **`nettoyer` échoue sans escalade** : seule action dont l'échec ramène au vert et laisse
   continuer. C'est une règle de méthode, pas d'action ; elle doit s'écrire comme telle.
4. ~~La story n'était définie nulle part~~ — **réglé par §0** : entrées déclarées, lues par un
   lecteur du catalogue, références vérifiées au chargement.
5. **Les conditions lisent des faits que le code calcule à des moments différents** (difficulté
   en début de tâche, `scenario.deja-vert` à l'ouverture du scénario). L'orchestrateur doit
   garantir qu'un fait existe quand une condition le lit : à vérifier au chargement de la recette.

## 6. Suite proposée

1. Valider ou corriger ce découpage.
2. ADR de l'orchestrateur générique : schéma du fichier, catalogue de vérifications, primitives
   (§5), règles d'exécution (§1), validation au chargement.
3. Preuve : exécuter `rechercher-phase` décrite ainsi, et faire passer les tests actuels de skraft
   qui la couvrent, sans les modifier.
