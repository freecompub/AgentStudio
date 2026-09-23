# SPEC — Application chat agentique extensible (nom de code : `agent-studio`)

> Document de référence pour démarrer le développement avec Claude Code.
> Il consolide la vision, toutes les décisions prises, l'architecture cible, le modèle d'extension,
> le moteur de tâches, les deux premières extensions (TDD et skraft) et la feuille de route.
> Version : 2026-09-23. Auteur : Samir.

---

## 0. Consignes pour Claude Code

1. **Lis ce document en entier avant d'écrire du code.** Les sections se répondent.
2. **Les décisions marquées `DÉCIDÉ` (section 3) ne se rediscutent pas pendant l'implémentation.** Si une décision te semble bloquante ou fausse, arrête-toi et pose la question au lieu de la contourner.
3. **Les décisions marquées `OUVERT` ne doivent pas être tranchées silencieusement.** Implémente derrière une interface ou une option de configuration, et signale le choix provisoire.
4. **Commence par le jalon J1 (section 14)**, dans l'ordre. Chaque jalon a des critères de sortie vérifiables : ne passe au suivant que lorsqu'ils sont tous remplis.
5. **Travaille en TDD** : un test qui échoue, le code minimal, le refactor. Le moteur de tâches et les réducteurs sont des fonctions pures, testables sans LLM, sans Git et sans disque.
6. **Consigne chaque décision technique nouvelle dans un ADR** sous `docs/adr/NNNN-titre.md` (format : contexte, décision, conséquences, statut).
7. **Vérifie les API des SDK sur la version installée** avant de t'y fier. Les points signalés `À VÉRIFIER` (section 15) ont été constatés sur une version donnée et peuvent avoir changé.
8. **Deux fichiers de référence accompagnent ce document** : `reference/tdd-orchestrator.ts` (machine à états TDD complète, compilée en TypeScript strict) et `reference/copilot-agents.ts` (adaptateur Copilot SDK : sessions par rôle, garde de périmètre, outils terminaux). Ce sont des prototypes à reprendre et découper, pas du code de production.
   La spécification détaillée de l'extension skraft est dans `SPEC-skraft.md`.
9. **Ne jamais exposer un objet du SDK à une extension** (voir D7). C'est la règle de sécurité la plus importante du projet.

---

## 1. Vision

