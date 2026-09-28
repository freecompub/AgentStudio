# Extension skraft

Pipeline de livraison d'une story : RESEARCH → DESIGN → DISTILL → DELIVER, avec revue à lentilles.
Sous licence **GPL-3.0-or-later** (ADR 0023) : son contenu est en partie repris de
[skraft-plugin](https://github.com/SebastienDegodez/skraft-plugin), tag `v1.6.1`
(`docs/licences/autorisation-skraft.md`).

## Un même contenu, deux usages (ADR 0024)

| Dossier | Contenu | Utilisé par |
| --- | --- | --- |
| `agents/*.agent.md` | Rôle de chaque agent : méthode, livrables, règles métier | agent-studio, Copilot CLI, Claude Code |
| `skills/<nom>/SKILL.md` | Méthode (TDD outside-in, BDD, ADR…) et critères de revue | agent-studio, Copilot CLI, Claude Code |
| `src/manifest.ts`, `src/roles.ts` | Orchestration : outil de fin, périmètre d'écriture, outils, skills injectées ou à la demande | agent-studio seul |
| `src/` (réducteur, portes) | Enchaînement des phases, portes exécutées par le code, preuves, tests gelés | agent-studio seul |

- **Sous agent-studio**, l'extension s'installe en paquet `.asx` (`pnpm ext:build`, puis `pnpm ext:pack`).
  Le cœur compose le prompt de chaque agent : contenu du fichier de rôle, skills obligatoires du
  rôle (ou une seule section, `nom#Titre`), consignes du manifeste, puis le **contrat d'exécution**
  (outil de fin, `run_tests`, `report_blocker`, `load_skill`, jamais de Git), qui prime sur le reste.
- **Sans agent-studio**, ce dossier est aussi un plugin : `.claude-plugin/plugin.json` pour Claude
  Code, `plugin.json` pour Copilot CLI. Les agents et les skills s'y utilisent tels quels, mais
  **sans les garanties** : aucune porte, aucune preuve produite par le code, aucun test gelé.

Règle d'écriture : les fichiers de `agents/` et `skills/` ne nomment aucun outil ni mécanisme propre
à agent-studio. Ce qui n'a de sens que sous l'orchestrateur va dans `src/roles.ts` ou dans le
contrat du cœur. Un test le vérifie (`test/agents-skills.test.ts`).
