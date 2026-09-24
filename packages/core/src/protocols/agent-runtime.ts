/**
 * Port `AgentRuntime` (§4.3, D35). Le cœur ne dépend jamais directement d'un SDK :
 * chaque runtime (Copilot SDK, Claude Agent SDK, ACP) en est un adaptateur.
 * Aucun objet de ce port n'est jamais exposé à une extension (D10).
 */

export type RuntimeId = "copilot-sdk" | "claude-agent-sdk" | "acp" | "fake";

export interface RuntimeCapabilities {
  /** Hooks en code avant/après outil. */
  inProcessHooks: boolean;
  /** Comment sont fournis nos outils (run_tests, report_phase…). */
  customTools: "native" | "mcp";
  /** Comment forcer la sortie structurée. */
  terminalTool: "native" | "stop-hook" | "reprompt";
  /** Les écritures de fichiers passent-elles par nous ? */
  fileMediation: boolean;
  usageUnit: "requests" | "tokens";
  /** Le runtime sait reprendre une session après redémarrage. */
  resumableSessions: boolean;
}

/**
 * Modèle proposé à l'utilisateur (D38, ADR 0020). Données sérialisables uniquement :
 * aucun objet de SDK ne traverse ce port (D10).
 */
export interface ModelChoice {
  id: string;
  name: string;
  /** Coût relatif du modèle, quand le runtime le fournit (Copilot). */
  multiplier?: number;
}

export interface AgentRuntime {
  readonly id: RuntimeId;
  readonly capabilities: RuntimeCapabilities;
  /**
   * Modèles que le compte peut réellement utiliser. Facultatif : tous les runtimes n'en
   * fournissent pas. Ne doit jamais échouer — une liste vide laisse le runtime décider.
   */
  listModels?(): Promise<ModelChoice[]>;
  start(): Promise<void>;
  stop(): Promise<void>;
  openSession(cfg: AgentSessionConfig): Promise<AgentSession>;
  /** Reprend une session persistée ; échoue si elle n'existe plus. */
  resumeSession(id: string, cfg: AgentSessionConfig): Promise<AgentSession>;
  deleteSession(id: string): Promise<void>;
}

// ---------- Outils fournis par notre code --------------------------------------

export interface ToolSpec<A = unknown> {
  name: string;
  description: string;
  /** JSON Schema des arguments. */
  parameters: Record<string, unknown>;
  /** Un appel réussi termine le tour (D18). */
  terminal?: boolean;
  handler(args: A): Promise<unknown>;
}

// ---------- Contrôle des appels d'outils (D27, D28) ------------------------------

export type ToolKind = "read" | "write" | "shell" | "url" | "mcp" | "custom-tool" | "other";

/** Demande d'exécution d'un outil, normalisée quel que soit le runtime. */
export interface ToolCallRequest {
  kind: ToolKind;
  toolName: string;
  /** Chemin visé, relatif ou absolu tel que fourni par l'agent (lecture/écriture). */
  path?: string;
  /** Ligne de commande complète (shell). */
  command?: string;
  url?: string;
  /** Arguments bruts, pour journalisation uniquement. */
  args?: unknown;
}

export type GuardDecision = { decision: "allow" } | { decision: "deny"; reason: string };

/**
 * Arbitre unique d'une session : la seule chose que l'adaptateur consulte avant un outil.
 * L'adaptateur transforme toute exception ou tout délai dépassé en refus.
 */
export interface ToolCallGuard {
  check(req: ToolCallRequest): Promise<GuardDecision>;
}

// ---------- Sessions --------------------------------------------------------------

export interface AgentSessionConfig {
  /** "main", "tdd-test", "skraft-architect"… */
  role: string;
  model?: string;
  workingDirectory: string;
  /** Rôle + skills obligatoires + dossier de passation. */
  systemPrompt: string;
  tools: ToolSpec[];
  guard: ToolCallGuard;
  /** Délai maximal d'une décision de garde avant refus (D28). */
  guardTimeoutMs?: number;
}

export type AgentEvent =
  | { type: "message-delta"; text: string }
  | { type: "message"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-start"; toolCallId: string; toolName: string }
  | { type: "tool-progress"; toolCallId: string; message: string }
  | { type: "tool-end"; toolCallId: string; success: boolean }
  | { type: "tool-denied"; toolName: string; reason: string }
  /** Consommation d'un appel au modèle (§13) ; `multiplier` = coût relatif du modèle (Copilot). */
  | { type: "usage"; model?: string; inputTokens?: number; outputTokens?: number; multiplier?: number }
  | { type: "idle" }
  | { type: "error"; message: string }
  /** Tout autre signe de vie : sert uniquement à réarmer le watchdog. */
  | { type: "activity" };

export interface AgentSession {
  readonly id: string;
  /** Non bloquant : le tour se termine par un événement `idle` ou `error`. */
  send(prompt: string): Promise<void>;
  onEvent(cb: (e: AgentEvent) => void): () => void;
  abort(): Promise<void>;
  /** Libère les ressources ; la session reste reprenable. */
  close(): Promise<void>;
}
