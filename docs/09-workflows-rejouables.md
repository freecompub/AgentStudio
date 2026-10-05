# Workflows rejouables : l'orchestration écrite comme un script

- Statut : **direction retenue le 2026-10-05**, rien d'implémenté. Décisions : ADR 0052
  (orchestration par script rejouable) et ADR 0053 (cycle de vie des sessions).
- Remplace : l'approche YAML de `docs/08` (abandonnée, raisons dans ce document).
- Inspiration : les workflows de Claude Code (un en-tête déclaratif, un script qui orchestre des
  agents, une reprise par rejeu d'un journal).

---

## 1. Le problème

Écrire skraft a coûté cher, et ce n'est pas le TypeScript qui en est la cause. Il a fallu une
**machine à états écrite à la main** : `reducer.ts` (456 lignes), `deliver-machine.ts` (366
lignes), et un état d'une quarantaine de champs (`stage`, `designStep`, `deliver.step`, `fixing`,
`pendingResponses`, `threadsAtFixStart`…) qui ne servent qu'à savoir **où l'on en est**. Pour
comprendre une tâche en cours, il faut décoder plusieurs de ces champs ensemble.

La tentative de `docs/08` (tout décrire en YAML) déplaçait ce coût sans le réduire, et en ajoutait
d'autres : un langage déguisé, des comportements inexprimables, du code dupliqué en Python.

## 2. Le principe

> On écrit l'orchestration **comme une suite d'étapes, de haut en bas**, en code ordinaire. La
> plateforme rend ce code **reprenable** : chaque appel vers l'extérieur (agent, humain, tests,
> Git, fichiers) est **journalisé** ; à la reprise, le script repart du début, les appels déjà
> journalisés rendent leur résultat enregistré sans rien refaire, et le premier appel absent du
> journal s'exécute réellement.

Il n'y a plus d'état « où j'en suis » à tenir : c'est la position dans le script.

Le principe directeur ne change pas : **le LLM propose, le code décide et vérifie.** Le script est
du code ; le LLM ne choisit jamais la suite (D16).

## 3. Où se déclare quoi

Une fonctionnalité reste une **extension** : manifeste signé (D13), processus isolé (D9), API `ctx`
seule (D10). Deux endroits :

| Endroit | Contenu | Vérifié |
|---|---|---|
| **Manifeste** (`manifest.json`) | agents (prompt, skills, outils, écriture, sortie, classe de modèle, **mémoire**), skills, outils propres, permissions, et les **workflows** : nom, fichier, commande, entrées, phases, questions humaines et profils | à l'installation, sans rien exécuter (D11) |
| **Fichier de workflow** (`dist/workflows/<nom>.mjs`) | l'orchestration, en code | à l'exécution, par le rejeu |

Les workflows de Claude mettent la partie déclarative en tête du script (`meta`). Ici elle va dans
le manifeste, parce qu'il est déjà validé par schéma, signé et lu à l'installation : un seul
endroit à contrôler.

### 3.1 Déclaration dans le manifeste

```ts
contributes: {
  agents: [ /* inchangés, plus « memoire » (§9) */ ],
  skills: [ /* inchangées */ ],
  workflows: [{
    name: "livrer-story",
    title: "Livrer une story avec skraft",
    file: "dist/workflows/livrer-story.mjs",
    commande: "skraft",                                   // /skraft <story>
    entrees: {
      story: { type: "fichier", obligatoire: true, aide: "La user story (« # US-2 — Titre », critères numérotés)." },
      auto:  { type: "booleen", defaut: false, aide: "Difficulté retenue sans confirmation." },
    },
    phases: { RESEARCH: "Enquête sur le code existant", DESIGN: "Conception", DISTILL: "Scénarios d'acceptance", DELIVER: "Implémentation en TDD" },
    humains: {                                            // qui peut répondre à quoi (D6)
      "confirmer-difficulte": ["po", "developpeur", "architecte"],
      "question-ouverte":     ["po"],
      "blocage":              ["po", "developpeur", "architecte"],
      "ratifier-adr":         ["architecte"],
      "arbitrer":             ["developpeur", "architecte", "administrateur"],
      "escalade":             ["developpeur", "architecte", "administrateur"],
    },
  }],
}
```

