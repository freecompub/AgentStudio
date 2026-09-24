import type {
  MessageOptions,
  ModelInfo,
  ResumeSessionConfig,
  SessionConfig,
  SessionEvent,
} from "@github/copilot-sdk";

/**
 * Sous-ensemble du Copilot SDK dont l'adaptateur dépend. Les classes réelles
 * (`CopilotClient`, `CopilotSession`) le satisfont structurellement ; les tests
 * fournissent des doubles. Ces objets ne sortent jamais de ce paquet (D10).
 */
export interface CopilotSessionPort {
  readonly sessionId: string;
  send(options: MessageOptions): Promise<string>;
  on(handler: (event: SessionEvent) => void): () => void;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface CopilotClientPort {
  start(): Promise<void>;
  stop(): Promise<Error[]>;
  createSession(config: SessionConfig): Promise<CopilotSessionPort>;
  resumeSession(sessionId: string, config: ResumeSessionConfig): Promise<CopilotSessionPort>;
  deleteSession(sessionId: string): Promise<void>;
  listModels(): Promise<ModelInfo[]>;
}
