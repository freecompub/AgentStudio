import type { Logger } from "@agent-studio/core";
import { requests, type RequestChannel } from "../shared/ipc-contract.js";
import type { AppController } from "./app-controller.js";

export interface IpcRouterOptions {
  /** Seule la fenêtre de l'application peut appeler le principal. */
  isTrustedSender(url: string): boolean;
  logger?: Logger;
}

export interface IpcRouter {
  handle(channel: string, rawInput: unknown, senderUrl: string): Promise<unknown>;
}

/**
 * Point d'entrée unique des requêtes du renderer : origine vérifiée, entrée et sortie
 * validées par schéma (§4.1). Les erreurs sont réduites à leur message.
 */
export function createIpcRouter(controller: Omit<AppController, "dispose">, opts: IpcRouterOptions): IpcRouter {
  return {
    async handle(channel, rawInput, senderUrl) {
      if (!opts.isTrustedSender(senderUrl)) throw new Error("Expéditeur non autorisé");
      if (!Object.hasOwn(requests, channel)) throw new Error(`Canal inconnu : ${channel}`);
      const c = channel as RequestChannel;
      const contract = requests[c];

      const input = contract.input.safeParse(rawInput ?? {});
      if (!input.success) throw new Error(`Requête invalide sur ${c}`);

      let output: unknown;
      try {
        output = await (controller[c] as (i: unknown) => Promise<unknown>)(input.data);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.logger?.warn("requête en échec", { channel: c, error: message });
        throw new Error(message);
      }

      const checked = contract.output.safeParse(output);
      if (!checked.success) {
        opts.logger?.error("réponse hors contrat", { channel: c });
        throw new Error(`Réponse invalide sur ${c}`);
      }
      return checked.data;
    },
  };
}
