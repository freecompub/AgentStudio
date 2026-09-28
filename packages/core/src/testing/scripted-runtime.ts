import type { AgentRuntime, AgentSessionConfig, ModelChoice, RuntimeCapabilities } from "../protocols/agent-runtime.js";
import { ScriptedSession } from "./scripted-session.js";

/** Ce qu'un comportement d'agent scripté peut faire pendant un tour. */
export interface ScriptedTurn {
  prompt: string;
  config: AgentSessionConfig;
  session: ScriptedSession;
  /** Appelle un de nos outils comme le ferait le modèle ; renvoie le résultat ou lève l'erreur du handler. */
  callTool(name: string, args: unknown): Promise<unknown>;
  /** Le tour ne se termine jamais (agent muet, plantage). */
  hang(): void;
}

export type ScriptedBehavior = (turn: ScriptedTurn) => void | Promise<void>;

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
  /** Modèles annoncés par ce faux runtime ; `null` simule un runtime qui n'en propose pas. */
  models: ModelChoice[] | null = [];
  readonly sessions = new Map<string, ScriptedSession>();
  readonly configs = new Map<string, AgentSessionConfig>();
  readonly deleted: string[] = [];
  /** Toutes les sessions ouvertes ou reprises, y compris supprimées depuis. */
  readonly history: ScriptedSession[] = [];
  started = false;
  /** Identifiants que `resumeSession` doit refuser (session disparue côté runtime). */
  readonly unresumable = new Set<string>();
  private counter = 0;
  private behaviors = new Map<string, ScriptedBehavior>();

  /** Comportement joué à chaque tour des sessions ouvertes pour `role` (tâches, agents). */
  behave(role: string, behavior: ScriptedBehavior): this {
    this.behaviors.set(role, behavior);
    return this;
  }

  private wire(session: ScriptedSession, cfg: AgentSessionConfig): void {
    const behavior = this.behaviors.get(cfg.role);
    if (!behavior) return;
    session.defaultScript = async (prompt, s) => {
      let hung = false;
      try {
        await behavior({
          prompt,
          config: cfg,
          session: s,
          hang: () => void (hung = true),
          callTool: async (name, args) => {
            const tool = cfg.tools.find((t) => t.name === name);
            if (!tool) throw new Error(`Outil inconnu : ${name}`);
            s.emit({ type: "tool-start", toolCallId: name, toolName: name });
            const r = await tool.handler(args);
            s.emit({ type: "tool-end", toolCallId: name, success: true });
            return r;
          },
        });
      } catch (err) {
        s.emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
        return;
      }
      if (!hung) s.emit({ type: "idle" });
    };
  }

  async listModels(): Promise<ModelChoice[]> {
    return this.models ?? [];
  }

  /** Fait échouer `start()` : sert à vérifier qu'un runtime en échec n'est pas mémorisé. */
  failStart: Error | null = null;

  async start(): Promise<void> {
    if (this.failStart) throw this.failStart;
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  async openSession(cfg: AgentSessionConfig): Promise<ScriptedSession> {
    const session = new ScriptedSession(`fake-${++this.counter}`);
    this.sessions.set(session.id, session);
    this.configs.set(session.id, cfg);
    this.history.push(session);
    this.wire(session, cfg);
    return session;
  }

  async resumeSession(id: string, cfg: AgentSessionConfig): Promise<ScriptedSession> {
    if (this.unresumable.has(id)) throw new Error(`Session introuvable : ${id}`);
    const session = this.sessions.get(id) ?? new ScriptedSession(id);
    this.sessions.set(id, session);
    this.configs.set(id, cfg);
    this.history.push(session);
    // Une vraie session reprise reçoit la configuration du nouveau tour — outils et garde compris.
    // Sans ce recâblage, le double rejouerait le comportement du tour précédent.
    this.wire(session, cfg);
    return session;
  }

  async deleteSession(id: string): Promise<void> {
    this.deleted.push(id);
    this.sessions.delete(id);
  }

  /** Dernière session ouverte ou reprise. */
  get last(): ScriptedSession {
    const s = this.history[this.history.length - 1];
    if (!s) throw new Error("Aucune session ouverte");
    return s;
  }
}
