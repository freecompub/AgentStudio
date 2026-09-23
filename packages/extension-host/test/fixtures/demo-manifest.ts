import type { ExtensionManifest } from "@agent-studio/extension-api";

/** Sans git:commit : la commande « commit » doit être refusée (D11). */
export const DEMO_MANIFEST: ExtensionManifest = {
  id: "diabeo.demo",
  version: "0.1.0",
  publisher: "diabeo",
  engines: { appApi: "^0.1" },
  main: "index.mjs",
  permissions: ["fs:read", "shell:test"],
  contributes: {
    commands: ["hello", "commit", "read-system", "crash", "files"].map((name) => ({ name, title: name, description: `Démo ${name}` })),
    tasks: [{ name: "count", title: "Compteur", states: { A: "A" } }],
  },
};
