import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Un dossier temporaire par lancement, supprimé à la fin (fuite de /tmp, 15/10).
    globalSetup: ["./vitest.global-setup.ts"],
    projects: ["packages/*", "extensions/*", "tests/*", "scripts/banc", "apps/desktop"],
  },
});
