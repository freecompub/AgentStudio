import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "github-auth", include: ["test/**/*.test.ts"] } });
