import type { ExtensionManifest } from "@agent-studio/extension-api";
import { STAGE_LABELS } from "./model.js";
import { LENS_FOCUS, ROLES } from "./roles.js";

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
    agents: [
      { name: "skraft-classifier", title: "Évaluation de la difficulté", role: ROLES.classifier, output: "submit_difficulty" },
      { name: "skraft-researcher", title: "Chercheur", role: ROLES.researcher, output: "report_phase", write: [SKRAFT_DIR], tools: ["report_blocker"] },
      { name: "skraft-architect-model", title: "Architecte (modélisation)", role: ROLES.architectModel, output: "report_phase", write: [SKRAFT_DIR], tools: ["report_blocker"] },
      // Aucun droit d'écriture direct dans docs/adr : seul render_adr y écrit (§6.3).
      { name: "skraft-architect-decide", title: "Architecte (décisions)", role: ROLES.architectDecide, output: "report_phase", write: [SKRAFT_DIR], tools: ["render_adr", "report_blocker"] },
      { name: "skraft-acceptance", title: "Scénarios d'acceptance", role: ROLES.acceptance, output: "report_phase", write: [SKRAFT_DIR, ACCEPTANCE], tools: ["run_tests", "report_blocker"] },
      { name: "skraft-test", title: "Tests unitaires", role: ROLES.dev, output: "report_phase", write: [UNIT_TESTS], tools: ["run_tests", "report_blocker"] },
      { name: "skraft-dev", title: "Développement", role: ROLES.dev, output: "report_phase", write: [SOURCES], tools: ["run_tests", "report_blocker"] },
      ...(Object.entries(LENS_FOCUS) as [keyof typeof LENS_FOCUS, string][]).map(([name, focus]) => ({
        name: `skraft-lens-${name}`,
        title: `Lentille ${name}`,
        role: ROLES.lens(name, focus),
        output: "submit_lens_verdict" as const,
      })),
    ],
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
