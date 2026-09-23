import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "task-engine", include: ["test/**/*.test.ts"] } });
