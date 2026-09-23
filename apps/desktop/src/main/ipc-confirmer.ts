import { randomUUID } from "node:crypto";
import type { UserConfirmer } from "@agent-studio/core";
import type { EventSink } from "./protocols.js";

export interface IpcConfirmer extends UserConfirmer {
  respond(id: string, allowed: boolean): void;
}

/**
 * Confirmations posées dans la fenêtre. Canal réservé à l'arbitre du cœur (D34).
 * Sans réponse dans le délai, la demande est retirée et vaut refus.
 */
export function createIpcConfirmer(sink: EventSink, timeoutMs = 5 * 60_000): IpcConfirmer {
  const pending = new Map<string, (allowed: boolean) => void>();
  return {
    confirm({ title, detail }) {
      const id = randomUUID();
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => settle(false), timeoutMs);
        function settle(allowed: boolean) {
          clearTimeout(timer);
          pending.delete(id);
          resolve(allowed);
        }
        pending.set(id, settle);
        sink.emit("confirm:request", { id, title, detail });
      });
    },
    respond(id, allowed) {
      pending.get(id)?.(allowed);
    },
  };
}