Une **application de bureau locale** qui offre une interface de chat au-dessus d'un runtime d'agent IA (d'abord le **Copilot SDK**), et que l'on peut **augmenter par des extensions**, comme VS Code. Une extension apporte des commandes utilisables dans le chat (`/tdd`, `/skraft`), des agents et des skills nommés, des outils, des panneaux et des workflows longs.

Le principe directeur de tout le projet :

> **Le LLM propose, le code décide et vérifie.**
> Les workflows critiques sont des machines à états déterministes. Les agents produisent des artefacts ; des portes exécutées par le code les vérifient avant toute transition.

### 1.1 Publics

| Profil | Besoin principal |
| --- | --- |
| Testeur | Lancer et comprendre des tâches de test, lire des bilans |
| PO / BA | Rédiger et affiner des stories, suivre l'avancement |
| Développeur | Piloter des workflows de développement, voir le détail technique |
| Architecte | Ratifier les décisions d'architecture, revoir les conceptions |

Deux niveaux de lecture de l'interface servent ces publics : **mode simple** (non-développeurs) et **mode avancé** (développeurs). Voir section 11.

### 1.2 Hors périmètre (pour l'instant)

Marketplace en ligne, synchronisation multi-postes, édition collaborative, web app hébergée.

---

## 2. Glossaire

| Terme | Définition |
| --- | --- |
| Runtime d'agent | Ce qui exécute un agent LLM avec ses outils : Copilot SDK, Claude Agent SDK, agent ACP… |
| Session principale | La conversation visible par l'utilisateur, longue et persistante |
| Session de tâche | Une session éphémère ouverte par le code pour un rôle précis (agent test, agent dev…) |
| Extension | Paquet tiers signé qui contribue commandes, agents, skills, outils, panneaux, tâches |
| Hôte d'extensions | Processus isolé qui exécute une extension et lui expose l'API `ctx` |
| `ctx` | Seule API visible par une extension ; tous les appels sont tracés et arbitrés |
| Tâche | Workflow long, déterministe et reprenable, décrit par un réducteur pur |
| Réducteur | Fonction pure `transition(state, event) → { state, effects }` |
| Effet | Action à exécuter par le runner (lancer un agent, vérifier, commit, rollback, demander à l'humain) |
| Porte | Vérification exécutée par le code entre deux états (jamais par un LLM) |
| Outil terminal | Outil dont l'appel réussi termine le tour de l'agent ; sert de contrat de sortie structurée |
| Dossier de passation | Contexte explicite transmis à une nouvelle session (plan, étape, résumés, motif de rejet) |
| Checkpoint | SHA Git enregistré avant un effet, point de retour garanti |
| Adaptateur de stack | Module qui sait lancer les tests, lire leur rapport, lancer la mutation et analyser l'architecture pour un langage |

---

## 3. Registre des décisions

### 3.1 Produit et plateforme

| # | Décision | Statut | Justification |
| --- | --- | --- | --- |
| D1 | Application **locale** sur le poste de l'utilisateur, pas de web app hébergée | DÉCIDÉ | Accès direct aux dépôts, au shell et aux outils de test |
| D2 | Stack **Electron** (TypeScript) | DÉCIDÉ | Écosystème Node du Copilot SDK, `utilityProcess` pour isoler les extensions |
| D3 | Premier runtime : **Copilot SDK** (`@github/copilot-sdk`), qui pilote le binaire Copilot CLI en JSON-RPC | DÉCIDÉ | Abonnement Copilot de l'utilisateur, SDK riche (hooks, outils, permissions) |
| D4 | Authentification GitHub via **GitHub CLI** (`gh auth login`), plutôt qu'une OAuth App ou `copilot login` | DÉCIDÉ | Réutilise un outil standard, jetons gérés hors de l'application |
| D5 | Interface pensée pour **non-développeurs et développeurs** : mode simple et mode avancé | DÉCIDÉ | Public mixte (section 1.1) |
| D6 | **Un utilisateur ne peut pas changer lui-même de profil** (rôle) ; le profil est attribué par un administrateur | DÉCIDÉ | Règle produit |
| D7 | Gestion Git **simplifiée** intégrée : connexion au dépôt, clonage, push, synchronisation, checkpoints, annulation | DÉCIDÉ | Les non-développeurs doivent pouvoir travailler sans connaître Git |

### 3.2 Extensions

| # | Décision | Statut | Justification |
| --- | --- | --- | --- |
| D8 | Système d'extensions **à la VS Code**, extensions écrites par des **tiers / la communauté** | DÉCIDÉ | Écosystème ouvert |
| D9 | **Un processus par extension** (`utilityProcess.fork()`), jamais dans le renderer ni dans le processus principal | DÉCIDÉ | Code tiers non fiable ; un plantage n'emporte ni l'UI ni le cœur |
| D10 | L'extension ne voit que l'API **`ctx`** ; **aucun objet du SDK ne lui est jamais exposé** | DÉCIDÉ | Exposer une session permettrait de contourner hooks, permissions et périmètres |
| D11 | Manifeste déclaratif avec **permissions contraignantes** : une capacité non déclarée est refusée même si l'utilisateur l'autorise | DÉCIDÉ | Surface d'attaque connue à l'installation |
| D12 | Capacités **nommées et adressables** (`<extension>/<nom>`, alias court sans collision) dans un **registre unique** | DÉCIDÉ | Commandes, agents, skills et outils invocables par leur nom |
| D13 | Paquets **signés**, API `ctx` en **semver** (`engines.appApi`), **liste de révocation** signée dès la première version publique | DÉCIDÉ | Distribution à des tiers |
| D14 | La **version 1.0 publique de l'API** ne sort qu'après au moins deux extensions réelles (TDD puis skraft) écrites en interne | DÉCIDÉ | Éviter de figer une API immature |
| D15 | Langage des extensions : **JavaScript/TypeScript seul** au départ | OUVERT | Un protocole RPC ouvert à d'autres langages est possible plus tard |

### 3.3 Orchestration et contrôle

| # | Décision | Statut | Justification |
| --- | --- | --- | --- |
| D16 | **Orchestrateur déterministe** : réducteur pur + runner d'effets. Le LLM ne choisit jamais la transition suivante | DÉCIDÉ | Contrôle positif ; les hooks seuls ne font qu'un contrôle négatif (leçon de skraft-plugin) |
| D17 | **Une session neuve par phase ou par rôle**, avec un **dossier de passation** explicite construit par le code | DÉCIDÉ | Contexte propre, prévisible, débogable ; réessais sans pollution |
| D18 | Sorties des agents par **outils terminaux** à schéma (`report_phase`, `submit_plan`, `submit_verdict`, `submit_difficulty`, `report_blocker`) | DÉCIDÉ | Contrat structuré entre LLM et code, pas de parsing de texte libre |
| D19 | **Portes vérifiées par le code** : exécution des tests, diff Git, empreintes des fichiers de test, périmètres d'écriture | DÉCIDÉ | Seule garantie indépendante du modèle et du runtime |
| D20 | **Preuves produites par le code** : l'agent n'exécute jamais les tests lui-même, il appelle l'outil `run_tests` dont le handler est notre code | DÉCIDÉ | Preuves infalsifiables par l'agent |
| D21 | **Tests gelés par empreinte** : l'agent dev ne peut jamais modifier un test ; toute suppression de test est une proposition soumise à validation | DÉCIDÉ | Intégrité du TDD |
| D22 | **Granularité réglable** : par défaut un tour d'agent par scénario (contrôle par outils et hooks dans le tour) ; sessions séparées RED / GREEN / REFACTOR en option | DÉCIDÉ | Environ une requête par scénario au lieu de neuf, sans perdre les garanties |
| D23 | **Checkpoint Git avant chaque effet** ; tout effet interrompu est rejoué depuis son checkpoint, jamais « récupéré » | DÉCIDÉ | Reprise fiable après crash, veille ou fermeture |
| D24 | **Budget de réessais appliqué par le réducteur**, rollback avant chaque essai, relance ciblée avec le motif précis ; escalade vers l'humain à épuisement | DÉCIDÉ | L'arrêt ne dépend pas de l'obéissance du LLM |
| D25 | Distinction **défaut de travail** (réessai) / **défaut d'environnement** (escalade immédiate) | DÉCIDÉ | Ne pas brûler le budget sur un outil absent ou une API indisponible |
| D26 | **Skills obligatoires injectées** dans la configuration de session ; skills facultatives via un outil `load_skill` tracé ; le contrôle porte sur **l'application** des règles (effets vérifiables), pas sur la lecture | DÉCIDÉ | Remplace le contrôle G3 de skraft par une garantie par construction |

### 3.4 Sécurité, permissions, interaction

| # | Décision | Statut | Justification |
| --- | --- | --- | --- |
| D27 | **Arbitre de permissions unique** dans le processus principal ; un seul `onPermissionRequest` et une seule chaîne de hooks par session, composés par le cœur | DÉCIDÉ | Point d'arbitrage unique, traçable |
| D28 | Chaîne de hooks : exécution en série, **le premier refus l'emporte**, délai maximal par hook, et **refus par défaut** en cas d'exception ou de délai pour les gardes de sécurité | DÉCIDÉ | Côté SDK, une exception de hook reprend le comportement par défaut : un refus qui plante deviendrait une autorisation |
| D29 | Le service **Workspace** est le seul à toucher le disque et Git ; les extensions passent par lui | DÉCIDÉ | Retour arrière toujours possible |
| D30 | Pas de délai fixe sur le travail des agents : **surveillance d'inactivité** (événements de session, progression des outils longs) | DÉCIDÉ | Un agent qui travaille ne doit pas être coupé |
| D31 | **Jamais d'attente bloquante sur l'humain** : les décisions longues sont des **demandes d'interaction persistées** ; en session de tâche, pas de `ask_user`, mais l'outil terminal `report_blocker` | DÉCIDÉ | Un tour ouvert pendant des heures expire |
| D32 | Communication vers l'utilisateur en trois canaux : `ctx.chat` (immédiat), handlers SDK (questions d'agent en session interactive), demandes d'interaction persistées (décisions longues) | DÉCIDÉ | Voir section 7 |
| D33 | Progression : **une carte de tâche mise à jour en place**, des **jalons**, des **alertes** ; messages générés depuis les états déclarés dans le manifeste ; jamais injectés dans le contexte du LLM | DÉCIDÉ | Lisibilité et économie de tokens |
| D34 | Les extensions ne rendent que du **markdown assaini** et des **types de cartes déclarés** ; elles ne peuvent pas imiter une demande de permission | DÉCIDÉ | Anti-hameçonnage |

### 3.5 Portabilité et coûts

| # | Décision | Statut | Justification |
| --- | --- | --- | --- |
| D35 | Port **`AgentRuntime`** avec déclaration de capacités ; adaptateurs : Copilot SDK (J1), puis Claude Agent SDK, puis client ACP | DÉCIDÉ (port) / OUVERT (ordre des adaptateurs suivants) | Généraliser à d'autres IA sans toucher au cœur |
| D36 | Contrôle en deux couches : **prévention** (hooks, permissions — dépend du runtime) et **détection** (portes — indépendantes) ; sans hooks, le moteur renforce la détection après chaque tour | DÉCIDÉ | Dégradation propre sur un runtime moins riche |
| D37 | **Instrumentation de l'usage** par état de machine (tokens, requêtes, réessais), affichée dans l'unité du fournisseur | DÉCIDÉ | Chiffrer les économies au lieu de les estimer |
| D38 | Choix du **modèle par rôle** (fort pour conception et revues, léger pour tâches mécaniques) et **politique de fournisseur par projet** | OUVERT | Coût et confidentialité |
| D39 | Nom définitif de l'application | OUVERT | « Copilot Studio » est déjà un produit Microsoft : à éviter |

### 3.6 Extension skraft

| # | Décision | Statut | Justification |
| --- | --- | --- | --- |
| D40 | skraft est porté comme **extension**, avec son pipeline RESEARCH → DESIGN → DISTILL → DELIVER piloté par notre réducteur | DÉCIDÉ | Voir section 9 |
| D41 | Réutiliser ses 22 prompts d'agents, 36 skills, politiques pures de `domain/`, schéma de preuves et commande `artifact adr` **après unification du modèle d'état** | DÉCIDÉ (sous réserve D42) | Méthode riche, mécanisme de contrôle défaillant |
| D42 | Compatibilité de la licence **GPL-3.0-or-later** de skraft avec la distribution de l'extension | OUVERT | À valider avant toute reprise de code ou de prompts |

---

## 4. Architecture

### 4.1 Modèle de processus

```mermaid
flowchart TD
  R["Renderer<br/>interface, aucun accès Node"] -->|IPC validé| M["Processus principal<br/>cœur de confiance"]
  M -->|MessagePort, RPC bridé| E1["Hôte d'extension A<br/>utilityProcess"]
  M -->|MessagePort, RPC bridé| E2["Hôte d'extension B<br/>utilityProcess"]
  M -->|JSON-RPC via le SDK| C["Runtime d'agent<br/>Copilot CLI"]
```

| Processus | Contenu | Confiance | Isolation |
| --- | --- | --- | --- |
| Renderer | Chat, cartes, panneaux, diff | Code de l'application | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP stricte |
| Principal | Registre, routeur, sessions, moteur de tâches, arbitre, Workspace, bus d'événements, client SDK | Totale | Seul à écrire sur le disque et à appeler le SDK |
| Hôte d'extension | Une extension | Nulle | `utilityProcess.fork()`, modèle de permissions Node (`--permission`, lecture limitée au dossier de l'extension), budget mémoire, délai par appel |
| Runtime d'agent | Binaire lancé par le SDK | Fournisseur | Jamais exposé aux extensions |

