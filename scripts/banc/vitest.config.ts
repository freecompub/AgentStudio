import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "banc", include: ["**/*.test.ts"] } });
