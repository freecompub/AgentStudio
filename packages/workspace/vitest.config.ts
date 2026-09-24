import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "workspace", include: ["test/**/*.test.ts"] } });
