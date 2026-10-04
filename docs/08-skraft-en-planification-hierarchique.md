# skraft en planification hiérarchique : une fonctionnalité téléversable

Proposition du 2026-10-04, **pas une décision** : un ADR suivra si la direction est retenue.

**Le but.** Un utilisateur crée une nouvelle fonctionnalité en **téléversant un dossier** dont un
fichier YAML décrit tout : les entrées qu'il fournit, les sessions d'agent (quel agent, quels
skills, quelle mémoire), les actions, les contrôles, et l'orchestration en tâches et méthodes
(planification hiérarchique, HTN). Pas de TypeScript. skraft devient une fonctionnalité parmi
d'autres ; le principe reste : **le fichier dit quoi faire, le code de la plateforme l'exécute et
vérifie**.

**Où sont les fichiers** (`fonctionnalites/`, voir son README) :

| Fichier | Contenu |
|---|---|
| `fonctionnalite.schema.json` | le format, en JSON Schema : propriétés fermées partout |
| `catalogue.yaml` | ce que la plateforme fournit : opérations, primitives, vérifications, outils |
| `skraft/skraft.yaml` | skraft entièrement décrit |
| `skraft/scripts/` | le code propre à skraft, porté en Python depuis ses portes |

Le test `extensions/skraft/test/fonctionnalite-generique.test.ts` vérifie le schéma, la cohérence
de la recette, et la **parité** de chaque script avec la fonction TypeScript qu'il remplace. Aucun
code de production ne charge encore ce format.

---

## 1. Les éléments d'une fonctionnalité

Chaque sorte d'élément a une **liste fermée de propriétés** ; une clé inconnue est refusée au
téléversement, avec son chemin. Une seule façon d'écrire chaque chose : ni raccourci, ni héritage,
ni fusion YAML (`<<`). Les ancres (`&`, `*`) restent permises pour ne pas recopier une liste.

| Élément | Propriétés |
|---|---|
| **Fonctionnalité** | `format`, `nom`, `version`, `description`, `licence`, `commande`, `entrees`, `reglages`, `faits`, `interpreteurs`, `sessions`, `actions`, `taches`, `tache-racine` |
| **Entrée** | `type`, `obligatoire`, `defaut`, `valeurs`, `lecteur` ou `schema`, `source`, `aide` |
| **Session** | `agent`, `modele`, `skills-injectes`, `skills-a-la-demande`, `outils`, `ecriture`, `creation-seule`, `lecture-seule`, `memoire` |
| **Action `agent`** | `session`, `parametres`, `consigne`, `entrees`, `sortie`, `controles`, `essais`, `delai` |
| **Action `humaine`** | `parametres`, `question`, `detail`, `options`, `profils` |
| **Action `script`** | `interpreteur`, `fichier`, `parametres`, `sorties`, `acces`, `reseau`, `delai` |
| **Contrôle** | `verification`, `avec`, `si` |
| **Tâche** | `description`, `parametres`, `methodes`, `sur-echec` |
| **Méthode** | `nom`, `si`, `tout-ou-rien`, `etapes` |
| **Étape** | `faire`, `avec`, `si`, `id`, `retenir`, `etapes` (primitives seulement), `sur-echec` |
| **Politique d'échec** | `reessais`, `rembobiner` (`jamais`, `avant-chaque-reessai`, `avant-de-renoncer`), `puis` (`methode-suivante`, `escalade`, `continuer`, `echouer`), `options-escalade` |

Les **actions atomiques** (créer un dossier, commiter, lancer les tests…) ne se déclarent pas :
elles sont au catalogue de la plateforme, avec des paramètres fermés eux aussi. Une étape les
appelle par leur nom, comme une action ou une tâche de la fonctionnalité.

**Références.** `$story` est une entrée fournie par l'utilisateur, et `$` ne désigne rien d'autre.
`faits.x` est calculé et enregistré par le code ; `reglages.x`, une valeur de la recette ;
`contexte.x`, ce que fournissent la plateforme et le projet (`stack.yaml`, `quality.yaml`) ;
`parametres.x`, un paramètre de la tâche ou de l'action ; `courant.x`, l'élément d'une boucle ;
`sorties.<id>.x`, la sortie d'une étape ; `sortie.x`, celle de l'action dans ses propres contrôles.
`{…}` interpole une référence dans une chaîne. Une condition `si:` suit une grammaire fermée
(comparaisons, `in`, `and`, `or`, `not`), sans appel de fonction.

## 2. Les propriétaires

