import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "project-services", include: ["test/**/*.test.ts"] } });
