import type { AgentRuntime, AgentSessionConfig, RuntimeCapabilities } from "../protocols/agent-runtime.js";
import { ScriptedSession } from "./scripted-session.js";

/**
 * Faux `AgentRuntime` pour les tests d'intégration (§16) : aucune requête au LLM.
 * Les sessions sont des `ScriptedSession` que le test pilote.
 */
export class ScriptedRuntime implements AgentRuntime {
  readonly id = "fake" as const;
  readonly capabilities: RuntimeCapabilities = {
    inProcessHooks: true,
    customTools: "native",
    terminalTool: "native",
    fileMediation: false,
    usageUnit: "requests",
    resumableSessions: true,
  };
  readonly sessions = new Map<string, ScriptedSession>();
  readonly configs = new Map<string, AgentSessionConfig>();
  readonly deleted: string[] = [];
  started = false;
  /** Identifiants que `resumeSession` doit refuser (session disparue côté runtime). */
  readonly unresumable = new Set<string>();
  private counter = 0;

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  async openSession(cfg: AgentSessionConfig): Promise<ScriptedSession> {
    const session = new ScriptedSession(`fake-${++this.counter}`);
    this.sessions.set(session.id, session);
    this.configs.set(session.id, cfg);
    return session;
  }

  async resumeSession(id: string, cfg: AgentSessionConfig): Promise<ScriptedSession> {
    if (this.unresumable.has(id)) throw new Error(`Session introuvable : ${id}`);
    const session = this.sessions.get(id) ?? new ScriptedSession(id);
    this.sessions.set(id, session);
    this.configs.set(id, cfg);
    return session;
  }

  async deleteSession(id: string): Promise<void> {
    this.deleted.push(id);
    this.sessions.delete(id);
  }

  /** Dernière session ouverte ou reprise. */
  get last(): ScriptedSession {
    const all = [...this.sessions.values()];
    const s = all[all.length - 1];
    if (!s) throw new Error("Aucune session ouverte");
    return s;
  }
}
