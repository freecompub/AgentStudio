import { randomUUID } from "node:crypto";
import type { ConfirmAnswer, UserConfirmer } from "@agent-studio/core";
import type { EventSink } from "./protocols.js";

export interface IpcConfirmer extends UserConfirmer {
  respond(id: string, answer: ConfirmAnswer): void;
}

/**
 * Confirmations posées dans la fenêtre. Canal réservé à l'arbitre du cœur (D34).
 * Sans réponse dans le délai, la demande est retirée et vaut refus.
 */
export function createIpcConfirmer(sink: EventSink, timeoutMs = 5 * 60_000): IpcConfirmer {
  const pending = new Map<string, (answer: ConfirmAnswer) => void>();
  return {
    confirm({ title, detail }) {
      const id = randomUUID();
      return new Promise<ConfirmAnswer>((resolve) => {
        const timer = setTimeout(() => settle("deny"), timeoutMs);
        function settle(answer: ConfirmAnswer) {
          clearTimeout(timer);
          pending.delete(id);
          resolve(answer);
        }
        pending.set(id, settle);
        sink.emit("confirm:request", { id, title, detail });
      });
    },
    respond(id, answer) {
      pending.get(id)?.(answer);
    },
  };
}
