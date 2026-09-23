import type { AgentEvent, AgentSession } from "../protocols/agent-runtime.js";

/**
 * Défaut de travail de l'agent (silence, sortie structurée absente…) : réessai ciblé
 * si le budget le permet, jamais d'escalade immédiate (D24, D25).
 */
export class WorkDefectError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkDefectError";
  }
}

/** Silence de l'agent au-delà du seuil : traité comme un rejet par le réducteur (§6.2). */
export class TurnTimeoutError extends WorkDefectError {
  constructor(readonly idleMs: number) {
    super(`Aucune activité de l'agent depuis ${Math.round(idleMs / 1000)} s`);
    this.name = "TurnTimeoutError";
  }
}

/** Défaut d'environnement (runtime, quota, API) : escalade immédiate (D25). */
export class EnvFailureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EnvFailureError";
  }
}

export interface RunTurnOptions {
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

    function finish(settle: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      off();
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
