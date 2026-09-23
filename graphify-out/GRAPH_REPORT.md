# Graph Report - .  (2026-09-23)

## Corpus Check
- Corpus is ~34,667 words - fits in a single context window. You may not need a graph.

## Summary
- 246 nodes · 485 edges · 16 communities
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 35 edges (avg confidence: 0.81)
- Token cost: 177,063 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Règles spec et portes skraft|Règles spec et portes skraft]]
- [[_COMMUNITY_Adaptateur Copilot (code)|Adaptateur Copilot (code)]]
- [[_COMMUNITY_Architecture technique Electron|Architecture technique Electron]]
- [[_COMMUNITY_Améliorations skraft pas à pas|Améliorations skraft pas à pas]]
- [[_COMMUNITY_Garde-fous hooks skraft|Garde-fous hooks skraft]]
- [[_COMMUNITY_Pipeline déterministe vs skraft|Pipeline déterministe vs skraft]]
- [[_COMMUNITY_Registre des décisions SPEC|Registre des décisions SPEC]]
- [[_COMMUNITY_Moteur de tâches et reprise|Moteur de tâches et reprise]]
- [[_COMMUNITY_Vision et modèle de processus|Vision et modèle de processus]]
- [[_COMMUNITY_Outils terminaux et verdicts|Outils terminaux et verdicts]]
- [[_COMMUNITY_API ctx et interactions|API ctx et interactions]]
- [[_COMMUNITY_Constats contrat harnais skraft|Constats contrat harnais skraft]]
- [[_COMMUNITY_Port AgentRuntime et SDK|Port AgentRuntime et SDK]]
- [[_COMMUNITY_Registre, routeur, permissions|Registre, routeur, permissions]]
- [[_COMMUNITY_Machine à états skraft-plugin|Machine à états skraft-plugin]]
- [[_COMMUNITY_Arbitre et chaîne de hooks|Arbitre et chaîne de hooks]]

## God Nodes (most connected - your core abstractions)
1. `SPEC — agent-studio (core specification)` - 79 edges
2. `SPEC — Extension skraft` - 36 edges
3. `skraft pas à pas : fragilités et améliorations` - 27 edges
4. `skraft : diagrammes d'état comparés` - 16 edges
5. `cli/hook.mjs (garde-fous)` - 13 edges
6. `Pipeline de notre approche (réducteur déterministe)` - 12 edges
7. `Processus principal (confiance totale)` - 11 edges
8. `Architecture technique — application chat Copilot SDK` - 10 edges
9. `Analyse technique de skraft-plugin` - 9 edges
10. `Modes fail-closed / fail-open` - 8 edges

## Surprising Connections (you probably didn't know these)
- `CLAUDE.md — guidance for Claude Code` --references--> `SPEC — agent-studio (core specification)`  [EXTRACTED]
  CLAUDE.md → docs/SPEC.md
- `CLAUDE.md — guidance for Claude Code` --references--> `SPEC — Extension skraft`  [EXTRACTED]
  CLAUDE.md → docs/SPEC-skraft.md
- `README — AgentStudio` --references--> `agent-studio (application)`  [INFERRED]
  README.md → docs/SPEC.md
- `Architecture cible (vue d'ensemble)` --references--> `Port AgentRuntime (D35)`  [EXTRACTED]
  CLAUDE.md → docs/SPEC.md
- `Architecture cible (vue d'ensemble)` --references--> `Moteur de tâches`  [EXTRACTED]
  CLAUDE.md → docs/SPEC.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Deterministic control loop: reducer, code gates, terminal tools, code-produced evidence** — docs_spec_deterministic_orchestrator, docs_spec_code_gates, docs_spec_terminal_tools, docs_spec_run_tests, docs_spec_retry_budget, docs_spec_git_checkpoint [INFERRED 0.85]
