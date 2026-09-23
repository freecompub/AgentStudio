import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "extension-packaging", include: ["test/**/*.test.ts"] } });
