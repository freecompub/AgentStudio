# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## État du dépôt

Le dépôt ne contient **encore aucun code applicatif** : uniquement la spécification (`docs/`) et deux prototypes TypeScript. Il n'y a ni `package.json`, ni commandes de build, lint ou test pour l'instant. Quand le monorepo sera créé, mettre à jour ce fichier avec les commandes réelles (pnpm, Vitest, lancement d'Electron, exécution d'un seul test).

Toute la documentation est en français ; écrire les ADR, messages et libellés en français.

## Documents de référence (à lire avant de coder)

- `docs/SPEC.md` — **document faisant autorité** pour le cœur. Lire en entier, en particulier §0 (consignes), §3 (registre des décisions D1–D42), §14 (feuille de route J1–J6, S1–S6), §15 (points SDK à vérifier), §16 (conventions).
- `docs/SPEC-skraft.md` — fait autorité pour l'extension `skraft` ; suppose `SPEC.md` lu et les jalons J2–J4 terminés.
- `docs/tdd-orchestrator.ts` — prototype de la machine à états TDD (réducteur pur + runner d'effets).
- `docs/copilot-agents.ts` — prototype d'adaptateur Copilot SDK (session par rôle, garde de périmètre en `onPreToolUse`, outils terminaux).
  `SPEC.md` les désigne sous `reference/` : ce sont des prototypes à découper, pas du code de production.
- `docs/01…04-*.md` — documents d'analyse (architecture, audit de skraft-plugin 1.5.2, comparaison des diagrammes d'état). Contexte uniquement.

## Règles de travail imposées par la spec

- Décisions `DÉCIDÉ` : ne pas les rediscuter. Si l'une semble bloquante, s'arrêter et demander.
- Décisions `OUVERT` : ne pas trancher silencieusement ; implémenter derrière une interface/option et signaler le choix provisoire.
- Suivre les jalons dans l'ordre en commençant par **J1** ; ne passer au suivant qu'une fois tous ses critères de sortie remplis.
- TDD strict. Réducteurs et politiques : fonctions pures, testées sans LLM, sans Git, sans disque.
- Toute nouvelle décision technique → ADR dans `docs/adr/NNNN-titre.md` (contexte, décision, conséquences, statut).
- Vérifier les API des SDK sur la version installée (points `À VÉRIFIER`, §15) : ex. `sendAndWait` a un délai de 60 s, une exception de hook retombe sur le comportement par défaut, les noms d'outils intégrés du CLI varient selon la version.
- **skraft est GPL-3.0-or-later** : ne copier aucun prompt, skill ni code de skraft-plugin tant que la question O9/D42 n'est pas tranchée.

## Architecture cible (vue d'ensemble)

Principe directeur : **le LLM propose, le code décide et vérifie.**

- **Electron, quatre processus** : renderer (sandboxé, aucun accès Node) ↔ IPC validé ↔ **processus principal** (seul de confiance : registre, routeur, sessions, moteur de tâches, arbitre de permissions, Workspace, bus d'événements, client SDK) ↔ un **`utilityProcess` par extension** (confiance nulle, RPC bridé via MessagePort) ; le runtime d'agent (Copilot CLI) est piloté par le SDK en JSON-RPC.
- **Règle de sécurité n°1** : aucun objet du SDK n'est jamais exposé à une extension. Les extensions ne voient que l'API `ctx` ; `ctx.agents.run()` renvoie un résultat sérialisé, jamais une session.
- **Port `AgentRuntime`** (§4.3) : le cœur ne dépend jamais directement d'un SDK. Seul l'adaptateur Copilot SDK est dans le périmètre initial ; Claude Agent SDK et ACP restent des interfaces documentées.
- **Moteur de tâches** (§6) : `transition(state, event) → { state, effects }` pur ; `runEffect` fait les I/O. État persisté après chaque transition ; checkpoint Git avant chaque effet ; un effet interrompu est rejoué depuis son checkpoint (rollback + `RESUMED`), jamais récupéré. Le réducteur applique le budget de réessais ; `TIMEOUT` = réessai, `ENV_FAILURE` = escalade immédiate.
- **Tours d'agent** : `send()` non bloquant + watchdog d'inactivité réarmé par chaque événement ; jamais de `sendAndWait` à délai fixe.
- **Contrat LLM ↔ code** : sorties via outils terminaux à schéma (`report_phase`, `submit_plan`, `submit_verdict`, `submit_difficulty`, `report_blocker`). Les preuves (tests) sont produites par notre handler `run_tests`, jamais par l'agent. Les portes entre états sont exécutées par le code (tests, diff, empreintes des tests gelés, périmètres d'écriture).
- **Une session neuve par phase/rôle** avec un dossier de passation construit par le code ; les transcriptions ne sont jamais réinjectées.
- **Hooks** : un seul handler par type et par session, composé par le cœur ; exécution en série, premier refus l'emporte, délai par hook, **refus par défaut** si une garde de sécurité plante ou expire. Les gardes du cœur passent avant celles des extensions.
- **Workspace** est le seul service à toucher le disque et Git.
- Humain : jamais d'attente bloquante ; décisions longues = demandes d'interaction persistées, réinjectées comme `HUMAN_DECISION`.

Arborescence prévue (monorepo pnpm, §4.4) : `apps/desktop` (main/preload/renderer), `packages/{core,task-engine,workspace,runtime-copilot,extension-host,extension-api,extension-manifest,stack-adapters}`, `extensions/{tdd,skraft}`, `docs/adr/`.

## Conventions (§16)

- TypeScript `strict`, ESM, pnpm workspaces ; tests Vitest.
- Tests d'intégration avec un faux `AgentRuntime` scripté ; aucun appel réel au LLM en CI.
- Contrats (IPC, RPC d'extension, manifeste, outils terminaux) décrits par des schémas (JSON Schema ou Zod) et validés à l'exécution.
- Commits conventionnels (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`).
- Journalisation JSON structurée avec identifiants de tâche, session et extension ; aucune donnée de santé ou personnelle dans les journaux ni les fixtures.