Règles de communication :
- Renderer ↔ principal : preload minimal, canaux nommés via `contextBridge`, validation de schéma (taille, forme, origine) de chaque message côté principal.
- Principal ↔ extension : requête/réponse avec identifiant d'appel, délai maximal, annulation ; les opérations longues passent par des messages asynchrones.
- Redémarrage d'un hôte d'extension : au plus trois fois par heure, puis désactivation de l'extension pour la session, avec message à l'utilisateur nommant l'extension.

### 4.2 Services du cœur (processus principal)

| Service | Responsabilité |
| --- | --- |
| Registre des capacités | Indexe par nom commandes, agents, skills, outils, panneaux, tâches, serveurs MCP. Seule source pour composer une session |
| Routeur d'intention | `/commande` → handler d'extension ; `@agent` → session de tâche ; texte libre → session principale enrichie ; action de panneau → handler |
| Gestionnaire de sessions | Session principale (persistante, reprise au lancement) ; sessions de tâche (éphémères, fermées puis supprimées) ; limite de parallélisme ; purge des sessions orphelines au démarrage |
| Moteur de tâches | Exécute les réducteurs des extensions : persistance, effets, reprise, annulation, délais, budget |
| Arbitre de permissions | Manifeste → règles utilisateur → politique par profil → demande à l'écran. Fournit l'unique `onPermissionRequest` et compose les hooks |
| Workspace | Lecture/écriture sous la racine du projet, commandes, checkpoints, diff, commit, rollback, branches |
| Bus d'événements et journal | Timeline unique : messages, appels d'outils, transitions, vérifications, décisions de permission ; sert à l'affichage, la reprise, l'audit, le bilan |
| Interactions | Demandes d'interaction persistées, liste « En attente de vous », notifications système |
| Usage | Compteurs par tâche et par état : tokens, requêtes, réessais, durée |

### 4.3 Port `AgentRuntime`

Le cœur ne dépend jamais directement d'un SDK. Chaque runtime est un adaptateur.

```ts
export interface AgentRuntime {
  id: "copilot-sdk" | "claude-agent-sdk" | "acp";
  capabilities: {
    inProcessHooks: boolean;                          // hooks en code avant/après outil
    customTools: "native" | "mcp";                    // comment fournir run_tests, report_phase…
    terminalTool: "native" | "stop-hook" | "reprompt";// comment forcer la sortie structurée
    fileMediation: boolean;                           // les écritures passent-elles par nous ?
    usageUnit: "requests" | "tokens";
  };
  start(): Promise<void>;
  openSession(cfg: AgentSessionConfig): Promise<AgentSession>;
  deleteSession(id: string): Promise<void>;
}

export interface AgentSessionConfig {
  role: string;                         // "tdd-test", "skraft-architect"…
  model?: string;
  workingDirectory: string;
  systemPrompt: string;                 // rôle + skills obligatoires injectées + dossier de passation
  tools: ToolSpec[];                    // outils fournis par notre code
  writablePaths: RegExp[];              // périmètre d'écriture du rôle
  hooks: ComposedHooks;                 // composés par l'arbitre, jamais par l'extension
}

export interface AgentSession {
  id: string;
  send(prompt: string): Promise<void>;  // non bloquant
  onEvent(cb: (e: AgentEvent) => void): () => void;
  abort(): Promise<void>;
  close(): Promise<void>;
}
```

Correspondances connues :

| Besoin | Copilot SDK | Claude Agent SDK | ACP |
| --- | --- | --- | --- |
| Session | `createSession` | un `query()` par phase, reprise par id | `session/new` |
| Outils | `defineTool` | `tool()` + `createSdkMcpServer` | serveur MCP transmis à `session/new` |
| Hooks | `hooks.onPreToolUse`… | callbacks de hooks en processus | aucun ; détection renforcée |
| Permissions | `onPermissionRequest` | `canUseTool`, `permissionMode` | `session/request_permission` |
| Outil terminal | `isTerminal: true` | hook `Stop` qui refuse l'arrêt | relance par nouveau prompt |
| Auth / coût | abonnement Copilot, requêtes | clé API ou cloud (Bedrock, Vertex, Foundry), tokens ; pas de connexion claude.ai pour une app tierce sans accord | selon l'agent |

Seul l'adaptateur Copilot SDK est dans le périmètre des premiers jalons. Les autres restent des interfaces documentées.

### 4.4 Arborescence proposée (monorepo pnpm)

```
agent-studio/
├── apps/
│   └── desktop/                 # Electron : main, preload, renderer
│       ├── src/main/            # bootstrap, IPC, fenêtres
│       ├── src/preload/
│       └── src/renderer/        # UI (framework à choisir, voir OUVERT O7)
├── packages/
│   ├── core/                    # registre, routeur, sessions, arbitre, bus, interactions, usage
│   ├── task-engine/             # réducteurs, runner d'effets, persistance, watchdog
│   ├── workspace/               # fs + Git (checkpoints, diff, rollback)
│   ├── runtime-copilot/         # adaptateur AgentRuntime pour le Copilot SDK
│   ├── extension-host/          # lancement utilityProcess, RPC, cycle de vie
│   ├── extension-api/           # types publics de ctx (publié pour les tiers)
│   ├── extension-manifest/      # schéma JSON du manifeste + validation
│   └── stack-adapters/          # swift, typescript, dotnet : tests, rapport, mutation, architecture
├── extensions/
│   ├── tdd/                     # première extension interne (jalon J2)
│   └── skraft/                  # deuxième extension (jalons S1 à S6)
├── reference/                   # prototypes fournis avec cette spec
└── docs/adr/
```