La plateforme s'en sert pour refuser à l'installation un workflow qui appellerait un agent ou une
question non déclarés, construire le formulaire de lancement, afficher la carte de tâche et ses
phases, et router chaque question vers les bons profils.

`contributes.workflows` remplace `contributes.tasks` pour les extensions migrées ; les deux
coexistent pendant la migration.

## 4. Le fichier de workflow

```ts
// extensions/skraft/workflows/livrer-story.ts
import { workflow, essayer } from "@agent-studio/workflow";
import { parseStory, slugOf } from "../src/story.js";                 // fonctions pures existantes
import { levelEffects } from "../src/difficulty.js";
import { checkResearch } from "../src/research.js";
import { checkDesign } from "../src/design.js";

export default workflow(async (w, entree) => {
  const lue = parseStory(await w.lireFichier(entree.story));
  if (!lue.ok) return w.echec(`Story invalide : ${lue.errors.join(" ; ")}`);
  const story = lue.story;
  const slug = slugOf(story.id);
  await w.brancher(`skraft/${slug}`);

  const niveau = levelEffects(await evaluerDifficulte(w, story, entree.auto));

  if (niveau.recherche) await w.phase("RESEARCH", () =>
    essayer(w, { max: niveau.essaisMax }, async (motifs) => {
      await w.agent("skraft-researcher", consigneRecherche(story, slug), { motifs });
      return checkResearch(await w.lireFichier(`.skraft/${slug}/research/research.md`), /* … */);
    }));

  await poserLesQuestionsOuvertes(w, story);

  await w.phase("DESIGN", () =>
    essayer(w, { max: niveau.essaisMax, premiereRevueGarantie: true }, async (motifs) => {   // ADR 0042
      await w.agent("skraft-architect-model", consigneModele(slug), { motifs });
      await w.agent("skraft-architect-decide", consigneDecision(slug), { motifs });
      const porte = checkDesign(await lireConception(w, slug));
      if (porte.length) return porte;                                   // motifs → essai suivant
      return revue(w, "DESIGN", niveau.lentilles);                      // fonction de skraft
    }));
  await ratifier(w, slug);

  await w.phase("DISTILL", () => distiller(w, slug, niveau));
  await w.phase("DELIVER", () => livrer(w, slug, niveau));

  w.informer(rapportFinal(/* … */));
});
```

Tout ce qui n'est pas un appel `w.*` est du **code pur** : conditions, boucles, calculs, et les
portes de skraft (`checkDesign`, `planScenarios`…) appelées directement, avec leurs tests actuels.

## 5. L'API du script

### 5.1 Les appels journalisés

| Appel | Rôle | S'appuie sur |
|---|---|---|
| `w.agent(nom, consigne, { motifs, lectureSeule, gelApresRouge })` | un tour d'un agent **déclaré** ; rend sa sortie validée, ou sa question bloquante | `ctx.agents.run` |
| `w.humain(id, question, options, { detail, texteLibre })` | une décision humaine ; `id` déclaré dans `humains`, profils imposés | `ctx.interactions.request` |
| `w.lireFichier`, `w.listerFichiers`, `w.diff(depuis)` | lire le dépôt | `ctx.workspace` |
| `w.ecrireFichier`, `w.creerDossier` | écrire, borné par les permissions `fs:write` | `ctx.workspace` |
| `w.lancerTests(filtre?)`, `w.lint()`, `w.couverture()`, `w.mutation()` | les preuves (D20) | `ctx.stack`, `ctx.evidence` |
| `w.brancher`, `w.checkpoint`, `w.rembobiner`, `w.commiter` | Git, uniquement via Workspace (D29) | `ctx.git`, `ctx.workspace` |
| `w.geler(motifs)`, `w.gelIntact(empreinte)` | tests gelés (D21) | `ctx.workspace` |
| `w.oublier(agents)` | faire oublier des sessions (§9) | `ctx.agents.forget` |
| `w.phase(nom, fn)`, `w.informer(texte)`, `w.echec(motif)` | phases, affichage, fin | moteur, `ctx.chat` |

