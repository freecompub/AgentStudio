import { defineConfig } from "@playwright/test";

/**
 * Essais de bout en bout : la vraie application Electron, lancée depuis son build.
 *
 * Séparés de la suite Vitest, et pour une raison concrète : ils exigent le binaire Electron
 * (~250 Mo), que la CI principale ne télécharge pas (`ELECTRON_SKIP_BINARY_DOWNLOAD`). Ils
 * tournent donc dans leur propre job, après `pnpm build`.
 *
 * Aucune requête à Copilot : l'application est lancée en mode d'essai, runtime scripté
 * (`apps/desktop/src/main/mode-essai.ts`).
 */
export default defineConfig({
  testDir: "apps/desktop/test/e2e",
  // Electron ne se parallélise pas utilement ici : chaque essai lance un processus complet.
  workers: 1,
  // Un démarrage d'Electron en CI est lent ; l'échec doit venir de l'application, pas du délai.
  timeout: 120_000,
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],
  forbidOnly: !!process.env["CI"],
  retries: 0,
});