| Élément | Propriétaire de la définition | Peut être configuré par |
|---|---|---|
| Action atomique, primitive, vérification du catalogue | **la plateforme** | la recette (paramètres) ; le projet pour ce qui dépend de lui (commandes de `stack.yaml`) |
| Action `script` | **l'auteur de la fonctionnalité** (ses scripts sont dans le dossier) | la recette (paramètres) |
| Action `agent` | **l'auteur de la fonctionnalité** | voir ci-dessous |
| Session | **l'auteur de la fonctionnalité** | l'utilisateur choisit le modèle réel derrière la classe (ADR 0048) |
| Action `humaine` | **l'auteur** pour la question ; **le profil désigné** pour la réponse | — |
| Tâche, méthode | **l'auteur de la fonctionnalité** | les réglages |
| Entrée | l'auteur la déclare | **l'utilisateur** fournit la valeur |
| Fait | **le code** qui le calcule | — |
| Barre de qualité, commandes | **le projet** (`quality.yaml`, `stack.yaml`) | — |

Une session a plusieurs contributeurs : l'auteur la définit et fournit le prompt (`.agent.md`,
partageable avec Copilot CLI et Claude Code, ADR 0024) ; l'utilisateur choisit le modèle ; la
**plateforme impose** les outils de sortie, le contrat d'exécution ajouté en dernier et les
interdits (aucun Git, aucun shell, preuves par `run_tests`, fichiers gelés en lecture seule). Une
fonctionnalité peut restreindre une session, jamais l'élargir.

Pendant une orchestration, la recette, ses scripts, `quality.yaml` et `stack.yaml` sont **gelés** :
aucun agent ne peut affaiblir le contrôle qu'on lui applique.

## 3. Les sessions

- **Une session vit au plus le temps de l'orchestration.** À l'intérieur, la fonctionnalité choisit :
  `memoire: neuve` (rien d'un appel à l'autre) ou `conservee` (jusqu'à l'opération `reinitialiser`
  ou la fin). Une session conservée peut traverser plusieurs phases.
- **À la fin, toutes les sessions sont détruites**, quelle que soit l'issue : réussite, abandon,
  échec, annulation. Après un plantage, celles qui restent sont détruites au redémarrage. On garde
  la trace, les preuves, la branche, les commits et le rapport.
