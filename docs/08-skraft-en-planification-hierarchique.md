# skraft en planification hiérarchique : actions, tâches, recette

Proposition du 2026-10-04, **pas une décision** : un ADR suivra si la direction est retenue.
But : décrire skraft entièrement en **actions, tâches et méthodes** (planification hiérarchique,
HTN), pour savoir si un orchestrateur générique piloté par fichier peut le porter sans perte.

La recette complète est dans **`docs/recettes/skraft.recette.yaml`**. Aucun code ne charge encore ce
fichier : il décrit ce que fait aujourd'hui `extensions/skraft/src/`, et chaque élément renvoie au
code qui le réalise. Ce document explique les choix que le fichier applique.

---

## 1. Trois niveaux

| Niveau | Ce que c'est | Exemple |
|---|---|---|
| **Action atomique** | une opération du code, avec des paramètres, un résultat `ok` ou `ko`, et rien d'autre à décomposer | `creer-dossier { chemin }` |
| **Action d'agent**, **action humaine** | un tour d'agent dont la sortie est vérifiée, ou une décision demandée à un humain | `classer`, `ratifier-adr` |
| **Tâche** | un but nommé, atteint par l'une de ses **méthodes** ; une méthode est une suite d'étapes (actions ou sous-tâches) avec une condition d'application | `initialiser-story`, `livrer` |

La **recette** est la tâche de plus haut niveau (`livrer-story`), avec ses entrées, ses réglages et
tout ce qu'elle déclare.

## 2. Les propriétaires

Chaque élément a **un seul propriétaire de sa définition** : celui qui l'écrit, le teste et seul
peut le changer. D'autres peuvent le configurer, l'exécuter ou en fournir une partie ; ils ne le
redéfinissent pas.

### 2.1 Qui possède quoi

