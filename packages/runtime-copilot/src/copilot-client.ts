import { CopilotClient } from "@github/copilot-sdk";
import type { CopilotClientOptions as SdkCopilotClientOptions } from "@github/copilot-sdk";
import type { CopilotClientPort } from "./protocols.js";

export type CopilotClientOptions = {
  gitHubToken: string;
  hostname?: string;
  baseDirectory?: string;
  logLevel?: "none" | "error" | "warning" | "info" | "debug";
};

/**
 * `env` remplace l'environnement du CLI au lieu de s'y ajouter (SDK 1.0.14, `options.env ?? process.env`) :
 * on part donc de celui du processus et on n'y fixe que l'hôte du jeton.
 */
export function sdkCopilotClientOptions(opts: CopilotClientOptions, ambiant: NodeJS.ProcessEnv = process.env): SdkCopilotClientOptions {
  const shared = {
    logLevel: opts.logLevel ?? "error",
    ...(opts.baseDirectory ? { baseDirectory: opts.baseDirectory } : {}),
  };
  return {
    ...shared,
    gitHubToken: opts.gitHubToken,
    useLoggedInUser: false,
    env: { ...ambiant, GH_HOST: opts.hostname ?? "github.com" },
  };
}

/** Client Copilot réel : le jeton gh et son hôte restent associés (GitHub.com ou Enterprise Cloud). */
export function createCopilotClient(opts: CopilotClientOptions): CopilotClientPort {
  return new CopilotClient(sdkCopilotClientOptions(opts));
}
