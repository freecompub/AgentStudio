import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "extensions/*", "tests/*", "scripts/banc", "apps/desktop"],
  },
});
