import type { ExtensionManifest } from "@agent-studio/extension-api";
import { STAGE_LABELS } from "./model.js";
import { LENS_FOCUS, LENS_MODEL_CLASS, ROLE_MODEL_CLASS, ROLE_SKILLS, ROLES, SKILLS } from "./roles.js";

/** Fichier de rôle d'un agent, relatif au dossier de l'extension. */
const agentFile = (name: string) => `agents/${name}.agent.md`;
/** Skills d'un rôle, en tableaux modifiables pour le type du manifeste. */
const skillsOf = (s: { readonly mandatory?: readonly string[]; readonly onDemand?: readonly string[] }) => ({
  ...(s.mandatory ? { mandatory: [...s.mandatory] } : {}),
  ...(s.onDemand ? { onDemand: [...s.onDemand] } : {}),
});

const SKRAFT_DIR = ".skraft/**";
/** Emplacements fournis par l'adaptateur de stack du projet, résolus à l'ouverture de session (§10). */
const ACCEPTANCE = "@stack:acceptanceTests";
const UNIT_TESTS = "@stack:unitTests";
const SOURCES = "@stack:sources";

export const manifest: ExtensionManifest = {
  id: "agent-studio.skraft",
  version: "0.1.0",
  publisher: "agent-studio",
  engines: { appApi: "^0.1" },
  main: "dist/index.mjs",
  permissions: [
    "fs:read",
    `fs:write:${SKRAFT_DIR}`,
    "fs:write:docs/adr/**",
    `fs:write:${ACCEPTANCE}`,
    `fs:write:${UNIT_TESTS}`,
    `fs:write:${SOURCES}`,
    "shell:test",
    "git:commit",
    "git:branch",
    "git:revert",
    "copilot:sessions",
    "net:none",
  ],
  contributes: {
    commands: [
      { name: "skraft", title: "Livrer une story avec skraft", description: "Mène une story de la recherche à la livraison : conception, scénarios d'acceptance, code en TDD, revues." },
      { name: "skraft-status", title: "État du pipeline skraft", description: "Affiche la phase, la difficulté et les décisions en attente des pipelines skraft." },
    ],
    // Contenu des rôles dans agents/*.agent.md (partagé avec Copilot CLI et Claude Code) ; ici,
    // l'orchestration propre à agent-studio : consignes, outil de fin, périmètre, outils, skills (ADR 0024).
    agents: [
      { name: "skraft-classifier", title: "Évaluation de la difficulté", prompt: agentFile("skraft-classifier"), role: ROLES.classifier, output: "submit_difficulty", modelClass: ROLE_MODEL_CLASS.classifier },
      {
        name: "skraft-researcher",
        title: "Chercheur",
        prompt: agentFile("skraft-researcher"),
        role: ROLES.researcher,
        output: "report_phase",
        modelClass: ROLE_MODEL_CLASS.researcher,
        write: [SKRAFT_DIR],
        tools: ["list_files", "report_blocker"],
      },
      {
        name: "skraft-architect-model",
        title: "Architecte (modélisation)",
        prompt: agentFile("skraft-architect-model"),
        role: ROLES.architectModel,
        output: "report_phase",
        modelClass: ROLE_MODEL_CLASS.architectModel,
        write: [SKRAFT_DIR],
        tools: ["list_files", "report_blocker"],
        skills: skillsOf(ROLE_SKILLS.architectModel),
      },
      // Aucun droit d'écriture direct dans docs/adr : seul render_adr y écrit (§6.3).
      {
        name: "skraft-architect-decide",
        title: "Architecte (décisions)",
        prompt: agentFile("skraft-architect-decide"),
        role: ROLES.architectDecide,
        output: "report_phase",
        modelClass: ROLE_MODEL_CLASS.architectDecide,
        write: [SKRAFT_DIR],
        tools: ["list_files", "render_adr", "report_blocker"],
        skills: skillsOf(ROLE_SKILLS.architectDecide),
      },
      {
        name: "skraft-acceptance",
        title: "Scénarios d'acceptance",
        prompt: agentFile("skraft-acceptance"),
        role: ROLES.acceptance,
        output: "report_phase",
        modelClass: ROLE_MODEL_CLASS.acceptance,
        write: [SKRAFT_DIR, ACCEPTANCE, SOURCES],
        tools: ["list_files", "run_tests", "report_blocker"],
        skills: skillsOf(ROLE_SKILLS.acceptance),
      },
      {
        name: "skraft-test",
        title: "Tests unitaires",
        prompt: agentFile("skraft-test"),
        role: ROLES.test,
        output: "report_phase",
        modelClass: ROLE_MODEL_CLASS.test,
        write: [UNIT_TESTS],
        tools: ["list_files", "run_tests", "run_lint", "report_blocker"],
        skills: skillsOf(ROLE_SKILLS.test),
      },
      {
        name: "skraft-dev",
        title: "Développement",
        prompt: agentFile("skraft-dev"),
        role: ROLES.dev,
        output: "report_phase",
        modelClass: ROLE_MODEL_CLASS.dev,
        write: [SOURCES],
        tools: ["list_files", "run_tests", "run_lint", "report_blocker"],
        skills: skillsOf(ROLE_SKILLS.dev),
      },
      ...(Object.keys(LENS_FOCUS) as (keyof typeof LENS_FOCUS)[]).map((name) => ({
        name: `skraft-lens-${name}`,
        title: `Lentille ${name}`,
        prompt: agentFile(`skraft-lens-${name}`),
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
        name: "skraft-pipeline",
        title: "Pipeline skraft",
        states: STAGE_LABELS,
        milestones: ["RESEARCH", "DESIGN", "DISTILL", "DELIVER", "RATIFICATION", "DONE"],
        alerts: ["BLOCKED", "ESCALATED", "ABORTED"],
      },
    ],
  },
};
