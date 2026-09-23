import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "extension-installer", include: ["test/**/*.test.ts"] } });