---

## 5. Modèle d'extension

### 5.1 Manifeste

```jsonc
{
  "id": "diabeo.tdd",
  "version": "1.0.0",
  "publisher": "diabeo",
  "engines": { "appApi": "^0.1" },
  "main": "dist/index.js",
  "activationEvents": ["onCommand:tdd", "onAgent:tdd-test"],
  "permissions": [
    "fs:read",
    "fs:write:src/**", "fs:write:tests/**",
    "git:commit", "shell:test",
    "copilot:sessions",
    "net:none"
  ],
  "contributes": {
    "commands": [{ "name": "tdd", "title": "Implémenter en TDD", "handler": "runTdd" }],
    "agents":   [{ "name": "tdd-test", "role": "roles/test.md", "tools": ["run_tests", "report_phase"], "write": ["tests/**"] }],
    "skills":   [{ "name": "tdd-cycle", "path": "skills/tdd-cycle", "mandatoryFor": ["tdd-test", "tdd-dev"] }],
    "tools":    [{ "name": "verify_red", "handler": "verifyRed", "description": "Vérifie qu'un test échoue pour la bonne raison" }],
    "panels":   [{ "id": "tdd.progress", "title": "Progression TDD" }],
    "tasks": [{
      "name": "tdd-cycle",
      "handler": "tddTask",
      "states":     { "RED": "Écriture du test", "GREEN": "Écriture du code", "REFACTOR": "Nettoyage" },
      "milestones": ["STEP_DONE", "DONE"],
      "alerts":     ["RETRY", "TIMEOUT", "ESCALATED"]
    }]
  }
}
```

Le schéma JSON du manifeste vit dans `packages/extension-manifest` et est validé à l'installation et au démarrage. Toute extension doit fournir, pour chaque action visible, un **titre court et une description en langage naturel** (critère d'entrée au registre, D5).

### 5.2 Permissions

