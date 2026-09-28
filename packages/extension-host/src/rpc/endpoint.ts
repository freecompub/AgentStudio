import { EnvFailureError, WorkDefectError } from "@agent-studio/core";
import type { MessageChannelLike, RpcMessage } from "./protocol.js";

export type RpcHandler = (args: unknown[], ctx: { signal: AbortSignal }) => Promise<unknown>;

export interface RpcEndpoint {
  call(method: string, args: unknown[], opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
  /** Refuse tout appel futur et fait échouer les appels en cours (hôte arrêté ou planté). */
  close(reason: string): void;
}

/** Appel interrompu parce que l'autre côté a disparu : panne d'environnement (D25). */
export class RpcClosedError extends EnvFailureError {
  constructor(reason: string) {
    super(reason);
    this.name = "RpcClosedError";
  }
}

/** Reconstruit la nature d'une erreur distante, pour que le moteur la traite correctement (D25). */
function reviveError(e: { name: string; message: string }): Error {
  let err: Error;
  if (e.name === "WorkDefectError" || e.name === "TurnTimeoutError" || e.name === "TurnBudgetError" || e.name === "TurnCostError" || e.name === "TurnContextError") err = new WorkDefectError(e.message);
  else if (e.name === "EnvFailureError" || e.name === "RpcClosedError") err = new EnvFailureError(e.message);
  else err = new Error(e.message);
  err.name = e.name;
  return err;
}

function ensureSerializable(args: unknown[]): void {
  const walk = (v: unknown, depth: number): void => {
    if (depth > 64) throw new Error("Arguments RPC trop profonds");
    if (typeof v === "function" || typeof v === "symbol" || typeof v === "bigint") throw new Error("Argument RPC non sérialisable");
    if (v && typeof v === "object") for (const x of Object.values(v)) walk(x, depth + 1);
  };
  walk(args, 0);
}

export function createRpcEndpoint(channel: MessageChannelLike, handlers: Record<string, RpcHandler>): RpcEndpoint {
  let nextId = 1;
  let closed: string | null = null;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  const running = new Map<number, AbortController>();

  const off = channel.onMessage((msg) => {
    switch (msg.t) {
      case "call": {
        const handler = Object.hasOwn(handlers, msg.method) ? handlers[msg.method] : undefined;
        if (!handler) {
          channel.send({ t: "err", id: msg.id, error: { name: "Error", message: `Méthode RPC inconnue : ${msg.method}` } });
          return;
        }
        const ac = new AbortController();
        running.set(msg.id, ac);
        handler(msg.args, { signal: ac.signal }).then(
          (value) => {
            running.delete(msg.id);
            if (!closed) channel.send({ t: "ok", id: msg.id, value: value === undefined ? null : value });
          },
          (err: unknown) => {
            running.delete(msg.id);
            const e = err instanceof Error ? err : new Error(String(err));
            if (!closed) channel.send({ t: "err", id: msg.id, error: { name: e.name, message: e.message } });
          },
        );
        return;
      }
      case "abort":
        running.get(msg.id)?.abort();
        return;
      case "ok":
        pending.get(msg.id)?.resolve(msg.value);
        pending.delete(msg.id);
        return;
      case "err":
        pending.get(msg.id)?.reject(reviveError(msg.error));
        pending.delete(msg.id);
        return;
    }
  });

  return {
    call(method, args, opts = {}) {
      if (closed) return Promise.reject(new RpcClosedError(closed));
      try {
        ensureSerializable(args);
      } catch (err) {
        return Promise.reject(err);
      }
      const id = nextId++;
      return new Promise((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const cleanup = () => {
          clearTimeout(timer);
          opts.signal?.removeEventListener("abort", onAbort);
        };
        const onAbort = () => channel.send({ t: "abort", id });
        pending.set(id, {
          resolve: (v) => (cleanup(), resolve(v === null ? undefined : v)),
          reject: (e) => (cleanup(), reject(e)),
        });
        if (opts.timeoutMs !== undefined)
          timer = setTimeout(() => {
            pending.delete(id);
            channel.send({ t: "abort", id });
            cleanup();
            reject(new Error(`${method} : délai de ${opts.timeoutMs} ms dépassé`));
          }, opts.timeoutMs);
        opts.signal?.addEventListener("abort", onAbort, { once: true });
        channel.send({ t: "call", id, method, args });
      });
    },
    close(reason) {
      if (closed) return;
      closed = reason;
      off();
      for (const ac of running.values()) ac.abort();
      running.clear();
      for (const p of pending.values()) p.reject(new RpcClosedError(reason));
      pending.clear();
    },
  };
}

/** Deux extrémités reliées en mémoire (tests, hôte en processus). */
export function memoryChannelPair(): [MessageChannelLike, MessageChannelLike] {
  const make = (): MessageChannelLike & { peer?: MessageChannelLike & { deliver(m: RpcMessage): void }; deliver(m: RpcMessage): void } => {
    const listeners = new Set<(m: RpcMessage) => void>();
    const self = {
      send: (m: RpcMessage) => queueMicrotask(() => self.peer?.deliver(structuredClone(m))),
      onMessage: (cb: (m: RpcMessage) => void) => (listeners.add(cb), () => void listeners.delete(cb)),
      deliver: (m: RpcMessage) => listeners.forEach((l) => l(m)),
    } as MessageChannelLike & { peer?: ReturnType<typeof make>; deliver(m: RpcMessage): void };
    return self;
  };
  const a = make();
  const b = make();
  a.peer = b;
  b.peer = a;
  return [a, b];
}
