import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "runtime-copilot", include: ["test/**/*.test.ts"] } });