| Permission | Effet |
| --- | --- |
| `fs:read` | Lecture sous la racine du projet |
| `fs:write:<glob>` | Écriture limitée aux chemins déclarés |
| `shell:test` | Commandes de test fournies par l'adaptateur de stack uniquement |
| `shell:<liste>` | Commandes explicitement listées |
| `git:commit`, `git:branch`, `git:revert` | Opérations Git via Workspace |
| `copilot:sessions` | Ouvrir des sessions de tâche (consomme le quota de l'utilisateur) |
| `net:<domaines>` | Réseau vers des domaines listés ; `net:none` par défaut |

Une mise à jour d'extension qui élargit les permissions exige un nouvel accord de l'utilisateur.

### 5.3 Cycle de vie

1. **Installation** : vérification de signature, compatibilité `engines.appApi`, affichage des permissions en langage clair, accord.
2. **Enregistrement** : au démarrage, lecture du manifeste et indexation des contributions sans charger le code.
3. **Activation** : au premier événement déclencheur, lancement de l'hôte et appel de `activate(ctx)`.
4. **Désactivation** : `deactivate()`, puis arrêt du processus après un délai de grâce.

### 5.4 API `ctx`

| Espace | Méthodes principales | Permission |
| --- | --- | --- |
| `ctx.chat` | `registerCommand`, `stream`, `progress`, `confirm`, `pick`, `input`, `taskCard`, `milestone`, `alert`, `card` | aucune |
| `ctx.agents` | `run(name, prompt, opts)` → résultat sérialisé (jamais une session) | `copilot:sessions` |
| `ctx.workspace` | `readFile`, `writeFile`, `listFiles`, `run(cmd)`, `checkpoint`, `diff`, `hashFiles` | `fs:*`, `shell:*` |
| `ctx.git` | `commit`, `branch`, `revertTo`, `head` | `git:*` |
| `ctx.tools` | `register(tool)` | aucune |
| `ctx.hooks` | `onPreToolUse`, `onPostToolUse` (ne peuvent que refuser ou restreindre, jamais élargir) | aucune |
| `ctx.tasks` | `start(name, input)`, `dispatch(taskId, event)`, `onProgress`, `cancel`, `status` | selon la tâche |
| `ctx.interactions` | `request({ kind, title, options, context })` → identifiant ; réponse livrée comme événement de tâche | aucune |
| `ctx.panels` | `update(id, data)`, `onAction` | aucune |
| `ctx.storage` | `get`, `set` (espace privé à l'extension) | aucune |
| `ctx.settings` | `get`, `onChange` | aucune |
| `ctx.stack` | `detect()`, `testCommand()`, `parseReport()`, `mutation()`, `architectureCheck()` | `shell:test` |

### 5.5 Composition des hooks

Le SDK n'accepte qu'un handler par type de hook et par session. Le cœur chaîne ceux des extensions actives :

```ts
onPreToolUse: async (input, inv) => {
  for (const h of registry.preToolHooks(session)) {
    let r;
    try { r = await withTimeout(h.fn(input, inv), 2_000); }
    catch (err) {
      journal.hookFailure(h.extensionId, err);
      if (h.securityGuard) return { permissionDecision: "deny", permissionDecisionReason: `Garde ${h.id} indisponible` };
      continue;
    }
    if (r?.permissionDecision === "deny") return r;          // le premier refus l'emporte
    if (r?.modifiedArgs) input.toolArgs = r.modifiedArgs;    // restriction seulement
  }
  return { permissionDecision: "allow", modifiedArgs: input.toolArgs };
}
```

Les gardes internes du cœur (périmètre d'écriture par rôle, gel des tests, commandes Git interdites aux agents) passent **avant** les hooks d'extension et ne peuvent pas être désactivées par une extension.

---

## 6. Moteur de tâches

### 6.1 Contrat d'une tâche

```ts
export interface TaskDefinition<S, E, F> {
  name: string;
  initialState(input: unknown): S;
  transition(state: S, event: E): { state: S; effects: F[] };   // PUR : aucune I/O
  runEffect(effect: F, deps: TaskDeps): Promise<E | void>;        // exécute et renvoie l'événement suivant
}
```

Le moteur fournit : file d'événements, persistance de l'état **après chaque transition**, émission des événements vers le bus (cartes, jalons, alertes), budget, watchdog, annulation, reprise.

### 6.2 Événements système injectés par le moteur

| Événement | Quand |
| --- | --- |
| `TIMEOUT` | Inactivité d'un agent ou d'une commande au-delà du seuil |
| `ENV_FAILURE` | Outil absent, runtime injoignable, quota épuisé, API indisponible |
| `HUMAN_DECISION` | Réponse à une demande d'interaction persistée |
| `RESUMED` | Redémarrage de l'application avec un effet commencé non terminé |
| `ABORT` | Annulation par l'utilisateur |

Le réducteur traite `TIMEOUT` comme un rejet (réessai ciblé si budget) et `ENV_FAILURE` comme une escalade immédiate (D25).

### 6.3 Reprise (D23)

Avant chaque effet, le moteur persiste un marqueur `{ effect, checkpoint, attempt, startedAt }`. Au redémarrage, un effet commencé mais non terminé déclenche : rollback au checkpoint, puis événement `RESUMED` et relance de l'effet. Aucun travail partiel n'est réutilisé.

### 6.4 Exécution d'un tour d'agent (D30)

Pas de `sendAndWait` avec délai fixe. Le tour est lancé avec `send()` ; tout événement de session réarme un chronomètre d'inactivité ; `session.idle` termine le tour ; un silence au-delà du seuil déclenche `abort()` et l'événement `TIMEOUT`. Les outils longs (`run_tests`) réarment le chronomètre à chaque ligne de sortie.

```ts
async function runTurn(session: AgentSession, prompt: string, idleMs = 5 * 60_000) {
  return new Promise<void>((resolve, reject) => {
    let timer = setTimeout(onIdle, idleMs);
    const off = session.onEvent((ev) => {
      clearTimeout(timer); timer = setTimeout(onIdle, idleMs);
      if (ev.type === "idle") { cleanup(); resolve(); }
      if (ev.type === "error") { cleanup(); reject(new EnvFailure(ev.message)); }
    });
    async function onIdle() { cleanup(); await session.abort(); reject(new TurnTimeout()); }
    function cleanup() { clearTimeout(timer); off(); }
    session.send(prompt).catch((e) => { cleanup(); reject(e); });
  });
}
```

### 6.5 Outils standard fournis aux agents par le cœur

| Outil | Rôle | Particularité |
| --- | --- | --- |
| `run_tests` | Lance la suite ou un sous-ensemble via l'adaptateur de stack | Handler = notre code : capture sortie, code de sortie, empreintes, écrit la preuve (D20) |
| `report_phase` | Clôt la phase avec un résumé et la liste des fichiers | Terminal ; **refuse** (erreur) si une skill à la demande requise n'a pas été chargée ou si une précondition manque |
| `report_blocker` | Signale une question métier bloquante avec des choix | Terminal ; suspend la tâche et crée une demande d'interaction (D31) |
| `load_skill` | Charge une skill facultative, éventuellement une section | Chaque appel est tracé dans l'état de la tâche (D26) |
| `submit_plan`, `submit_verdict`, `submit_difficulty` | Sorties structurées spécialisées | Terminales, schéma strict, enums fermés |

### 6.6 Dossier de passation (D17)

Construit par le code à chaque ouverture de session :

```
Tâche : <nom> — <story>
Plan : [done] …  [en cours] …  [pending] …
Étape en cours : <comportement / phase>
Déjà fait : - <résumé report_phase> (<fichiers>)
Rejet précédent : <motif précis de la porte>, s'il y a lieu
Réponses utilisateur : <décisions ratifiées, réponses aux blocages>
Fichiers utiles : <présélection par le code>
```

Les transcriptions des sessions ne sont **jamais** réinjectées. À la fin d'une tâche, seul un **résumé structuré** remonte à la session principale : comme résultat d'outil si le LLM a lancé la tâche, sinon comme `additionalContext` du message suivant de l'utilisateur. Un outil `task_status` permet au LLM principal de lire l'état courant à la demande.

---

## 7. Communication avec l'utilisateur

### 7.1 Trois canaux (D32)

| Canal | Usage | Mécanisme |
| --- | --- | --- |
| `ctx.chat` | Progression, cartes, questions courtes avec l'utilisateur présent | Messages validés par l'hôte, origine affichée |
| Questions d'agent en direct | Session interactive uniquement | Handlers `onUserInputRequest` (outil `ask_user`) et `onElicitationRequest` du SDK, implémentés par le processus principal |
| Demandes d'interaction persistées | Ratification, confirmation de difficulté, escalade, blocage métier | Enregistrement persistant, liste « En attente de vous », notification système, survit au redémarrage |

Forme d'une demande d'interaction :

```json
{
  "id": "int-42", "taskId": "us-12", "extension": "skraft",
  "kind": "decision",
  "title": "Ratifier ADR-008 : plafond appliqué dans le domaine",
  "options": ["accept", "reject", "amend"],
  "context": { "adr": "docs/adr/adr-008-plafond-domaine.md" },
  "createdAt": "2026-09-22T14:03:00Z",
  "status": "pending"
}
```

La réponse est validée (option autorisée, profil autorisé à décider) puis injectée comme `HUMAN_DECISION` dans la tâche. Des rappels sont envoyés ; au-delà d'une durée configurable, la tâche passe en pause (pas en échec).

### 7.2 Progression (D33)

- **Carte de tâche** : une seule par tâche, mise à jour en place (phase, étape, progression, temps écoulé, usage). Rafraîchie au plus deux fois par seconde.
- **Jalons** : messages persistants aux transitions déclarées `milestones`. Au-delà d'un jalon toutes les dix secondes par tâche, regroupement en résumé.
- **Alertes** : transitions déclarées `alerts` (réessai, délai, escalade), mises en évidence.
- **Mode simple** : carte et jalons. **Mode avancé** : en plus, chaque étape, appel d'outil et vérification.
- **Hors conversation** : panneau « Tâches en cours » avec badge ; notification système pour jalons et alertes seulement, si l'application est en arrière-plan.
- Les libellés viennent du manifeste (`states`) : le moteur génère cartes, jalons et alertes automatiquement.
- Chaque mise à jour de carte sert aussi de signal de vie pour le watchdog.

---

## 8. Extension n°1 : `tdd`

Première extension, **écrite en interne** pour éprouver l'API `ctx` (D14). Prototype complet dans `reference/tdd-orchestrator.ts` et `reference/copilot-agents.ts`.

### 8.1 Usage

`/tdd <description de la fonctionnalité>` dans le chat. L'extension découpe en comportements, puis déroule pour chacun RED → GREEN → REFACTOR sous contrôle du code.

### 8.2 Machine à états

```mermaid
stateDiagram-v2
  [*] --> PLANNING
  PLANNING --> PLAN_REVIEW: submit_plan
  PLAN_REVIEW --> STEP_START: approuvé
  PLAN_REVIEW --> PLANNING: refusé avec motif
  STEP_START --> RED: checkpoint
  RED --> RED_VERIFY: report_phase
  RED_VERIFY --> GREEN: valide
  RED_VERIFY --> RED: réessai
  GREEN --> GREEN_VERIFY
  GREEN_VERIFY --> REFACTOR: valide
  GREEN_VERIFY --> GREEN: réessai
  REFACTOR --> REFACTOR_VERIFY
  REFACTOR_VERIFY --> STEP_DONE: valide, sinon rollback au vert
  STEP_DONE --> STEP_START: comportement suivant
  STEP_DONE --> DONE
  RED_VERIFY --> ESCALATED: budget épuisé
  GREEN_VERIFY --> ESCALATED: budget épuisé
  ESCALATED --> STEP_START: relancer ou sauter
  ESCALATED --> ABORTED
```

### 8.3 Portes

| Porte | Contrôles (tous exécutés par le code) |
| --- | --- |
| Vérif RED | Seuls des fichiers de test modifiés ; exactement un nouveau test ; il échoue sur une **assertion** ou un **symbole manquant** (pas une erreur de syntaxe ni un crash de setup) ; aucun ancien test en régression ; commit `test:` ; empreinte des tests enregistrée |
| Vérif GREEN | Empreinte des tests inchangée ; seuls des fichiers de production modifiés ; **au moins un** fichier de production modifié ; suite entièrement verte, aucun test ignoré ; commit `feat:` |
| Vérif REFACTOR | Mêmes contrôles que GREEN ; en cas d'échec, rollback au commit vert **sans escalade** ; commit `refactor:` |

Chaque porte renvoie un **motif précis** en cas de rejet, transmis tel quel à l'agent lors du réessai.

### 8.4 Rôles et périmètres

| Rôle | Écrit dans | Outils |
| --- | --- | --- |
| Planificateur | rien | `submit_plan` |
| Agent test | `tests/**` | `run_tests`, `report_phase`, `load_skill` |
| Agent dev | `src/**` | `run_tests`, `report_phase`, `load_skill` |

Aucun agent n'exécute de commande Git (`commit`, `reset`, `checkout`, `stash`, `rebase`, `push`, `restore`) ni de redirection shell vers des fichiers.

### 8.5 Granularité (D22)

- **Par défaut** : un tour d'agent par comportement, avec `run_tests` et le gel des tests actifs pendant le tour ; vérification complète en fin de tour (séquence rouge puis vert présente dans les preuves).
- **Mode strict** (réglage, ou automatique après un échec) : une session par pas RED, GREEN, REFACTOR, comme dans la machine ci-dessus.

---

## 9. Extension n°2 : `skraft`

Portage du plugin [skraft-plugin](https://github.com/SebastienDegodez/skraft-plugin) (version analysée : 1.5.2) en extension pilotée par notre moteur. Sous réserve de la licence (D42).

> **La spécification détaillée de cette extension est dans `SPEC-skraft.md`, qui fait autorité.** Cette section en donne la vue d'ensemble.

### 9.1 Ce qu'on reprend, ce qu'on remplace

| Reprendre | Remplacer |
| --- | --- |
| 22 prompts d'agents (orchestrateur exclu), 36 skills | L'orchestrateur LLM → réducteur |
| Politiques pures de `domain/` (après unification de l'état) | Les hooks G1 à G8 → portes et gardes du cœur |
| Schéma de preuves de qualité | Les preuves écrites par l'agent → preuves écrites par `run_tests` |
| Commande `artifact adr` (gabarit validé) | L'édition manuelle de `state.json` → événements du réducteur |
| Lentilles de revue indépendantes en contextes neufs | La synthèse pondérée par un LLM → synthèse par le code |

Constats sur skraft-plugin 1.5.2 à **ne pas reproduire** : gardes conditionnés à un `projectSlug` absent des payloads (C1) ; deux modèles d'état incompatibles (C2) ; initialisation en DISCOVER alors que le pipeline compte quatre phases (C3) ; outils `Write`/`Edit` non surveillés (C4) ; format de sortie des hooks non reconnu par les harnais (C5) ; vocabulaire de verdict divergent `NEEDS_REWORK` / `CHANGES_REQUESTED` (C6) ; contrôle des skills en fail-open (C7) ; « commit vérifié » réduit à un arbre Git propre.

### 9.2 Pipeline

```mermaid
stateDiagram-v2
  [*] --> INIT: /skraft <story>
  INIT --> CLASSIFY: état neuf
  INIT --> ROUTE: reprise
  CLASSIFY --> CONFIRM_DIFFICULTY: submit_difficulty
  CONFIRM_DIFFICULTY --> ROUTE: confirmé
  ROUTE --> SPECIALIST: phase suivante
  ROUTE --> DONE: plus de phase
  SPECIALIST --> ARTIFACT_GATE: report_phase
  ARTIFACT_GATE --> SPECIALIST: rejet, budget restant
  ARTIFACT_GATE --> REVIEW: phase avec reviewer
  ARTIFACT_GATE --> COMMIT: phase sans reviewer
  REVIEW --> VERDICT_GATE: verdicts des lentilles
  VERDICT_GATE --> RATIFICATION: DESIGN approuvé
  VERDICT_GATE --> COMMIT: APPROVED
  VERDICT_GATE --> SPECIALIST: CHANGES_REQUESTED
  VERDICT_GATE --> ESCALATED: REJECTED ou budget épuisé
  RATIFICATION --> COMMIT: tous les ADR décidés
  RATIFICATION --> SPECIALIST: amend
  COMMIT --> ROUTE
  ESCALATED --> SPECIALIST: relancer
  ESCALATED --> ROUTE: sauter la phase
  ESCALATED --> ABORTED
```

- `phaseOrder` = `["RESEARCH", "DESIGN", "DISTILL", "DELIVER"]`, **lu depuis la configuration unique** ; l'état est initialisé sur `phaseOrder[0]`.
- Slug dérivé de l'identifiant de la story (stable entre deux lancements) ; SHA de départ et branche `skraft/<slug>` enregistrés.
- Pour DELIVER, `SPECIALIST` est remplacé par la sous-machine de la section 9.6.

### 9.3 Difficulté

Quatre niveaux : `simple`, `medium`, `medium-hard`, `challenging`. Écrite une seule fois.

1. Le code calcule des **indicateurs** : nombre de critères d'acceptation, modules touchés (correspondance avec l'arborescence), nouvelle intégration externe, questions ouvertes.
2. Une **grille déterministe** propose un niveau ; toute question ouverte sur une règle métier relève le niveau d'un cran.
3. Le LLM rend `submit_difficulty` (niveau + justification courte) pour les cas limites.
4. **Confirmation** par l'utilisateur en mode simple, automatique en mode avancé (OUVERT O3).
5. Routage par règle : `simple` et `medium` sautent RESEARCH ; `medium-hard` et `challenging` l'exécutent. La difficulté ne change pas la logique de contrôle, seulement les moyens (budget, parallélisme entre scénarios, nombre de passes de revue).

### 9.4 Portes par phase

| Phase | Porte | Contrôles exécutés par le code |
| --- | --- | --- |
| RESEARCH | Porte citations | Sections du gabarit présentes ; chaque chemin cité existe ; chaque plage de lignes est dans les limites du fichier ; URL bien formées ; une recommandation unique ; questions ouvertes extraites et posées à l'utilisateur. **Pas de reviewer LLM** |
| RESEARCH | Préparation | Fichiers candidats présélectionnés par mots-clés de la story, placés dans le dossier de passation |
| DESIGN | Porte cohérence | En-tête valide sur chaque nouvel ADR ; chaque événement et agrégat cité dans les contrats existe dans le modèle d'événements ; remplacements présents dans le nouvel ADR **et** dans le registre ; numérotation continue |
| DESIGN | Ratification | État bloquant et persisté ; décision `accept` / `reject` / `amend` par ADR, par un profil autorisé (architecte) |
| DISTILL | Porte valeurs | Chaque littéral des critères d'acceptation apparaît dans le `.feature` et dans le test d'acceptance correspondant |
| DISTILL | Porte RED d'acceptance | Le code exécute les tests d'acceptance : échec sur assertion ou symbole manquant accepté ; test qui passe déjà signalé et requalifié en non-régression |
| DELIVER | Sous-machine | Voir 9.6 |

Tous les tests d'acceptance, **pour tous les scénarios**, sont écrits en DISTILL et gelés par empreinte : l'agent de DELIVER n'écrit jamais un test d'acceptance.

### 9.5 Revue

- Avant la revue, le code établit les **faits** : tests exécutés, mutation, règle de dépendance, empreintes. Ils sont transmis aux lentilles comme acquis.
- La lentille « portes de qualité » de skraft est **supprimée** (ses vérifications sont faites par le code). Les lentilles restantes jugent ce qu'aucun outil ne peut juger : lisibilité, pertinence des tests, fidélité aux ADR, lecture à froid sans contexte du producteur.
- Chaque lentille rend un **JSON à schéma** : verdict + défauts avec gravité.
- La **table de pondération de skraft est appliquée par le code** et produit un verdict `APPROVED` | `CHANGES_REQUESTED` | `REJECTED` (enum unique).
- Niveau `simple` : deux lentilles suffisent (lecteur à froid, intégrité des tests). OUVERT O2 pour les autres niveaux.

### 9.6 Sous-machine DELIVER

Pour chaque scénario, dans l'ordre du plan d'implémentation :

1. Le test d'acceptance du scénario (écrit en DISTILL) est rouge.
2. Boucle intérieure RED unitaire → GREEN → REFACTOR, avec les portes de la section 8.3, jusqu'à ce que le test d'acceptance soit vert.
3. Fin de scénario : mutation par l'adaptateur de stack (seuils : 100 % domaine et application, 90 % API et infrastructure), analyse de la règle de dépendance, contrôles mesurables d'Object Calisthenics (longueur de méthode, indentation, nombre d'attributs).
4. Un test qui ne tue aucun mutant est **signalé au reviewer**, jamais supprimé par l'agent.
5. Une valeur métier manquante → `report_blocker`, suspension, question à l'utilisateur (jamais « escalader vers DISCUSS »).

### 9.7 Adaptateurs de stack

| Stack | Tests et rapport | Mutation | Architecture |
| --- | --- | --- | --- |
| Swift (prioritaire) | XCTest, rapport `xcresult` | Muter | Analyse des imports entre modules |
| TypeScript | Vitest ou Jest, rapport JSON | Stryker | dependency-cruiser |
| .NET | `dotnet test`, rapport TRX | Stryker.NET | ArchUnitNET |

Chaque adaptateur force le mode non interactif (jamais de mode « watch »), applique un délai par commande et tue l'arbre de processus en cas de dépassement.

### 9.8 Scénario de validation de bout en bout (fil rouge)

À utiliser comme test d'acceptance de l'extension skraft, sur un projet Swift de démonstration :

> **US-12 — Plafonner le bolus proposé.** Quand le calcul propose une dose supérieure au plafond défini par le médecin, la dose proposée est limitée à ce plafond et une alerte explique pourquoi.
> 1. Plafond 10 U, calcul 6 U → 6 U, pas d'alerte.
> 2. Plafond 10 U, calcul 12,5 U → 10 U, alerte « Dose plafonnée à 10 U ».
> 3. Aucun plafond → dose = calcul, pas d'alerte.
> Question ouverte : plafond par prise ou par jour ?

Comportements attendus : difficulté proposée `medium-hard` (question ouverte) ; question posée à l'utilisateur dès la fin de RESEARCH ; une citation hors limites rejetée par la porte citations ; un nom d'événement incohérent rejeté par la porte cohérence ; ADR ratifié avant DISTILL ; « 12 U » au lieu de « 12,5 U » rejeté par la porte valeurs ; test du scénario 3 requalifié en non-régression ; toute modification d'un test par l'agent dev annulée ; bilan final avec commits, résultats et usage.

---

## 10. Sécurité

### 10.1 Menaces et parades

| Menace | Parade |
| --- | --- |
| Exfiltration de code ou de secrets par une extension | Réseau refusé par défaut, domaines déclarés dans le manifeste |
| Écriture hors périmètre | Chemins normalisés et vérifiés dans Workspace ; modèle de permissions Node en second rempart ; détection par diff à la porte suivante |
| Contournement par le shell | Liste blanche de commandes, refus des redirections et des commandes Git pour les agents |
| Consommation du quota | Compteur par extension et par tâche, plafonds par session et par heure, estimation avant lancement |
| Injection de prompt via un fichier ou une page web | Contenu externe traité comme donnée ; toute action sensible qu'il déclenche demande confirmation |
| Élargissement de permission par un hook | Les hooks d'extension ne peuvent que refuser ou restreindre |
| Extension qui bloque l'application | Processus isolé, délai par appel, redémarrage automatique |
| Hameçonnage par une fausse demande de permission | Canal de permission réservé à l'arbitre ; les extensions ne rendent que des cartes déclarées |

### 10.2 Durcissement Electron

`contextIsolation`, `sandbox`, pas de `nodeIntegration` ; preload minimal ; CSP stricte ; navigation externe interdite, liens ouverts dans le navigateur système ; jetons GitHub gardés dans le processus principal et le trousseau du système, jamais dans le renderer.

### 10.3 Profils (D6)

Le profil (testeur, PO/BA, développeur, architecte, administrateur) conditionne : le mode d'affichage par défaut, la politique de permissions par défaut (prudente ou souple), et **qui peut répondre à quelle demande d'interaction** (par exemple, seul un architecte ratifie un ADR). L'utilisateur ne peut pas modifier son propre profil. Mécanisme d'attribution : OUVERT O5.

---

## 11. Interface

| Aspect | Mode simple | Mode avancé |
| --- | --- | --- |
| Activité des agents | « Écriture du test en cours… » | Appels d'outils, arguments, durées |
| Modifications | « 3 fichiers modifiés », accepter / annuler | Diff complet par fichier |
| Git | Masqué, checkpoints automatiques | Branches, commits, historique |
| Permissions | Question en langage clair, mémorisation proposée | Règles détaillées par extension et par chemin |
| Erreurs | Explication et action suggérée | Trace technique et journal de l'extension |
| Décisions | Résumé en une phrase et boutons | Texte complet (ADR, diff, historique des tentatives) |

Éléments d'interface : chat avec autocomplétion `/` des commandes d'extensions et `@` des agents ; cartes de tâche ; liste « En attente de vous » ; panneau « Tâches en cours » ; onglets secondaires montrant en direct chaque session d'agent ; écran d'installation d'extension avec permissions en langage clair ; écran Git simplifié (connexion, clonage, synchronisation, push).

---

## 12. Distribution des extensions

- Archive ZIP signée : manifeste, code compilé, ressources, signature couvrant toute l'archive. Vérifiée à l'installation et à chaque mise à jour.
- Extension non signée : installable uniquement en mode développeur, avec avertissement permanent.
- Sources : fichier local, URL directe ; registre en ligne plus tard.
- Mises à jour explicites par défaut ; automatiques seulement pour les éditeurs marqués fiables.
- Liste de révocation signée interrogée périodiquement ; extension révoquée désactivée au prochain lancement avec explication.
- Capacités dépréciées fonctionnelles pendant deux versions mineures de l'API.

---

## 13. Usage et coûts

- **Deux unités** : requêtes (Copilot : chaque message envoyé à un agent, multiplié selon le modèle ; les appels d'outils dans un même tour ne comptent pas en plus — à vérifier selon l'offre) et tokens (Claude et autres fournisseurs à l'usage).
- **Leviers retenus** : pas d'orchestrateur LLM ; skills réduites aux besoins du rôle (les skills d'exécution de portes disparaissent des contextes) ; présélection des fichiers ; relance ciblée après rollback ; escalade immédiate des défauts d'environnement ; sorties courtes par outils terminaux ; un tour par scénario en DELIVER (D22) ; prompts système stables (mise en cache côté fournisseur).
- **Mesure obligatoire** (D37) : par état de machine, tokens entrants et sortants, requêtes, réessais, durée. Comparer sur trois à cinq stories réelles avant de régler les budgets par défaut.

---

## 14. Feuille de route

Chaque jalon est livrable seul et a des critères de sortie vérifiables.

| Jalon | Contenu | Critères de sortie |
| --- | --- | --- |
| **J1** | Coquille Electron durcie ; authentification via `gh auth login` ; client Copilot SDK via le port `AgentRuntime` ; session principale persistante ; service Workspace (clonage, checkpoints, diff, rollback, synchronisation) | Une conversation complète sur un dépôt cloné, avec checkpoint et annulation en un geste ; reprise de la conversation après redémarrage |
| **J2** | Registre, routeur, API `ctx` minimale ; moteur de tâches (réducteur, effets, persistance, watchdog, reprise) ; extension `tdd` **chargée en processus** ; adaptateur de stack TypeScript | `/tdd` déroule un cycle complet sur un projet TypeScript ; tous les tests du réducteur passent sans LLM ; une modification de test par l'agent dev est détectée et annulée ; un redémarrage en plein GREEN reprend proprement |
| **J3** | Outil `run_tests` et preuves produites par le code ; granularité par défaut (un tour par comportement) ; demandes d'interaction persistées ; cartes, jalons, alertes | Preuves de rouge puis vert présentes pour chaque comportement ; une escalade survit à un redémarrage et reprend après réponse |
| **J4** | Isolation en `utilityProcess` ; arbitre de permissions ; composition des hooks ; manifeste validé | L'extension `tdd` tourne hors du processus principal sans perte de fonction ; une permission non déclarée est refusée ; un hook qui plante n'autorise rien |
| **J5** | Adaptateur de stack Swift (XCTest, Muter, imports) ; instrumentation de l'usage | `/tdd` sur un projet Swift ; usage affiché par état |
| **J6** | Paquets signés, installation depuis un fichier, révocation ; modes simple et avancé ; profils | Une extension tierce s'installe depuis un fichier ; un profil non-développeur mène une tâche sans aide |
| **S1** | Extension `skraft` : réducteur du pipeline, INIT, difficulté, routage ; état unifié | Pipeline complet à vide avec agents simulés ; saut de RESEARCH par règle |
| **S2** | RESEARCH : présélection, porte citations, questions ouvertes | Citation hors limites rejetée sur le fil rouge |
| **S3** | DESIGN : `artifact adr`, porte cohérence, état Ratification | Incohérence de nom d'événement rejetée ; DISTILL impossible avant ratification |
| **S4** | DISTILL : porte valeurs, porte RED d'acceptance, tous les tests d'acceptance | Valeur arrondie rejetée ; test déjà vert requalifié |
| **S5** | DELIVER : sous-machine par scénario, mutation, architecture | Fil rouge US-12 livré en Swift avec preuves produites par le code |
| **S6** | Revue : faits établis par le code, lentilles à schéma, synthèse par le code | Verdict reproductible à partir des mêmes JSON de lentilles |
| **API 1.0** | Gel de l'API `ctx` | Après S6 (D14) |

---

## 15. Points à vérifier sur les SDK

Constatés sur les versions utilisées pendant la conception ; **À VÉRIFIER** sur la version installée.

| Point | Constat |
| --- | --- |
| `sendAndWait` | Délai par défaut de 60 s : ne pas l'utiliser pour le travail des agents (voir 6.4) |
| Exceptions dans un hook | Le SDK journalise et reprend le comportement par défaut : envelopper chaque hook (voir 5.5) |
| Types des hooks | Non exportés directement ; les dériver de `SessionHooks["onPreToolUse"]` |
| Outil terminal | `defineTool(..., { isTerminal: true })` : un appel réussi termine le tour |
| Questions à l'utilisateur | `onUserInputRequest` (outil `ask_user`) et `onElicitationRequest` dans la configuration de session |
| Sessions | `disconnect()` libère la mémoire mais la session reste sur disque ; supprimer explicitement ; reprise par `resumeSession` |
| Noms d'outils intégrés | Varient selon la version du CLI (`bash`, `edit`, `create`, `view`…) et le champ de chemin (`path`, `file_path`) : **journaliser un premier run** et normaliser, ne rien coder en dur |
| Plugins CLI | Mis en cache à l'installation : réinstaller pour prendre en compte une modification locale |
| Claude Agent SDK | Clé API ou fournisseur cloud obligatoire pour une application tierce ; pas de connexion claude.ai sans accord d'Anthropic ; le produit garde sa propre marque |
| ACP | Copilot CLI se lance en mode ACP avec `copilot --acp` ; pas d'équivalent aux hooks en code ; protocole encore en évolution |

---

## 16. Conventions de développement

- TypeScript `strict` partout ; ESM ; pnpm workspaces.
- Tests : Vitest ; les réducteurs et politiques ont une couverture complète ; tests d'intégration du runtime avec un faux `AgentRuntime` scripté (réponses d'agent enregistrées), jamais d'appel réel au LLM dans la CI.
- Contrats d'entrée/sortie (IPC, RPC d'extension, manifeste, outils terminaux) décrits par des schémas (JSON Schema ou Zod) et validés à l'exécution.
- Commits conventionnels (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`) ; une PR par unité fonctionnelle.
- ADR pour toute décision nouvelle (`docs/adr/`).
- Journalisation structurée (JSON) avec identifiants de tâche, de session et d'extension.
- Aucune donnée de santé ou personnelle dans les journaux ni dans les fixtures.

---

## 17. Questions ouvertes

| # | Question | Hypothèse provisoire |
| --- | --- | --- |
| O1 | Granularité de DELIVER : un cycle TDD par scénario d'acceptance ou par comportement découpé par un LLM ? | Par comportement, à partir des scénarios de DISTILL |
| O2 | Nombre de lentilles de revue par niveau de difficulté | Deux pour `simple`, toutes pour les autres |
| O3 | Confirmation de la difficulté : toujours, ou seulement en mode simple ? | Mode simple seulement |
| O4 | Garder une variante par hooks pour Claude Code et Copilot CLI, réutilisant les politiques pures ? | Non dans un premier temps |
| O5 | Attribution des profils : fichier de configuration signé, annuaire d'entreprise, ou administrateur local ? | Fichier de configuration géré par un administrateur |
| O6 | Stockage de l'état des tâches : JSON dans le projet ou SQLite dans le profil utilisateur ? | SQLite dans le profil, export JSON possible |
| O7 | Framework du renderer | Au choix, à consigner dans un ADR au jalon J1 |
| O8 | Backlog Discoverer et Backlog Planner de skraft : intégrés au pipeline ou agents autonomes ? | Autonomes |
| O9 | Licence GPL-3.0-or-later de skraft (D42) | À trancher avant S1 |
| O10 | Nom définitif de l'application (D39) | `agent-studio` comme nom de code |
