import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

/**
 * Paquets internes du monorepo : ils exportent directement `src/index.ts` (ADR 0001),
 * donc ils doivent être intégrés au bundle et jamais externalisés — sinon Node reçoit
 * du TypeScript non transformé. La liste est dérivée des dépendances pour rester
 * synchronisée quand un paquet est ajouté.
 */
const packageJson = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "package.json"), "utf8"),
) as { dependencies?: Record<string, string> };
const INTERNAL = Object.keys(packageJson.dependencies ?? {}).filter((nom) =>
  nom.startsWith("@agent-studio/"),
);

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: INTERNAL },
      rollupOptions: { input: { index: resolve(import.meta.dirname, "src/main/index.ts") } },
    },
  },
  preload: {
    build: {
      // Un preload sandboxé doit être en CommonJS.
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, "src/preload/index.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, "src/renderer"),
    plugins: [react()],
    build: { rollupOptions: { input: resolve(import.meta.dirname, "src/renderer/index.html") } },
  },
});
