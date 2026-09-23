import type { AgentEvent, AgentSession } from "../protocols/agent-runtime.js";

/**
 * Double d'`AgentSession` piloté par le test : enregistre les prompts envoyés,
 * émet les événements à la demande, et peut rejouer un script à chaque `send()`.
 */
export class ScriptedSession implements AgentSession {
  readonly sent: string[] = [];
  aborted = false;
  closed = false;
  private listeners = new Set<(e: AgentEvent) => void>();
  private sendError: Error | undefined;
  private scripts: ((prompt: string, session: ScriptedSession) => void | Promise<void>)[] = [];

  constructor(readonly id: string) {}

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Programme la réaction au prochain `send()` (événements émis de façon asynchrone). */
  onNextSend(script: (prompt: string, session: ScriptedSession) => void | Promise<void>): this {
    this.scripts.push(script);
    return this;
  }

  failNextSend(err: Error): void {
    this.sendError = err;
  }

  async send(prompt: string): Promise<void> {
    if (this.sendError) {
      const err = this.sendError;
      this.sendError = undefined;
      throw err;
    }
    this.sent.push(prompt);
    const script = this.scripts.shift();
    if (script) queueMicrotask(() => void script(prompt, this));
  }

  emit(e: AgentEvent): void {
    for (const l of [...this.listeners]) l(e);
  }

  onEvent(cb: (e: AgentEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Comme un vrai runtime, une interruption clôt le tour par `idle`. */
  async abort(): Promise<void> {
    this.aborted = true;
    this.emit({ type: "idle" });
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

/** Réponse simple : un message complet puis `idle`. */
export function reply(text: string) {
  return (_prompt: string, s: ScriptedSession) => {
    s.emit({ type: "message", text });
    s.emit({ type: "idle" });
  };
}
