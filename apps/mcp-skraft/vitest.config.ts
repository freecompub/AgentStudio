import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "mcp-skraft", include: ["test/**/*.test.ts"] } });
