import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "stack-adapters", include: ["test/**/*.test.ts"], testTimeout: 120_000 } });