| Élément | Propriétaire de la définition | Écrit en | Configuré par | Exécuté par |
|---|---|---|---|---|
| Action atomique **générique** (`creer-dossier`, `commiter`, `lancer-tests`…) | **la plateforme** (cœur d'agent-studio) | TypeScript, dans le cœur | le projet, pour ce qui dépend de lui (commandes de `stack.yaml`) | le processus principal (Workspace, moteur de tâches) |
| Action atomique **propre à une extension** (`skraft.planifier-scenarios`…) | **l'extension** | TypeScript, dans `extensions/<nom>/src/` | la recette (paramètres) | le processus isolé de l'extension, par l'API `ctx` |
| Action atomique **par script** (`projet.verifier-migrations`) | **le projet** | un script de son dépôt, en Python, PowerShell, Bash… | la recette ou le projet (arguments) | le code, sans shell, interpréteur autorisé |
| Vérification, lecteur de format | même règle que les actions atomiques : plateforme, extension (`skraft.noms-definis`) ou projet | | la recette (paramètres) | le code |
| Primitive (`boucle`, `pour-chaque`, `en-parallele`, `rembobiner`) | **la plateforme** | TypeScript, dans le moteur | la recette (plafond, liste) | le moteur |
| **Action d'agent** | **l'auteur de la recette** : rôle, entrées, périmètre d'écriture, outils, sortie attendue, effets | YAML | voir §2.2 | l'agent, puis le code qui vérifie les effets |
| **Action humaine** | **l'auteur de la recette** : question, options, profils | YAML | — | l'humain du profil désigné |
| **Tâche, méthode** | **l'auteur de la recette** | YAML | les réglages (§3.3) | le moteur |
| **Recette** | **son auteur** : ici l'extension skraft ; un utilisateur pour sa propre recette | YAML | le projet peut surcharger les réglages | le moteur |
| Entrée | la recette la déclare | YAML | **l'utilisateur** fournit la valeur | — |
| Fait | **le code** qui le calcule (l'action désignée par `etabli-par`) | — | — | le moteur l'enregistre |
| Barre de qualité, commandes | **le projet** (`quality.yaml`, `stack.yaml`) | YAML | — | — |
| Modèle réel derrière une classe | **l'utilisateur** (réglages, ADR 0048) | — | — | — |

### 2.2 Une action d'agent a quatre contributeurs

C'est l'élément le plus partagé. Le propriétaire de sa définition reste l'auteur de la recette.

| Partie | Propriétaire | Où |
|---|---|---|
| rôle, entrées, périmètre d'écriture, outils, sortie attendue, effets, classe de modèle | **la recette** | `actions-agent` du YAML |
| contenu du prompt, skills | **l'extension** | `agents/<role>.agent.md`, partageable avec Copilot CLI et Claude Code (ADR 0024) |
| modèle réel pour la classe `strong`, `standard` ou `light` | **l'utilisateur** | réglages, selon son abonnement (ADR 0048) |
| outils terminaux et leur schéma, contrat d'exécution ajouté en dernier, interdits communs (aucun Git, aucun shell, preuves par `run_tests`, fichiers gelés en lecture seule) | **la plateforme** | cœur |

Conséquence : une recette **ne peut pas affaiblir** ce que la plateforme impose. Elle peut
restreindre le périmètre d'un agent, jamais lui donner Git ou un shell.

### 2.3 Le nom dit le propriétaire

Dans le YAML, le préfixe d'un nom indique où chercher sa définition :

| Forme | Propriétaire | Exemple |
|---|---|---|
| sans préfixe, **absent** du fichier | catalogue de la plateforme | `creer-dossier`, `tests-passent`, `boucle` |
| `<extension>.` | code de l'extension | `skraft.planifier-scenarios`, `skraft.noms-definis` |
| `projet.` | script du projet, déclaré dans `actions-script` | `projet.verifier-migrations` |
| sans préfixe, **déclaré** dans le fichier | la recette | `classer`, `ratifier-adr`, `livrer` |

Au chargement, un nom introuvable est refusé, de même qu'un nom déclaré dans la recette alors qu'il
existe déjà au catalogue : on ne masque pas une action de la plateforme.

### 2.4 Pendant une tâche, personne ne change ce qu'il ne possède pas

La recette, les scripts du projet, `quality.yaml` et `stack.yaml` sont **gelés** au démarrage
(empreintes) : aucun agent ne peut les modifier. Sinon, un agent pourrait affaiblir le contrôle
qu'on lui applique.

---

## 3. Entrées, contexte, réglages

### 3.1 Les entrées de l'utilisateur : la notation `$`

`$` désigne **ce que l'utilisateur fournit**, et rien d'autre. Les faits s'écrivent `faits.x`, le
contexte `contexte.x`, les réglages `reglages.x` : on voit à la lecture ce qui vient de l'humain.

```yaml
entrees:
  story:
    type: texte
    format: skraft.story-markdown        # lecteur fourni par l'extension (parseStory)
    source: [chat, fichier]              # collée dans le chat, ou chemin d'un fichier du dépôt
    obligatoire: true
  confirmer-difficulte: { type: booleen, defaut: true }    # --auto la passe à false
  granularite: { type: choix, valeurs: [tour-par-scenario, sessions-par-pas], obligatoire: false }
```

- **La story arrive par le chat.** `/skraft` suivi de la story collée, ou d'un chemin. Une entrée
  obligatoire absente est demandée dans le chat. L'interface peut aussi générer un formulaire depuis
  la déclaration (type, valeurs, défaut, aide).
- **Elle est enregistrée dans le dépôt** (`.skraft/{$story.slug}/story.md`) par `initialiser-story`.
  Une story venue du chat ne doit pas exister seulement dans la conversation : reprise, revue et
  rapport la relisent.
- Les **types de base** : `texte`, `booleen`, `nombre`, `choix`, `liste`, `fichier`, `fichiers` (par
  motif). Pour un format, un lecteur du catalogue, ou un JSON Schema déclaré dans la recette.

### 3.2 Un format est un lecteur : il produit des champs typés

`skraft.story-markdown` (aujourd'hui `parseStory`, `story.ts`) :

| Exigé dans le texte | Champ produit |
|---|---|
| titre `# <IDENTIFIANT> — <titre>` | `$story.id`, `$story.titre`, `$story.slug` |
| le paragraphe qui suit | `$story.enonce` |
| `## Critères d'acceptation`, liste numérotée, au moins un | `$story.criteres[]` : `n`, `texte`, `litteraux` |
| `## Questions ouvertes`, facultative | `$story.questions-ouvertes[]` |
| le texte entier | `$story.brut` |

**Une entrée invalide arrête tout avant le premier agent**, donc sans coût. Au chargement de la
recette, chaque référence (`$story.criteres`) est confrontée aux champs que produit le lecteur : une
faute de frappe est refusée avant le lancement, avec le nom fautif.

### 3.3 Contexte et réglages

- **Contexte** : `depot`, `stack` (`stack.yaml`), `barre` (`quality.yaml`), `modeles`. Toujours
  présent, jamais saisi ; déclaré pour que la recette dise ce dont elle dépend.
- **Réglages** : les valeurs de la recette qui sont aujourd'hui en dur dans le code — grille de
  difficulté (`DEFAULT_THRESHOLDS`), effets du niveau (`levelEffects`), plafond de cycles (D24),
  phases revues. Le projet peut les surcharger (`.agent-studio/recettes/skraft.yaml`).

---

## 4. Règles d'exécution

1. **Le LLM ne choisit jamais la transition** (D16). Une condition `si:` ne lit que des faits, des
   entrées et des réglages. Le LLM peut *proposer* (le plan d'implémentation, `coveredBy`) ; le code
   vérifie avant de s'en servir.
2. **Les effets sont vérifiés, jamais supposés.** On planifie en cours d'exécution : chaque action
   est suivie de ses vérifications, et la suite dépend de leur résultat.
3. **Échec d'une action**, dans cet ordre : réessai avec les motifs, tant que le budget le permet ;
   puis la méthode suivante de la tâche ; puis l'escalade à l'humain (relancer, sauter, abandonner).
4. **Pas de recherche combinatoire** : chaque action coûte des requêtes. Les méthodes s'essaient
   dans l'ordre déclaré, une fois chacune.
5. **Rembobiner fait oublier** : un retour au checkpoint oublie aussi les sessions des rôles
   concernés (ADR 0050).
6. **Un fait doit exister quand une condition le lit** : vérifié au chargement grâce à `etabli-par`.

Les faits et leurs valeurs sont listés dans la section `faits` du YAML. Effets de la difficulté
(`levelEffects`) :

| Difficulté | Recherche | Granularité | Lentilles | Essais |
|---|---|---|---|---|
| `simple` | sautée | tour par scénario | cold-reader, test-integrity | 2 |
| `medium` | sautée | tour par scénario | les 4 | 3 |
| `medium-hard` | faite | tour par scénario | les 4 | 3 |
| `challenging` | faite | sessions par pas | les 4 | 3 |

---

## 5. Les actions atomiques

### 5.1 Contrat commun

- **Paramètres** typés, **résultat** `{ statut: ok | ko, motif, sorties }`.
- **Rejouables sans dégât** : `creer-dossier` sur un dossier existant rend `ok`. Après une
  interruption, le moteur rejoue depuis le checkpoint (SPEC §6).
- **Confinées** : tout chemin passe par le Workspace (chemin réel, aucune sortie du dépôt).
- **Une tâche `tout-ou-rien`** (comme `initialiser-story`) s'exécute derrière un seul checkpoint :
  si une étape rend `ko`, on revient au checkpoint.

### 5.2 Catalogue de la plateforme (générique)

| Famille | Actions |
|---|---|
| Fichiers | `lire-entree`, `lire-fichier`, `lister-fichiers`, `enregistrer`, `creer-dossier`, `geler` |
| Git | `noter-depart`, `creer-branche`, `poser-checkpoint`, `rembobiner`, `commiter`, `lire-diff` |
| Exécution | `lancer-tests`, `mesurer-couverture`, `mesurer-mutation`, `lancer-script` |
| Agents | `lancer-agent`, `oublier-sessions` |
| Humain | `demander`, `informer` |
| Faits | `retenir { fait, valeur }` |
| Contrôle | `verifier { verification }`, et les vérifications : `tests-passent`, `rouge-pour-bonne-raison`, `rien-ne-regresse`, `sequence-rouge-puis-vert`, `gel-intact`, `perimetre-respecte`, `aucun-fichier-modifie`, `production-modifiee`, `un-seul-nouveau-test`, `fichier-present`, `fichiers-produits`, `sections-presentes`, `chemins-existent`, `urls-bien-formees`, `contrat-respecte`, `seuils-atteints`, `lint`, `dependances-respectees`, `au-plus-un-cran-de` |

Une vérification s'écrit directement comme une étape (`- tests-passent: {}`) : c'est un raccourci
pour `verifier`. `lancer-agent` et `demander` ne s'écrivent pas non plus : une action d'agent ou
humaine déclarée dans la recette s'appelle par son nom, et le moteur s'en sert pour l'exécuter.
`poser-checkpoint` est aussi posé par le moteur avant chaque effet ; la recette le nomme au début
d'une phase pour marquer le point de retour, mais un oubli ne rendrait pas la reprise fausse.

### 5.3 Catalogue de l'extension skraft

Ce qui est propre à skraft reste dans son code, sous l'espace de noms `skraft.` :

| Nom | Rôle | Code actuel |
|---|---|---|
| `skraft.story-markdown` | lecteur de la story | `parseStory`, `story.ts` |
| `skraft.mesurer-indicateurs` | critères, modules touchés, intégration externe, questions ouvertes | `computeIndicators`, `difficulty.ts` |
| `skraft.proposer-difficulte` | niveau proposé par la grille | `gradeDifficulty` |
| `skraft.planifier-scenarios` | ordre des scénarios depuis le plan, non-régressions | `planDeliver` |
| `skraft.ouvrir-scenario` | checkpoint du scénario, `deja-vert` | `startScenario` |
| `skraft.relever-contrat` | noms du contrat présents (ADR 0047) | revue de DELIVER |
| `skraft.synthese-revue` | fils de défauts, cibles, arbitrages, verdict (ADR 0046) | `reviewRound`, `synthesize` |
| `skraft.appliquer-statuts-adr` | statut ratifié écrit dans chaque ADR | `applyAdrStatuses` |
| `skraft.rapport-final` | rapport de fin de tâche | `finalReport` |
| vérifications `skraft.*` | `une-seule-recommandation`, `noms-definis`, `adr-nouveaux-bien-formes`, `adr-numerotation-continue`, `remplacements-consignes`, `gherkin-valide`, `valeurs-recopiees`, `rouge-d-acceptance`, `test-designe-est-celui-du-scenario`, `test-ajoute-vert-ou-rouge-pour-bonne-raison` | portes de `effects.ts`, `design.ts`, `distill.ts`, `deliver-effects.ts` |

### 5.4 Les actions par script (propriétaire : le projet)

Pour un contrôle propre à un projet, sans écrire d'extension :

```yaml
actions-script:
  projet.verifier-migrations:
    executable:                          # interpréteur + fichier, par système si besoin
      linux:   [python3, outils/verifie_migrations.py]
      macos:   [python3, outils/verifie_migrations.py]
      windows: [py, "-3", 'outils\verifie_migrations.py']
    arguments: ["{fichiers}"]            # jetons remplis par le code
    parametres: { fichiers: { type: fichiers, motif: "db/migrations/**" } }
    acces: lecture                       # ou ecriture: [motifs]
    reseau: non
    delai: 120s
    resultat:
      code-retour: { 0: ok, autre: ko }  # c'est le code de retour qui décide
      sortie-standard: json              # { "motif": "...", "sorties": { ... } }, facultatif
      schema-des-sorties: { type: object, properties: { migrations: { type: integer } } }
```

- **Quel interpréteur, quel fichier** : `executable`, décliné par système quand il diffère
  (`[bash, x.sh]`, `[pwsh, x.ps1]`, `[cmd, /c, 'x.cmd']`). Préférer un interpréteur qui tourne
  partout (Python, Node, PowerShell) : une seule ligne suffit.
- **Aucun shell** : programme et arguments passés tels quels, comme dans `stack.yaml`.
- **Interpréteur autorisé** : il doit figurer dans la liste des programmes autorisés de
  l'administrateur, sinon la recette est refusée au chargement.
- **Un fichier du dépôt, jamais du code dans le YAML**, et **gelé** pendant la tâche.
- **Accès déclaré** : en lecture seule, le script ne modifie rien ; en écriture, le code vérifie
  après coup qu'il n'a touché que ses motifs. Git reste hors de sa portée.
- **Jamais pour ce que la plateforme fait déjà** : `creer-dossier` ou `commiter` en script
  ferait moins bien (confinement, rejeu, Windows) ce que le Workspace garantit.

skraft n'en déclare aucune.

---

## 6. Les actions d'agent

Déclarées dans `actions-agent` du YAML. Chacune a un rôle, une classe de modèle, des entrées, un
périmètre d'écriture, des outils, une sortie attendue (outil terminal) et des **effets** : les
vérifications que le code exécute après le tour. Un effet manqué est un rejet avec motifs.

| Action | Rôle | Classe | Sortie | Effets principaux |
|---|---|---|---|---|
| `classer` | skraft-classifier | light | `submit_difficulty` | `au-plus-un-cran-de` la proposition (écart 6) |
| `rechercher` | skraft-researcher | standard | `report_phase` | sections, chemins cités existants, URL, une seule recommandation |
| `modeliser` | skraft-architect-model | strong | `report_phase` | aucun propre (écart 1) |
| `decider` | skraft-architect-decide | strong | `report_phase` | noms définis, ADR bien formés, numérotation, ADR existants inchangés |
| `distiller` | skraft-acceptance | standard | `report_phase` | Gherkin, valeurs recopiées, plan de test, rouge d'acceptance |
| `ecrire-test-rouge` | skraft-test | standard | `report_phase` | un seul nouveau test, rouge pour une bonne raison ; variante `coveredBy` (ADR 0045) |
| `coder`, `faire-passer-au-vert`, `nettoyer` | skraft-dev | standard | `report_phase` | tests gelés intacts, suite verte, test du pas vert |
| `corriger-tests` | skraft-test | standard | `report_phase` + réponses | rien ne régresse, test ajouté vert ou rouge pour une bonne raison |
| `corriger-code` | skraft-dev | standard | `report_phase` + réponses | suite verte, cibles vertes, contrat respecté (ADR 0047) |
| `relire` | skraft-lens-{lentille} | standard, `quality-gates` light | `submit_lens_verdict` | aucun : un jugement est synthétisé, pas vérifié |

Actions humaines (`actions-humaines`) : `confirmer-difficulte`, `repondre-question-ouverte`,
`repondre-blocage`, `ratifier-adr`, `arbitrer-desaccord`, `decider-escalade`. Jamais d'attente
bloquante : une demande persistée, réinjectée comme décision.

---

## 7. Les tâches

Déclarées dans `taches` du YAML.

| Tâche | Méthodes, dans l'ordre d'essai |
|---|---|
| `livrer-story` (racine) | `complete` si `faits.recherche`, sinon `sans-recherche` |
| `preparer` | `initialiser-story`, puis `evaluer-difficulte` |
| `initialiser-story` | tout-ou-rien : lire la story, noter le départ, créer la branche et les dossiers, enregistrer la story |
| `evaluer-difficulte` | `confirmee-par-l-humain` si `$confirmer-difficulte`, sinon `automatique` |
| `phase(nom, travail)` | `avec-revue` pour DESIGN, DISTILL, DELIVER ; sinon `sans-revue` |
| `rechercher-phase`, `concevoir`, `distiller-phase` | une méthode chacune |
| `questions-ouvertes`, `ratification` | rien à faire, ou un `pour-chaque` humain |
| `livrer` | planifier, `pour-chaque` scénario, livrables, mutation de fin de phase |
| `implementer-scenario` | `deja-vert`, `un-tour`, `sessions-separees` (aussi le repli de `un-tour`) |
| `fin-de-scenario` | une suite de vérifications : acceptance gelée, tests verts, rouge puis vert, couverture, lint, dépendances, mutation |
| `cycle-un-tour`, `cycle-en-sessions` | `couvert-par-acceptance` si l'agent le déclare (vérifié), sinon test puis code |
| `revue-de-phase` | lentilles en parallèle, puis synthèse ; le verdict choisit la suite |
| `corriger-revue` | `tests-puis-code` s'il y a des défauts sur les tests, sinon `code-seul` |
| `apres-escalade` | relancer, sauter, abandonner |

### 7.1 `initialiser-story` : une tâche faite d'actions atomiques

Aujourd'hui l'effet `init` (`effects.ts`) fait tout d'un bloc. Dans la recette, ce n'est plus une
action mais une **tâche**, exécutée par le code et non par un agent :

```yaml
initialiser-story:
  tout-ou-rien: true
  methodes:
    - etapes:
        - lire-entree:   { entree: $story }
        - noter-depart:  {}
        - creer-branche: { nom: "skraft/{$story.slug}" }
        - creer-dossier: { chemin: ".skraft/{$story.slug}/research" }
        - creer-dossier: { chemin: ".skraft/{$story.slug}/design" }
        - creer-dossier: { chemin: ".skraft/{$story.slug}/distill/features" }
        - creer-dossier: { chemin: ".skraft/{$story.slug}/reviews" }
        - enregistrer:   { chemin: ".skraft/{$story.slug}/story.md", contenu: $story.brut }
  sur-echec: { escalade: [relancer, abandonner] }
```

Elle ne mesure plus la difficulté : ce n'est pas son rôle.

### 7.2 `evaluer-difficulte` : le code mesure, l'agent ajuste, l'humain confirme

```yaml
evaluer-difficulte:
  methodes:
    - nom: confirmee-par-l-humain
      si: "$confirmer-difficulte"
      etapes:
        - skraft.mesurer-indicateurs: { story: $story, depot: contexte.depot }
        - skraft.proposer-difficulte: { indicateurs: faits.indicateurs, grille: reglages.grille }
        - classer: {}                    # effet : au plus un cran de la proposition
        - confirmer-difficulte: {}
    - nom: automatique
      etapes:
        - skraft.mesurer-indicateurs: { story: $story, depot: contexte.depot }
        - skraft.proposer-difficulte: { indicateurs: faits.indicateurs, grille: reglages.grille }
        - classer: {}
        - retenir: { fait: difficulte, valeur: faits.difficulte-classee }
```

Le classifieur reçoit les mesures et la proposition : il juge, il ne compte pas. Le code borne son
jugement.

---

## 8. Ce que l'exercice montre

**Ce qui s'exprime sans perte.** Le cadre commun des phases, le choix entre méthodes sur des faits,
la boucle par scénario, les replis, la revue et la correction routée, les étapes humaines. Les
portes deviennent ce qu'elles sont réellement : les **effets** des actions.

**Ce qui reste écrit en code**, et que le fichier nomme : les primitives (`boucle` plafonnée,
`en-parallele`, `pour-chaque` sur une liste proposée par un agent et validée, `rembobiner` avec
oubli des sessions), la synthèse de revue, les empreintes des fichiers gelés.

**Les écarts trouvés en l'écrivant**, à trancher :

1. **Les deux architectes sont jugés ensemble.** `modeliser` n'a pas d'effet propre ; un rejet de
   DESIGN relance les deux. Un effet `fichier-present: domain-model.md` détecterait plus tôt un
   modèle absent.
2. **Le budget d'essais est partagé** entre les portes de forme et la revue d'une phase (ADR 0042).
   En HTN, chaque action aurait son budget ; c'est un choix à expliciter.
3. **`nettoyer` échoue sans escalade** : son échec ramène au vert et laisse continuer. Le YAML
   l'écrit comme une règle de la tâche (`cycle-en-sessions.sur-echec`), pas de l'action.
4. ~~La story n'était définie nulle part~~ — **réglé** : entrées déclarées, `$`, lecteur, références
   vérifiées au chargement.
5. **Les conditions lisent des faits calculés à des moments différents** : réglé par `etabli-par`,
   vérifié au chargement.
6. **Le classifieur n'est pas borné.** Le code accepte tout niveau valide (`isDifficulty`) ; le
   cran d'écart (`shift`) ne sert qu'à construire les options proposées à l'humain. En `--auto`,
   le niveau du classifieur s'applique tel quel, même à trois crans de la grille. Le YAML ajoute
   l'effet `au-plus-un-cran-de` : changement de comportement à décider.
7. **La grille n'est pas réglable.** `DEFAULT_THRESHOLDS` est commenté « réglable » mais codé en dur ;
   le YAML en fait un réglage surchargeable par le projet.
8. **La story ne vient que d'un fichier.** `/skraft <chemin>` exige un fichier ; la story collée
   dans le chat et son enregistrement dans `.skraft/<slug>/story.md` sont nouveaux.

## 9. Suite proposée

1. Valider ou corriger ce découpage, les propriétaires (§2) et les écarts 6 à 8.
2. ADR de l'orchestrateur générique : schéma du fichier, catalogues (plateforme, extension, projet),
   primitives, règles d'exécution, validation au chargement.
3. Preuve : exécuter `rechercher-phase` décrite ainsi, et faire passer les tests actuels de skraft
   qui la couvrent, sans les modifier.
