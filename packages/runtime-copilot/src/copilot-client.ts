import { CopilotClient } from "@github/copilot-sdk";
import type { CopilotClientPort } from "./protocols.js";

export interface CopilotClientOptions {
  /** Jeton GitHub obtenu via `gh auth token` (D4). */
  gitHubToken: string;
  /** Dossier des données du runtime (sessions) ; défaut `~/.copilot`. */
  baseDirectory?: string;
  logLevel?: "none" | "error" | "warning" | "info" | "debug";
}

/** Client Copilot réel, authentifié par jeton explicite (jamais par la connexion du CLI). */
export function createCopilotClient(opts: CopilotClientOptions): CopilotClientPort {
  return new CopilotClient({
    gitHubToken: opts.gitHubToken,
    useLoggedInUser: false,
    logLevel: opts.logLevel ?? "error",
    ...(opts.baseDirectory ? { baseDirectory: opts.baseDirectory } : {}),
  });
}