- **Extension isolation and security model** — docs_spec_process_per_extension, docs_spec_ctx_api, docs_spec_no_sdk_exposure, docs_spec_manifest, docs_spec_permission_arbiter, docs_spec_hook_chain [EXTRACTED 1.00]
- **skraft per-phase code gates** — docs_spec_skraft_citation_gate, docs_spec_skraft_consistency_gate, docs_spec_skraft_ratification, docs_spec_skraft_values_gate, docs_spec_skraft_acceptance_red_gate, docs_spec_skraft_end_of_scenario_gate [EXTRACTED 1.00]
- **Chaîne de garde-fous hook skraft** — docs_02_analyse_technique_skraft_plugin_hooks_json, docs_02_analyse_technique_skraft_plugin_hook_cli, docs_02_analyse_technique_skraft_plugin_pre_tool_use_composite, docs_02_analyse_technique_skraft_plugin_state_json, docs_02_analyse_technique_skraft_plugin_skill_audit_log [EXTRACTED 1.00]
- **Portes vérifiées par le code dans notre approche** — docs_03_skraft_diagrammes_etat_compares_porte_artefacts, docs_03_skraft_diagrammes_etat_compares_porte_verdict, docs_04_skraft_pas_a_pas_fragilites_ameliorations_porte_citations, docs_04_skraft_pas_a_pas_fragilites_ameliorations_porte_coherence, docs_04_skraft_pas_a_pas_fragilites_ameliorations_porte_valeurs, docs_04_skraft_pas_a_pas_fragilites_ameliorations_porte_red, docs_01_architecture_technique_portes_verification [INFERRED 0.85]
- **Orchestration déterministe (réducteur, moteur, outils terminaux)** — docs_01_architecture_technique_reducteur_transition, docs_01_architecture_technique_moteur_taches, docs_01_architecture_technique_outils_terminaux, docs_03_skraft_diagrammes_etat_compares_notre_approche_pipeline [INFERRED 0.85]

## Communities (16 total, 0 thin omitted)

### Community 0 - "Règles spec et portes skraft"
Cohesion: 0.09
Nodes (44): Règles de travail imposées par la spec, ADR (docs/adr/NNNN-titre.md), Portes vérifiées par le code (D19), Tests gelés par empreinte (D21), Licence GPL-3.0-or-later de skraft (D42/O9, OUVERT), Outil load_skill, Skills obligatoires injectées + load_skill (D26), Feuille de route J1–J6, S1–S6 (+36 more)

### Community 1 - "Adaptateur Copilot (code)"
Cohesion: 0.07
Nodes (25): CopilotAgents, pathGuard(), PhaseReport, PlanArgs, PreToolUseHandler, ROLES, RunOpts, SHELL_TOOLS (+17 more)

### Community 2 - "Architecture technique Electron"
Cohesion: 0.10
Nodes (26): Architecture technique — application chat Copilot SDK, API ctx des extensions, Arbitre de permissions, Bus d'événements et journal (timeline), Chaîne de hooks (premier refus l'emporte), Copilot CLI runtime (JSON-RPC), @github/copilot-sdk, Durcissement Electron (+18 more)

### Community 3 - "Améliorations skraft pas à pas"
Cohesion: 0.18
Nodes (18): Portes de vérification Vérif RED/GREEN/REFACTOR, Décision humaine (escalade), Outil submit_difficulty, skraft pas à pas : fragilités et améliorations, Adaptateurs de stack (XCTest/Muter, Vitest/Stryker, dotnet/Stryker.NET), Commande artifact adr, État Ratification ADR bloquant, Indicateurs de difficulté calculés (+10 more)

### Community 4 - "Garde-fous hooks skraft"
Cohesion: 0.16
Nodes (18): C3 Initialisation en DISCOVER / cycle désaligné, C4 Write/Edit non surveillés, C5 Format de sortie des hooks non natif, C7 Transcript attendu en tableau, Claude Code (harnais), Modes fail-closed / fail-open, G2 Skills obligatoires, G3 Lecture des skills vérifiée (+10 more)

### Community 5 - "Pipeline déterministe vs skraft"
Cohesion: 0.17
Nodes (16): Cycle TDD (machine à états RED/GREEN/REFACTOR), Dossier de passation, Moteur de tâches, P1 Le code décide, le LLM propose, P6 Le contexte est transmis, pas supposé, Réducteur pur transition(state, event), Pipeline RESEARCH → DESIGN → DISTILL → DELIVER, skraft-plugin 1.5.2 (+8 more)

### Community 6 - "Registre des décisions SPEC"
Cohesion: 0.18
Nodes (15): SPEC — agent-studio (core specification), Nom définitif de l'application (D39/O10, OUVERT), Registre des décisions D1–D42, Distribution des extensions, Système d'extensions à la VS Code (D8), Session neuve par phase/rôle (D17), Authentification via GitHub CLI (D4), Dossier de passation (+7 more)

