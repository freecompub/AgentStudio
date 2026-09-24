import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "ext-tdd", include: ["test/**/*.test.ts"], testTimeout: 60_000 } });
