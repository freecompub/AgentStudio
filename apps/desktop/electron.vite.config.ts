import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

/** Paquets internes du monorepo : exportent du TypeScript, donc intégrés au bundle. */
const INTERNAL = ["@agent-studio/core", "@agent-studio/workspace", "@agent-studio/runtime-copilot", "@agent-studio/github-auth"];

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