### Community 7 - "Moteur de tâches et reprise"
Cohesion: 0.20
Nodes (11): Orchestrateur déterministe — réducteur pur + runner d'effets (D16), Checkpoint Git avant chaque effet (D23), Surveillance d'inactivité / watchdog (D30), Budget de réessais appliqué par le réducteur (D24), runTurn (tour d'agent non bloquant), Gestion Git simplifiée (D7), Événements système (TIMEOUT, ENV_FAILURE, HUMAN_DECISION, RESUMED, ABORT), TaskDefinition (transition / runEffect) (+3 more)

### Community 8 - "Vision et modèle de processus"
Cohesion: 0.25
Nodes (9): CLAUDE.md — guidance for Claude Code, Architecture cible (vue d'ensemble), agent-studio (application), Electron stack (D2), Durcissement Electron, Le LLM propose, le code décide et vérifie, Modèle de processus Electron (renderer / principal / hôte d'extension / runtime), Un processus par extension — utilityProcess (D9) (+1 more)

### Community 9 - "Outils terminaux et verdicts"
Cohesion: 0.28
Nodes (9): Outils terminaux (isTerminal), Outil report_phase, artifact-policy.mjs, C6 Vocabulaire des verdicts divergent, G4 Artefacts attendus, G5 Verdict et commit, Porte artefacts, Porte verdict (+1 more)

### Community 10 - "API ctx et interactions"
Cohesion: 0.22
Nodes (9): API ctx, Arborescence monorepo pnpm, Aucun objet SDK exposé aux extensions (D10), Demandes d'interaction persistées (D31), Outil report_blocker, Outil report_phase, Interactions et progression skraft, Outils terminaux à schéma (D18) (+1 more)

### Community 11 - "Constats contrat harnais skraft"
Cohesion: 0.32
Nodes (8): C1 projectSlug absent des payloads, C2 Deux modèles d'état incompatibles, G1 Ordre de dispatch, G6 Continuation, pipeline-policy.mjs, pre-tool-use-composite.mjs, Tester le contrat réel harnais, Unifier le modèle d'état

### Community 12 - "Port AgentRuntime et SDK"
Cohesion: 0.29
Nodes (7): ACP (Agent Client Protocol), Port AgentRuntime (D35), Claude Agent SDK (adaptateur futur), Conventions de développement (§16), Copilot CLI, Copilot SDK (@github/copilot-sdk), Faux AgentRuntime scripté (tests d'intégration)

### Community 13 - "Registre, routeur, permissions"
Cohesion: 0.29
Nodes (7): Registre des capacités (D12), Bus d'événements et journal, Routeur d'intention, Manifeste d'extension, Permissions d'extension (fs, shell, git, copilot, net), Carte de tâche, jalons, alertes (D33), Instrumentation de l'usage (D37)

### Community 14 - "Machine à états skraft-plugin"
Cohesion: 0.47
Nodes (6): Analyse technique de skraft-plugin, Invariants I1–I9 de la machine à états, Orchestrateur LLM skraft, cli/state.mjs (CLI d'état), state.json, domain/state-machine.mjs

### Community 15 - "Arbitre et chaîne de hooks"
Cohesion: 0.40
Nodes (5): Composition de la chaîne de hooks (D28), Arbitre de permissions unique (D27), Contrôle en deux couches prévention/détection (D36), Profils utilisateurs (D6), Points à vérifier sur les SDK (§15)

## Ambiguous Edges - Review These
- `copilot-agents.ts` → `API ctx des extensions`  [AMBIGUOUS]
  docs/01-architecture-technique.md · relation: references

## Knowledge Gaps
- **24 isolated node(s):** `PreToolUseHandler`, `ROLES`, `WRITE_TOOLS`, `SHELL_TOOLS`, `PhaseReport` (+19 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `copilot-agents.ts` and `API ctx des extensions`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `SPEC — agent-studio (core specification)` connect `Registre des décisions SPEC` to `Règles spec et portes skraft`, `Adaptateur Copilot (code)`, `Moteur de tâches et reprise`, `Vision et modèle de processus`, `API ctx et interactions`, `Port AgentRuntime et SDK`, `Registre, routeur, permissions`, `Arbitre et chaîne de hooks`?**
  _High betweenness centrality (0.545) - this node is a cross-community bridge._
- **Why does `Cycle TDD (machine à états RED/GREEN/REFACTOR)` connect `Pipeline déterministe vs skraft` to `Adaptateur Copilot (code)`, `Architecture technique Electron`, `Améliorations skraft pas à pas`?**
  _High betweenness centrality (0.329) - this node is a cross-community bridge._
- **Why does `skraft : diagrammes d'état comparés` connect `Pipeline déterministe vs skraft` to `Architecture technique Electron`, `Améliorations skraft pas à pas`, `Garde-fous hooks skraft`, `Outils terminaux et verdicts`, `Constats contrat harnais skraft`, `Machine à états skraft-plugin`?**
  _High betweenness centrality (0.267) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `skraft : diagrammes d'état comparés` (e.g. with `Architecture technique — application chat Copilot SDK` and `skraft pas à pas : fragilités et améliorations`) actually correct?**
  _`skraft : diagrammes d'état comparés` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `PreToolUseHandler`, `ROLES`, `WRITE_TOOLS` to the rest of the system?**
  _29 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Règles spec et portes skraft` be split into smaller, more focused modules?**
  _Cohesion score 0.0919661733615222 - nodes in this community are weakly interconnected._