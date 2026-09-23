import type { ExtensionManifest } from "@agent-studio/extension-api";
import { PHASE_LABELS } from "./model.js";
import { DEV_ROLE, PAIR_ROLE, PLANNER_ROLE, TEST_ROLE } from "./roles.js";

export const TEST_GLOBS = ["tests/**", "test/**", "**/*.test.*", "**/*.spec.*"];
export const SRC_GLOBS = ["src/**"];

export const manifest: ExtensionManifest = {
  id: "diabeo.tdd",
  version: "0.1.0",
  publisher: "diabeo",
  engines: { appApi: "^0.1" },
  permissions: [
    "fs:read",
    ...TEST_GLOBS.map((g) => `fs:write:${g}` as const),
    ...SRC_GLOBS.map((g) => `fs:write:${g}` as const),
    "git:commit",
    "git:revert",
    "shell:test",
    "copilot:sessions",
    "net:none",
  ],
  contributes: {
    commands: [
      {
        name: "tdd",
        title: "Implémenter en TDD",
        description: "Découpe la fonctionnalité en comportements, puis écrit pour chacun un test rouge, le code qui le fait passer et un nettoyage, sous le contrôle de l'application.",
      },
    ],
    agents: [
      { name: "tdd-planner", title: "Planificateur TDD", role: PLANNER_ROLE, output: "submit_plan" },
      { name: "tdd-pair", title: "Binôme TDD (un tour)", role: PAIR_ROLE, output: "report_phase", write: [...TEST_GLOBS, ...SRC_GLOBS], tools: ["run_tests"] },
      { name: "tdd-test", title: "Agent test", role: TEST_ROLE, output: "report_phase", write: TEST_GLOBS, tools: ["run_tests"] },
      { name: "tdd-dev", title: "Agent dev", role: DEV_ROLE, output: "report_phase", write: SRC_GLOBS, tools: ["run_tests"] },
    ],
    tasks: [
      {
        name: "tdd-cycle",
        title: "Cycle TDD",
        states: PHASE_LABELS,
        milestones: ["STEP_START", "DONE"],
        alerts: ["ESCALATED", "ABORTED"],
      },
    ],
  },
};
