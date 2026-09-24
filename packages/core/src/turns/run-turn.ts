import type { AgentEvent, AgentSession } from "../protocols/agent-runtime.js";

/**
 * Ces erreurs sont définies dans `@agent-studio/extension-api` : une extension doit pouvoir les
 * lever sans dépendre du cœur (D10). Réexportées ici pour tout le reste du cœur.
 */
export { EnvFailureError, TurnTimeoutError, WorkDefectError } from "@agent-studio/extension-api";
import { EnvFailureError, TurnTimeoutError, WorkDefectError } from "@agent-studio/extension-api";

/** Signe de vie émis hors session (sortie d'un outil long exécuté par notre code, §6.4). */
export interface Heartbeat {
  beat(): void;
  onBeat(cb: () => void): () => void;
}

export function createHeartbeat(): Heartbeat {
  const listeners = new Set<() => void>();
  return {
    beat: () => listeners.forEach((l) => l()),
    onBeat(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export interface RunTurnOptions {
  heartbeat?: Heartbeat;
  /** Seuil d'inactivité ; défaut 5 min. */
  idleMs?: number;
  onEvent?: (e: AgentEvent) => void;
}

/**
 * Exécute un tour d'agent sans délai fixe (D30) : `send()` non bloquant, chronomètre
 * d'inactivité réarmé par chaque événement, fin sur `idle`, `abort()` puis
 * `TurnTimeoutError` en cas de silence prolongé.
 */
export function runTurn(session: AgentSession, prompt: string, opts: RunTurnOptions = {}): Promise<void> {
  const idleMs = opts.idleMs ?? 5 * 60_000;
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer = setTimeout(onSilence, idleMs);

    const off = session.onEvent((ev) => {
      if (settled) return;
      clearTimeout(timer);
      timer = setTimeout(onSilence, idleMs);
      opts.onEvent?.(ev);
      if (ev.type === "idle") finish(() => resolve());
      else if (ev.type === "error") finish(() => reject(new EnvFailureError(ev.message)));
    });

    const offBeat = opts.heartbeat?.onBeat(() => {
      if (settled) return;
      clearTimeout(timer);
      timer = setTimeout(onSilence, idleMs);
    });

    function finish(settle: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      off();
      offBeat?.();
      settle();
    }

    function onSilence(): void {
      finish(() => {
        session.abort().then(
          () => reject(new TurnTimeoutError(idleMs)),
          () => reject(new TurnTimeoutError(idleMs)),
        );
      });
    }

    session.send(prompt).catch((err: unknown) => finish(() => reject(err)));
  });
}
