import type { ExtensionManifest } from "@agent-studio/extension-api";
import { ROLES } from "./roles.js";

const SKRAFT_DIR = ".skraft/**";

/** Extension indépendante de `agent-studio.skraft` : son propre identifiant, ses propres agents. */
export const manifest: ExtensionManifest = {
  id: "agent-studio.skraft-workflow",
  version: "0.1.0",
  publisher: "agent-studio",
  engines: { appApi: "^0.1" },
  main: "dist/index.mjs",
  permissions: ["fs:read", `fs:write:${SKRAFT_DIR}`, "git:commit", "git:branch", "git:revert", "copilot:sessions", "net:none"],
  contributes: {
    commands: [
      {
        name: "skraft-workflow",
        title: "skraft en workflow (essai)",
        description: "Pipeline skraft écrit en workflow rejouable ; pour l'instant préparation, difficulté, RESEARCH et questions ouvertes.",
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
    ],
    tasks: [
      {
        name: "skraft-workflow",
        title: "skraft en workflow (essai)",
        states: { "DÉBUT": "Préparation et difficulté", RESEARCH: "Enquête sur le code existant" },
        milestones: ["RESEARCH"],
      },
    ],
  },
};