`w.lectureSeule` et `gelApresRouge` ne peuvent que **restreindre** l'agent pour un tour. Rien dans
le script ne peut lui donner un outil, une skill ou un droit d'écriture (§8).

### 5.2 Les aides de bibliothèque

Écrites elles-mêmes avec les appels ci-dessus, en code ordinaire, donc lisibles et remplaçables :

- **`w.phase(nom, fn)`** : pose le checkpoint de la phase, exécute `fn`, commite. Si `fn`
  escalade : rembobine au checkpoint, fait oublier les agents qui ont travaillé depuis (ADR 0050,
  désormais automatique, §9), puis pose la question `escalade` (relancer, sauter, abandonner).
  Une phase s'ouvre **une seule fois** : un réessai ne repose pas son checkpoint.
- **`essayer(w, { max, premiereRevueGarantie }, fn)`** : `fn` rend une liste de motifs (vide = ok).
  Tant que le budget le permet, relance `fn` avec les motifs, **sans rembobiner** (ADR 0040) ; à
  épuisement, escalade. Le budget est partagé entre portes et revue (ADR 0042), avec l'essai
  garanti de la première revue.
- **Question bloquante** : quand `w.agent` rend un blocage (`report_blocker`), l'aide pose la
  question `blocage` et relance le même agent avec la réponse.

La **revue** (fils de défauts, arbitrages, ADR 0046) reste une fonction de skraft. Elle deviendra
une bibliothèque partagée si une deuxième extension en a besoin (D14).

### 5.3 Les interruptions

| Cas | Ce que voit le script |
|---|---|
| Tour interrompu (inactivité, plafond de durée ou de coût) | `w.agent` lève `TourInterrompu` ; `essayer` le compte comme un rejet, avec le motif « reprends sans recommencer » |
| Panne d'environnement (D25) | `w.*` lève `PanneEnvironnement` ; `essayer` ne la compte pas et la laisse remonter ; `w.phase` escalade aussitôt |
| Annulation par l'utilisateur | le script s'arrête au prochain appel ; sessions supprimées |
| Script qui lève une autre erreur | tâche en échec, avec l'erreur ; sessions supprimées |

## 6. Le rejeu

### 6.1 Sur le moteur existant

Aucun nouveau moteur. Une seule définition générique, `createWorkflowTask(script)`, implémente le
contrat actuel `TaskDefinition` (`packages/task-engine/src/protocols.ts`) :

| Contrat du moteur | Avec un workflow |
|---|---|
| `state` | le journal : script, entrée, appels et résultats (§10) |
| `transition(state, event)` | ajoute le résultat au journal, **relance le script depuis le début** contre le journal, et rend comme effets les appels nouveaux |
| `runEffect(effect)` | exécute un appel par `ctx`, comme les effets d'aujourd'hui |
| `checkpointBefore` | vrai pour les appels qui écrivent ou lancent un agent (D23) |
| `isTerminal` | le script a rendu, échoué, ou été annulé |
| `phaseOf` | le dernier `w.phase` journalisé |

### 6.2 L'algorithme d'une transition

