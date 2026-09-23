import { randomUUID } from "node:crypto";
import type { ConsentRequest } from "@agent-studio/extension-installer";
import type { EventSink } from "./protocols.js";

/** Accord d'installation demandé dans la fenêtre (écran d'installation, §5.3). Sans réponse : refus. */
export function createIpcConsent(sink: EventSink, timeoutMs = 10 * 60_000) {
  const pending = new Map<string, (accept: boolean) => void>();
  return {
    ask(req: ConsentRequest): Promise<boolean> {
      const id = randomUUID();
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => settle(false), timeoutMs);
        function settle(accept: boolean) {
          clearTimeout(timer);
          pending.delete(id);
          resolve(accept);
        }
        pending.set(id, settle);
        sink.emit("extension-consent:request", { id, ...req });
      });
    },
    respond(id: string, accept: boolean): void {
      pending.get(id)?.(accept);
    },
  };
}
