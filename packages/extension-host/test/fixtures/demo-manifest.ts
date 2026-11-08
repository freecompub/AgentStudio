import type { ExtensionManifest } from "@agent-studio/extension-api";

/** Sans git:commit : la commande « commit » doit être refusée (D11). */
export const DEMO_MANIFEST: ExtensionManifest = {
  id: "diabeo.demo",
  version: "0.1.0",
  publisher: "diabeo",
  engines: { appApi: "^0.1" },
  main: "index.mjs",
  permissions: ["fs:read", "shell:test", "copilot:sessions"],
  contributes: {
    commands: ["hello", "commit", "read-system", "crash", "files", "pile", "pile-non-decide"].map((name) => ({ name, title: name, description: `Démo ${name}` })),
    tasks: [{ name: "count", title: "Compteur", states: { A: "A" } }],
    tools: [{ name: "shout", description: "Met un texte en majuscules" }],
    agents: [{ name: "echoer", title: "Écho", role: "Tu réponds fort.", output: "report_phase", tools: ["shout"] }],
  },
};
