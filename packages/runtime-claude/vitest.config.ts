import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "runtime-claude", include: ["test/**/*.test.ts"] } });
