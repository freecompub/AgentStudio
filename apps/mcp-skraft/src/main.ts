/**
 * Point d'entrée du serveur MCP skraft : lancé par le client (Claude Code, Copilot CLI) comme
 * processus enfant, transport stdio (ADR 0068, point 3). Il vit le temps de la session du client ;
 * un run interrompu par sa fermeture reprend au démarrage suivant.
 */
import { homedir } from "node:os";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { assemblerServeur } from "./assemblage.js";

declare const __VERSION__: string | undefined;

const r = await assemblerServeur({
  home: homedir(),
  env: process.env,
  cwd: process.cwd(),
  racinePaquet: import.meta.dirname,
  version: typeof __VERSION__ === "string" ? __VERSION__ : "0.0.0",
});
if (!r.ok) {
  // stderr : le client l'affiche dans ses journaux ; stdout appartient au protocole.
  process.stderr.write(`${r.motif}\n`);
  process.exit(1);
}
let fermeture: Promise<void> | null = null;
const fermer = () => {
  // Fermeture normale : services libérés (sessions d'agent), verrous rendus.
  fermeture ??= r.projets.fermer().finally(() => process.exit(0));
  return fermeture;
};
process.stdin.on("close", () => void fermer());
process.on("SIGINT", () => void fermer());
process.on("SIGTERM", () => void fermer());
await r.mcp.connect(new StdioServerTransport());
