import type { ExtensionManifest } from "@agent-studio/extension-api";
import { LENS_MODEL_CLASS, LENSES, ROLE_SKILLS, ROLES, SKILLS } from "./roles.js";

const skillsOf = (s: { mandatory?: string[]; onDemand?: string[] }) => ({
  ...(s.mandatory ? { mandatory: [...s.mandatory] } : {}),
  ...(s.onDemand ? { onDemand: [...s.onDemand] } : {}),
});

const SKRAFT_DIR = ".skraft/**";

/** Extension indépendante de `agent-studio.skraft` : son propre identifiant, ses propres agents. */
export const manifest: ExtensionManifest = {
  id: "agent-studio.skraft-workflow",
  version: "0.1.0",
  publisher: "agent-studio",
  engines: { appApi: "^0.1" },
  main: "dist/index.mjs",
  permissions: [
    "fs:read",
    `fs:write:${SKRAFT_DIR}`,
    "fs:write:docs/adr/**",
    "fs:write:@stack:acceptanceTests",
    "fs:write:@stack:unitTests",
    "fs:write:@stack:sources",
    "shell:test",
    "git:commit",
    "git:branch",
    "git:revert",
    "copilot:sessions",
    "net:none",
  ],
  contributes: {
    commands: [
      {
        name: "skraft-workflow",
        title: "skraft en workflow (essai)",
        description: "Pipeline skraft écrit en workflow rejouable ; pour l'instant préparation, difficulté, RESEARCH, questions ouvertes et DESIGN.",
      },
    ],
    agents: [
      { name: "skraft-classifier", title: "Évaluation de la difficulté", prompt: "agents/skraft-classifier.agent.md", role: ROLES.classifier, output: "submit_difficulty", modelClass: "light" },
      {
        name: "skraft-researcher",
        title: "Chercheur",
        prompt: "agents/skraft-researcher.agent.md",
        role: ROLES.researcher,
        output: "report_phase",
        modelClass: "standard",
        write: [SKRAFT_DIR],
        tools: ["list_files", "report_blocker"],
      },
      {
        name: "skraft-architect-model",
        title: "Architecte (modélisation)",
        prompt: "agents/skraft-architect-model.agent.md",
        role: ROLES.architectModel,
        output: "report_phase",
        modelClass: "strong",
        write: [SKRAFT_DIR],
        tools: ["list_files", "report_blocker"],
        skills: skillsOf(ROLE_SKILLS.architectModel),
      },
      // Aucun droit d'écriture direct dans docs/adr : seul render_adr y écrit.
      {
        name: "skraft-architect-decide",
        title: "Architecte (décisions)",
        prompt: "agents/skraft-architect-decide.agent.md",
        role: ROLES.architectDecide,
        output: "report_phase",
        modelClass: "strong",
        write: [SKRAFT_DIR],
        tools: ["list_files", "render_adr", "report_blocker"],
        skills: skillsOf(ROLE_SKILLS.architectDecide),
      },
      {
        name: "skraft-acceptance",
        title: "Scénarios d'acceptance",
        prompt: "agents/skraft-acceptance.agent.md",
        role: ROLES.acceptance,
        output: "report_phase",
        modelClass: "standard",
        write: [SKRAFT_DIR, "@stack:acceptanceTests", "@stack:sources"],
        tools: ["list_files", "run_tests", "report_blocker"],
        skills: skillsOf(ROLE_SKILLS.acceptance),
      },
      {
        name: "skraft-test",
        title: "Tests unitaires",
        prompt: "agents/skraft-test.agent.md",
        role: ROLES.test,
        output: "report_phase",
        modelClass: "standard",
        write: ["@stack:unitTests"],
        tools: ["list_files", "run_tests", "run_lint", "report_blocker"],
        skills: skillsOf(ROLE_SKILLS.test),
      },
      {
        name: "skraft-dev",
        title: "Développement",
        prompt: "agents/skraft-dev.agent.md",
        role: ROLES.dev,
        output: "report_phase",
        modelClass: "standard",
        write: ["@stack:sources"],
        tools: ["list_files", "run_tests", "run_lint", "report_blocker"],
        skills: skillsOf(ROLE_SKILLS.dev),
      },
      ...LENSES.map((name) => ({
        name: `skraft-lens-${name}`,
        title: `Lentille ${name}`,
        prompt: `agents/skraft-lens-${name}.agent.md`,
        role: ROLES.lens,
        output: "submit_lens_verdict" as const,
        modelClass: LENS_MODEL_CLASS[name],
        skills: skillsOf(ROLE_SKILLS.lens),
      })),
    ],
    skills: SKILLS.map((name) => ({ name, path: `skills/${name}` })),
    tools: [{ name: "render_adr", description: "Rédige un ADR au statut Proposed dans docs/adr, depuis le gabarit du projet." }],
    tasks: [
      {
        name: "skraft-workflow",
        title: "skraft en workflow (essai)",
        states: { "DÉBUT": "Préparation et difficulté", RESEARCH: "Enquête sur le code existant", DESIGN: "Conception", DISTILL: "Scénarios d'acceptance", DELIVER: "Implémentation en TDD" },
        milestones: ["RESEARCH", "DESIGN", "DISTILL", "DELIVER"],
      },
    ],
  },
};
