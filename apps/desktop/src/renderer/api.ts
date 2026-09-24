import type { EventChannel, EventPayload, RequestChannel, RequestInput, RequestOutput } from "../shared/ipc-contract";

/** Seul point d'accès du renderer au processus principal. */
export const api = {
  call<C extends RequestChannel>(channel: C, input: RequestInput<C>): Promise<RequestOutput<C>> {
    return window.agentStudio.invoke(channel, input).catch((err: unknown) => {
      // Electron préfixe le message : « Error invoking remote method 'x': Error: … »
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    });
  },
  on<C extends EventChannel>(channel: C, cb: (payload: EventPayload<C>) => void): () => void {
    return window.agentStudio.on(channel, cb);
  },
};
