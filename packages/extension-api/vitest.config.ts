import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "extension-api", include: ["test/**/*.test.ts"] } });