- **Rembobiner réinitialise** les sessions qui ont travaillé depuis le checkpoint (ADR 0050).
- **« Conservée » est un confort, pas une garantie** : une session perdue (redémarrage pendant une
  attente humaine) repart avec son **dossier de passation**, toujours construit par le code (les
  `entrees` de l'action, les motifs du rejet précédent), jamais une transcription. Une
  fonctionnalité ne doit jamais compter sur la mémoire pour être correcte.
- Une session n'est jamais appelée deux fois en même temps.

Cela **précise D17** une seconde fois (après l'ADR 0039) : « une session vit au plus le temps de
l'orchestration ; la fonctionnalité décide de sa mémoire à l'intérieur ». Décision du responsable
du projet, à inscrire dans un ADR.

## 4. Sorties, outils, écriture

**La sortie d'une action d'agent est toujours normalisée** : un outil de sortie du catalogue
(`report_phase`, `submit_difficulty`, `submit_lens_verdict`…), ou un JSON Schema déclaré, dont la
plateforme fait un outil `submit_<action>`. Le code ne lit jamais de texte libre pour décider (D16).
`report_blocker` est toujours disponible.

**Les outils** d'une session sont pris au catalogue (`list_files`, `run_tests`, `run_lint`). Les
outils intégrés de Copilot CLI (lire, écrire) ne se déclarent pas : ils sont **restreints** par
`ecriture`, `creation-seule` et `lecture-seule`, appliqués par la garde du cœur. Seul `run_tests`
produit des preuves.

**`creation-seule` remplace l'outil `render_adr`.** skraft passait par un outil pour écrire un ADR :
numéro, statut et protection des ADR décidés. Le motif d'écriture `creation-seule: ["docs/adr/**"]`
donne la protection sans outil : l'agent crée un fichier, ou modifie un fichier qu'il a créé dans
cette orchestration (l'ADR amendé d'un essai à l'autre reste un seul fichier), jamais un ADR
existant. Le numéro et le statut sont contrôlés après le tour par `verifier-conception`. Le prix :
un numéro faux coûte un réessai au lieu d'une correction dans le tour.

## 5. Les scripts

Le code propre à une fonctionnalité est un **script de son dossier**, déclaré comme action
`script` :

```yaml
interpreteurs:
  python: { linux: [python3], macos: [python3], windows: [py, "-3"] }

actions:
  verifier-gherkin:
    type: script
    interpreteur: python
    fichier: scripts/verifier_gherkin.py
    parametres: { features: { type: liste, obligatoire: true } }
    acces: lecture
    reseau: false
    delai: 30s
```

- **Quel interpréteur, par système** : une table `interpreteurs`, que chaque script désigne par son
  nom. L'interpréteur doit figurer dans la liste des programmes autorisés de l'administrateur.
- **Entrée et sortie en JSON** : paramètres sur l'entrée standard (aucun argument, aucun shell, pas
  de limite de longueur de ligne de commande sous Windows) ; `{ motifs, sorties }` sur la sortie
  standard. Code de retour 0 = ok, 1 = ko, autre = erreur d'environnement (escalade).
- **Accès déclaré** : `lecture`, ou `ecriture` avec ses motifs, vérifiés après coup. Git reste hors
  de portée : c'est l'affaire des opérations du catalogue.
- Un script s'emploie comme **étape** (`faire: planifier-scenarios`), comme **contrôle** d'une
  action (`verification: verifier-recherche`) ou comme **lecteur** d'une entrée (`lecteur: lire-story`).

skraft en compte douze : lecteur de story, indicateurs et grille de difficulté, portes « citations »,
« cohérence », « gherkin », « valeurs » et « RED d'acceptance », plan des scénarios, contrat
(ADR 0047), ratification des ADR, rapport final. Ce sont des portages fidèles des fonctions pures
de l'extension ; onze sont vérifiés à parité (le rapport final n'a pas d'équivalent comparable).

## 6. Règles d'exécution

1. **Le LLM ne choisit jamais la transition** (D16) : une condition ne lit que des faits, des
   entrées, des réglages et des sorties validées. Un agent peut *proposer* (`coveredBy`, une liste
   de scénarios) ; un contrôle vérifie avant usage.
2. **Les contrôles s'exécutent après chaque action d'agent** ; un contrôle manqué est un rejet avec
   motifs. Les sorties des contrôles s'ajoutent à celle de l'action (`controles.<verification>`).
3. **Échec**, selon la politique de l'étape ou de la tâche : réessais (avec les motifs, dans la même
   session), retour au checkpoint selon `rembobiner`, puis `methode-suivante`, `escalade`,
   `continuer` ou `echouer` (l'échec remonte).
4. **Pas de recherche combinatoire** : les méthodes s'essaient dans l'ordre, une fois chacune.
5. **Ouvrir une phase une seule fois.** Une phase de skraft est une tâche qui pose son checkpoint,
   puis appelle une tâche « travail » qui seule est réessayée. Sinon un réessai reposerait le
   checkpoint et compterait le travail du premier essai comme existant.

## 7. Ce que la recette skraft montre

**Ce qui s'exprime sans perte** : les phases, le choix entre méthodes sur des faits, la boucle par
scénario et son plafond, le repli « un tour » vers « sessions séparées », le nettoyage qui échoue
sans escalade, la variante « couvert par l'acceptance » (contrôles conditionnels), la correction
routée par cible, la mutation de fin de phase, la ratification, les étapes humaines.

**Ce qui reste du code de la plateforme**, nommé par la recette : les primitives `boucle`,
`pour-chaque`, `en-parallele`, et surtout **`revue`** — les fils de défauts, leurs identifiants,
cibles, réponses et arbitrages (ADR 0046) sont un mécanisme, pas une recette. Toute fonctionnalité
qui fait relire son travail en a besoin.

**Écarts entre la recette et le code actuel**, à trancher :

1. **Les deux architectes étaient jugés ensemble** : la recette donne à `modeliser` un contrôle
   propre (`domain-model.md` présent).
2. **Le budget d'essais est partagé** entre les contrôles et la revue d'une phase (ADR 0042) ; la
   recette garde ce partage (un seul `sur-echec` sur la tâche « travail »).
3. **Un amendement d'ADR relance aussi `modeliser`** dans la recette (réessai de la tâche
   « travail ») ; skraft ne relance que `decider`.
4. **Le classifieur n'est pas borné** dans le code : le cran d'écart (`shift`) ne sert qu'aux
   options proposées à l'humain, et `--auto` applique son niveau tel quel. La recette ajoute le
   contrôle `au-plus-un-cran-de`.
5. **La grille n'est pas réglable** dans le code (`DEFAULT_THRESHOLDS`) ; la recette en fait un
   réglage.
6. **La story ne vient que d'un fichier** dans le code ; la recette l'accepte du chat et
   l'enregistre dans `.skraft/<slug>/story.md`.
7. **`render_adr` disparaît** au profit de `creation-seule` (§4).

## 8. Suite proposée

1. Valider le format, les propriétaires, la règle des sessions et les écarts 1 à 7.
2. ADR : fonctionnalité téléversée et format normalisé ; sessions et précision de D17.
3. Preuve : un chargeur de fonctionnalité dans le cœur (validation au téléversement, comme le
   test actuel), puis exécuter `rechercher-phase` de `skraft.yaml` et faire passer les tests
   existants de skraft qui la couvrent, sans les modifier.