1. Le résultat reçu est rangé dans l'entrée du journal qui l'attendait.
2. Le script est relancé depuis le début, avec un `w` de rejeu.
3. Chaque appel `w.*` numéro *n* :
   - s'il existe dans le journal **avec le même appel et les mêmes arguments**, rend le résultat
     enregistré (ou relève l'erreur enregistrée) ;
   - s'il existe avec **d'autres** arguments, le rejeu s'arrête : **non-déterminisme** (§6.3) ;
   - s'il n'existe pas, il est inscrit comme « demandé » et ne se résout pas.
4. Quand plus rien ne peut avancer (toutes les promesses en cours sont des appels « demandés »), la
   transition rend ces appels comme effets. Plusieurs appels demandés ensemble (`Promise.all` sur
   les lentilles d'une revue) donnent plusieurs effets ; leurs résultats sont rangés **par numéro
   d'appel**, pas par ordre d'arrivée, ce qui garde le rejeu déterministe.
5. Si le script rend, c'est la fin de la tâche.

### 6.3 Conformité avec les décisions

- **D16** (« réducteur pur + runner d'effets ; le LLM ne choisit jamais la transition ») : si le
  script est déterministe, l'étape suivante est une fonction pure du script et du journal. C'est un
  réducteur dont l'état est le journal. ADR 0052.
- **D23** (checkpoint avant chaque effet, effet interrompu rejoué depuis son checkpoint) :
  inchangé, c'est le moteur actuel qui s'en charge.
- **D24** (budget appliqué par le code) : `essayer` compte, pas le LLM.
- **D25** : la panne d'environnement escalade sans consommer le budget (§5.3).

### 6.4 Le déterminisme

Le rejeu n'est correct que si le script fait la même chose à chaque passage. Le fichier tourne dans
le processus isolé de l'extension (D9), avec retirés ou figés : `Date`, `Math.random`, `crypto`,
`setTimeout`, `setInterval`, `fs`, le réseau, `process`. Seuls sont importables les modules de
l'extension et `@agent-studio/workflow`.

Ce qui échapperait quand même est **détecté** : l'appel rejoué ne correspond plus au journal, et la
tâche s'arrête en le disant, au lieu de diverger en silence.

### 6.5 La version du script

Le journal porte l'**empreinte** du fichier de workflow. Une extension mise à jour pendant qu'une
tâche est en cours : la tâche refuse de reprendre avec le nouveau script et propose de la terminer
avec l'ancien (conservé tant qu'une tâche l'utilise) ou de l'abandonner.

### 6.6 Le coût

Chaque transition rejoue le script depuis le début : O(n) par transition, O(n²) sur la tâche. Pour
quelques centaines d'appels et du code pur, c'est négligeable. Les fonctions pures coûteuses
(`checkDesign` sur de gros documents) sont recalculées à chaque rejeu ; à mesurer, et à mettre en
cache par empreinte d'entrée si besoin.

## 7. Le lien vers le LLM

Le script n'appelle **que** `w.agent(...)`. Tout ce qui est en dessous existe déjà et ne change pas :

```
script :  await w.agent("skraft-researcher", consigne)
   │  1. absent du journal → effet { appel: "agent", role, consigne }
   ▼
moteur de tâches : checkpoint Git (D23), puis runEffect
   │  2. ctx.agents.run(role, consigne)                   (même appel qu'aujourd'hui)
   ▼
extension-host : RPC du processus isolé vers le processus principal
   ▼
cœur : session construite à partir du MANIFESTE
   │   prompt .agent.md + contrat d'exécution ajouté en dernier (ADR 0024)
   │   skills injectées, outils, périmètre d'écriture, classe de modèle (ADR 0048)
   │   gardes (hooks), tests gelés, watchdog, plafonds de durée et de coût
   ▼
port AgentRuntime → adaptateur Copilot SDK → Copilot CLI → LLM
   │  3. le LLM termine par son outil de sortie (report_phase…), schéma validé par le code
   ▼
résultat sérialisé (jamais une session, D10) → événement → journal → rejeu
   ▼
script :  l'await rend le résultat, le script continue
```

Au rejeu, `w.agent` rend le résultat journalisé **sans appeler le LLM**. Seul l'appel en cours au
moment d'un crash est refait (D23).

## 8. Skills et outils d'un agent

Ils se déclarent **dans le manifeste, agent par agent**, comme aujourd'hui :

```ts
{
  name: "skraft-test",
  prompt: "agents/skraft-test.agent.md",
  output: "report_phase",
  modelClass: "standard",
  write: ["@stack:unitTests"],
  tools: ["list_files", "run_tests", "run_lint", "report_blocker"],
  skills: {
    mandatory: ["test-design-mandates", "outside-in-tdd#RED"],               // injectées dans la session
    onDemand:  ["test-refactoring-catalog", "clean-architecture-testing"],   // load_skill, tracé (D26)
  },
  memoire: "tache",
}
```

- `nom#Titre` n'injecte qu'une section d'une skill.
- Outil propre à l'extension : déclaré dans `contributes.tools`, implémenté par `ctx.tools.register`.
- **Une autre combinaison pour une étape** : on déclare un agent de plus, qui peut réutiliser le
  même fichier de prompt.

Le script ne choisit **jamais** les skills ni les outils d'un agent :

- la sécurité se vérifie à l'installation (D11) ; des droits donnés à la volée la videraient de
  son sens ;
- les skills obligatoires sont injectées à la **création** de la session ; on ne peut pas les
  changer dans une session ouverte.

La contrepartie : un autre nom d'agent, c'est une autre session, donc une autre mémoire.

| Besoin | Moyen |
|---|---|
| compétences différentes, sans mémoire partagée | un agent de plus dans le manifeste |
| même mémoire, compétence en plus selon le moment | une skill `onDemand` sur le même agent |

## 9. Sessions et mémoire

Décisions : ADR 0053. Elles précisent D17 et complètent les ADR 0039 et 0050.

### 9.1 Les règles

| Situation | Session |
|---|---|
| tour suivant du même agent, `memoire: "tache"` (défaut, ADR 0039) | gardée |
| agent `memoire: "tour"` | neuve à chaque appel |
| tour coupé par un plafond de durée, de coût ou de contexte (ADR 0030) | neuve |
| le script appelle `w.oublier(...)` | neuve au prochain appel |
| `w.rembobiner()` (et l'escalade de `w.phase`) | neuve pour **tous les agents qui ont travaillé depuis le checkpoint** |
| crash, redémarrage, **ou fermeture normale** de l'application | **toutes supprimées** ; tout le monde repart neuf |
| fin de tâche, quelle que soit l'issue | toutes supprimées |

### 9.2 Pourquoi tout effacer après un crash

Le tour en cours au moment du crash est rembobiné (D23), mais la session Copilot contient déjà ses
appels d'outils, et le SDK ne sait pas tronquer une conversation. Reprendre la session donnerait
un agent qui se souvient de fichiers effacés : l'incohérence que l'ADR 0050 corrige.

La fermeture normale est traitée comme un crash : une seule règle, et pas de sessions qui traînent
pendant une attente humaine de plusieurs jours. Le prix : l'agent relit le dépôt après la pause.

**Conséquence pour les auteurs** : la mémoire est un confort pour corriger vite, jamais une
condition pour avoir raison. Toute consigne et tout dossier de passation (§6.6 de la SPEC) doivent
suffire à un agent qui repart de zéro.

### 9.3 Ce que ça corrige dans le code actuel

- **Rien ne se déclare** aujourd'hui : la rétention est codée en dur dans le cœur, la même pour
  tous. → `memoire` dans le manifeste.
- **Sessions orphelines après un crash** : le lien rôle → session ne vit que dans une `Map` en
  mémoire (`reprenables`, `packages/core/src/agents/task-agent-runner.ts`). Après un crash, plus
  personne ne connaît les identifiants, et les sessions restent sur le disque côté Copilot CLI.
  → identifiants persistés avec la tâche (§10), suppression au redémarrage. Ce défaut existe
  indépendamment des workflows et peut être corrigé avant.
- **L'extension doit lister elle-même les rôles à oublier** (`phaseRoles`), et l'ADR 0050 est né
  d'un oubli dans cette liste. → `w.rembobiner()` sait, par le journal, qui a travaillé depuis le
  checkpoint.

## 10. Le fichier de tâche

L'enveloppe `TaskRecord` ne change pas (`id`, `name`, `status`, `phase`, `pending`, `inflight`,
dates). C'est `state` qui devient un journal :

```jsonc
{
  "id": "t-7f3a", "name": "agent-studio.skraft/livrer-story",
  "status": "waiting", "phase": "DESIGN",
  "createdAt": "2026-10-05T09:12:00Z", "updatedAt": "2026-10-05T09:47:31Z",
  "inflight": null,
  "pending": [],

  "state": {
    // 1. Quel script, dans quelle version (§6.5).
    "script": { "extension": "agent-studio.skraft", "version": "0.2.0", "empreinte": "sha256:9c1e…" },

    // 2. L'entrée fournie par l'utilisateur.
    "entree": { "story": "stories/us-2.md", "auto": false },

    // 3. Le journal : chaque appel vers la plateforme, dans l'ordre, avec son résultat.
    "journal": [
      { "n": 1, "appel": "lireFichier", "args": { "chemin": "stories/us-2.md" }, "resultat": { "contenuRef": "sha256:41ab…" } },
      { "n": 2, "appel": "brancher",    "args": { "nom": "skraft/us-2" },        "resultat": { "baseSha": "d20a9a0" } },
      { "n": 3, "appel": "agent",       "args": { "nom": "skraft-classifier", "consigneRef": "sha256:…" },
                                         "resultat": { "sortie": { "level": "medium", "justification": "…" } } },
      { "n": 4, "appel": "humain",      "args": { "id": "confirmer-difficulte", "options": ["…"] },
                                         "resultat": { "decision": "medium", "par": "user" } },
      { "n": 5, "appel": "phase",       "args": { "nom": "DESIGN" } },
      { "n": 6, "appel": "checkpoint",  "args": { "nom": "DESIGN" },             "resultat": { "id": "cp-12" } },
      { "n": 7, "appel": "agent",       "args": { "nom": "skraft-architect-model", "consigneRef": "sha256:…" },
                                         "resultat": { "sortie": { "summary": "…", "files": ["…"] } } },
      // … porte, revue, ratification …
      { "n": 14, "appel": "humain",     "args": { "id": "ratifier-adr", "question": "Ratifier ADR-0007 ?" } }
      // sans résultat : c'est ce qu'on attend, d'où status = "waiting"
    ],

    // 4. Les sessions ouvertes, pour les supprimer au redémarrage ou à la fin (§9).
    "sessions": [
      { "agent": "skraft-architect-model",  "id": "copilot-5e1…", "depuis": 7 },
      { "agent": "skraft-architect-decide", "id": "copilot-a09…", "depuis": 9 }
    ],

    // 5. Les checkpoints, et les agents qui ont travaillé depuis chacun.
    "checkpoints": [ { "id": "cp-12", "nom": "DESIGN", "apres": 6, "agents": ["skraft-architect-model", "skraft-architect-decide"] } ]
  }
}
```

| Partie | Sert à |
|---|---|
| `script` | refuser de rejouer avec un autre script que celui qui a écrit le journal |
| `entree` | relancer le script depuis le début |
| `journal` | rejouer jusqu'au bon endroit ; c'est aussi l'historique lisible de la tâche |
| `sessions` | tout supprimer au redémarrage ou à la fin, sans orphelin |
| `checkpoints` | rembobiner et faire oublier exactement les bons agents |
| `inflight` (enveloppe) | crash pendant un appel : retour à son checkpoint, et l'appel est refait |
| `phase`, `status` (enveloppe) | la carte de tâche, sans rien exécuter |

**Ce qui n'y est pas :**

- aucune transcription d'agent : seulement la sortie validée par son outil de sortie (les
  conversations restent dans les sessions, la trace de l'ADR 0032 reste un fichier à part) ;
- aucune variable du script : elles se recalculent en rejouant ;
- aucun gros contenu en clair : fichiers lus, consignes, rapports de tests vont dans un **magasin
  de contenus** indexé par empreinte (`contenuRef`). Un même fichier lu dix fois n'est stocké
  qu'une fois.

**Les fonctions pures ne sont pas journalisées** (elles se recalculent à l'identique) ; leurs
**entrées** le sont, puisqu'elles viennent d'appels `w.*` comme `w.lireFichier`.

Le schéma d'état propre à skraft (`model.ts`, validé par Zod à chaque chargement) est remplacé par
**un schéma de journal unique**, commun à toutes les extensions.

## 11. Sécurité

Le script orchestre ; il n'a **aucun pouvoir de plus** qu'une extension aujourd'hui.

- Il ne voit ni session, ni objet du SDK (D10, règle n°1) : seulement des résultats sérialisés.
- Il n'appelle que des agents et des questions **déclarés** dans le manifeste.
- Il ne peut que **restreindre** un agent pour un tour (`lectureSeule`, `gelApresRouge`).
- Les invariants restent garantis par le cœur, quoi que fasse le script : périmètres d'écriture,
  tests gelés, preuves produites seulement par `run_tests` (D20), aucun Git ni shell pour l'agent,
  gardes en refus par défaut (D28).
- Pendant une tâche, le fichier de workflow, `quality.yaml` et `stack.yaml` sont gelés : aucun
  agent ne peut affaiblir le contrôle qu'on lui applique.

## 12. Ce qui change dans skraft

| Part | Devenir |
|---|---|
| `reducer.ts`, `deliver-machine.ts`, schéma d'état de `model.ts` (≈ 1 100 lignes) | **remplacés** par le script |
| `effects.ts`, `deliver-effects.ts` | **réduits** à de petites fonctions du script, qui appellent `w.*` au lieu de `ctx.*` |
| portes (`research`, `design`, `gherkin`, `distill`, `deliver`), `story`, `difficulty`, `review`, `review-thread`, `adr`, `brief` | **inchangés**, avec leurs tests |
| `manifest.ts` | `contributes.workflows` au lieu de `contributes.tasks`, plus `memoire` par agent |
| agents et skills en Markdown | inchangés |

Ces chiffres sont une **estimation**. La réécriture de RESEARCH (§14, étape 4) dira si le script
est vraiment plus court et plus lisible ; sinon on s'arrête.

L'extension `tdd` suit le même chemin, une fois skraft migrée.

## 13. Écarts de comportement à trancher pendant la migration

Repérés en décrivant skraft en YAML. Ce sont des questions sur **ce que fait skraft**,
indépendantes du format. Chacune se tranche quand la phase concernée est migrée, avec un ADR si la
réponse change le comportement. Tant qu'elle ne l'est pas, le workflow reproduit **le code actuel**.

| # | Écart | Code actuel |
|---|---|---|
| 1 | Contrôle propre de `skraft-architect-model` (`domain-model.md` présent) | les deux architectes sont jugés ensemble |
| 2 | Budget d'essais partagé entre portes et revue | partagé (ADR 0042), avec essai garanti de la première revue |
| 3 | Un amendement d'ADR relance-t-il aussi la modélisation ? | non : seulement `skraft-architect-decide`, sans consommer le budget |
| 4 | Classifieur borné à un cran de la grille | non borné ; `--auto` applique son niveau tel quel |
| 5 | Grille de difficulté réglable | non (`DEFAULT_THRESHOLDS`) |
| 6 | Story fournie par le chat | fichier seulement |
| 7 | `creation-seule: ["docs/adr/**"]` à la place de l'outil `render_adr` | outil `render_adr` |
| 8 | Lentilles de DESIGN | celles du niveau, moins `quality-gates` (`lensesForPhase`) ; en `simple` : `cold-reader`, `test-integrity` |
| 9 | Correction d'un défaut maintenu par arbitrage humain | faite même budget épuisé |
| 10 | Options de confirmation de la difficulté | le niveau proposé et ses deux voisins (`shift ±1`) |
| 11 | Relances du classifieur | jusqu'à `maxAttemptsPerPhase` (3 avant que la difficulté soit connue) |
| 12 | Présélection de fichiers pour la recherche (`preselect.ts`) | placée dans le dossier de passation |
| 13 | Messages de commit | `docs(skraft): <phase> de <slug>`, `feat(<slug>): livraison de la story` |
| 14 | Ratification | toutes les questions posées en même temps |
| 15 | Tour interrompu, question bloquante | motif « reprends sans recommencer » ; question puis reprise du même agent |

## 14. Plan

Chaque étape a son critère de sortie ; on ne passe pas à la suivante sans lui.

1. **Documentation** (cette branche) : ce document, ADR 0052 et 0053, retrait de l'approche YAML.
2. **Sessions orphelines** (`fix/`, indépendant des workflows) : identifiants de session persistés,
   suppression au redémarrage et à la fermeture. *Sortie* : un test du cœur simule un crash avec
   des sessions ouvertes et vérifie qu'au redémarrage le runtime a reçu `deleteSession` pour
   chacune.
3. **Moteur rejouable** (`packages/workflow`, TDD, sans LLM) : `createWorkflowTask`, `w` de rejeu,
   magasin de contenus, `w.phase`, `essayer`, `memoire` dans le manifeste. *Sortie* : tests du
   rejeu — même effet suivant après rejeu ; reprise au bon endroit après crash simulé ;
   non-déterminisme détecté et arrêté ; script modifié refusé ; appels parallèles rangés par
   numéro ; `w.rembobiner` fait oublier exactement les agents depuis le checkpoint.
4. **Preuve sur skraft : RESEARCH en workflow**. *Sortie* : `e2e-s2` et `research-gate` passent
   **sans modification** ; comparaison de taille et de lisibilité avec la partie de `reducer.ts`
   remplacée. Si ce n'est pas nettement plus simple, on s'arrête.
5. **DESIGN, puis DISTILL, puis DELIVER**, chacun avec ses tests de bout en bout inchangés et les
   écarts du §13 qui le concernent tranchés. `reducer.ts` et `deliver-machine.ts` ne sont supprimés
   qu'à la fin.
6. **`tdd`**, puis retrait de `contributes.tasks` si plus personne ne l'utilise.

## 15. Risques et questions ouvertes

- **Taille du journal** : quelques centaines d'entrées par story, acceptable grâce au magasin de
  contenus ; à mesurer sur US-2.
- **Coût du rejeu** des fonctions pures lourdes (§6.6) : à mesurer.
- **Déterminisme des dépendances** : une bibliothèque importée par le script qui lit l'heure ou le
  hasard serait détectée au rejeu, mais tard. Les imports autorisés sont limités (§6.4).
- **API publique** : `@agent-studio/workflow` fait partie de l'API `ctx` versionnée (D13) ; elle
  ne se fige qu'après deux extensions réelles migrées (D14).
- **D15** (JavaScript/TypeScript seul, OUVERT) : le workflow est en JavaScript ; rien ne change
  pour cette question.
- **Téléversement par l'interface** : hors périmètre. Une fonctionnalité reste une extension ; un
  script JavaScript n'a pas besoin de compilation. À reconsidérer seulement si des
  non-développeurs doivent créer des fonctionnalités.
