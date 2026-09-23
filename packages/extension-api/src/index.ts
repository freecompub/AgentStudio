/**
 * API publique des extensions (§5.4), version 0.1 : non figée avant la 1.0 (D14).
 * Une extension ne voit que `ExtensionContext` : aucun objet du SDK, aucune session (D10).
 */
import type { Evidence, TerminalOutput, TerminalToolName } from "@agent-studio/core";
import type { TestRun } from "@agent-studio/stack-adapters";
import type { SystemEvent, TaskDefinition } from "@agent-studio/task-engine";

export const API_VERSION = "0.1.0";

export type { Evidence, TerminalOutput, TerminalToolName, TestRun, SystemEvent, TaskDefinition };
export type { TestResult } from "@agent-studio/stack-adapters";
export type { TaskEvent, EffectContext } from "@agent-studio/task-engine";

// ---------- Manifeste (§5.1) ------------------------------------------------------

export type Permission =
  | "fs:read"
  | `fs:write:${string}`
  | "shell:test"
  | `shell:${string}`
  | "git:commit"
  | "git:branch"
  | "git:revert"
  | "copilot:sessions"
  | `net:${string}`;

export interface ManifestCommand {
  name: string;
  title: string;
  description: string;
}

export interface ManifestAgent {
  name: string;
  title: string;
  /** Prompt de rôle (texte). */
  role: string;
  output: TerminalToolName;
  /** Périmètre d'écriture (globs) ; absent = lecture seule. */
  write?: string[];
  /** Outils standard fournis par le cœur (§6.5). `run_tests` exige `shell:test`. */
  tools?: "run_tests"[];
}

export interface ManifestTask {
  name: string;
  title: string;
  /** Libellés des états, pour les cartes de tâche (§7.2). */
  states: Record<string, string>;
  milestones?: string[];
  alerts?: string[];
}

export interface ExtensionManifest {
  id: string;
  version: string;
  publisher: string;
  engines: { appApi: string };
  /** Entrée compilée, relative au dossier de l'extension (ex. `dist/index.js`). */
  main?: string;
  permissions: Permission[];
  contributes: {
    commands?: ManifestCommand[];
    agents?: ManifestAgent[];
    tasks?: ManifestTask[];
  };
}

// ---------- Contexte ------------------------------------------------------------------

export interface Disposable {
  dispose(): void;
}

export interface ChatApi {
  /** La commande doit être déclarée dans le manifeste. */
  registerCommand(name: string, handler: (args: string) => Promise<void>): Disposable;
  /** Message markdown dans la conversation, origine affichée. */
  post(markdown: string): void;
}

/** Rattache les preuves produites pendant un appel à une tâche et une étape. */
export interface EvidenceTag {
  taskId: string;
  stepId?: string;
  phase?: string;
}

export interface AgentRunOptions {
  signal?: AbortSignal;
  /** Preuves des `run_tests` de l'agent rattachées à cette étiquette. */
  evidence?: EvidenceTag;
  /** Gel des tests actif dans le tour : après une exécution rouge, plus aucune écriture de test (D22). */
  freezeTestsAfterRed?: boolean;
}

export interface AgentsApi {
  /** Lance un agent déclaré par l'extension ; ne renvoie qu'un résultat sérialisé. */
  run<N extends TerminalToolName>(name: string, prompt: string, opts?: AgentRunOptions): Promise<{ output: TerminalOutput<N> }>;
}

export interface WorkspaceApi {
  readFile(path: string): Promise<string>;
  listFiles(): Promise<string[]>;
  checkpoint(label: string): Promise<{ id: string }>;
  rollback(checkpointId: string): Promise<void>;
  /** Fichiers modifiés depuis un checkpoint. */
  changedFiles(checkpointId: string): Promise<{ path: string; status: "added" | "modified" | "deleted" }[]>;
  /** Empreinte des fichiers retenus par le filtre (gel des tests, D21). */
  fingerprint(include: (path: string) => boolean): Promise<string>;
}

export interface GitApi {
  /** Commit de tous les changements, ou des seuls `paths`. */
  commit(message: string, opts?: { paths?: string[] }): Promise<string | null>;
  head(): Promise<string>;
}

export interface StackApi {
  /** Exécution par le cœur ; avec `evidence`, la preuve est enregistrée (source « gate »). */
  runTests(opts?: { signal?: AbortSignal; evidence?: EvidenceTag }): Promise<TestRun>;
  isTestFile(path: string): boolean;
}

export interface EvidenceApi {
  /** Preuves d'une tâche, dans l'ordre : produites par le cœur, en lecture seule. */
  list(taskId: string): Promise<Evidence[]>;
}

export interface TasksApi {
  register<S, E extends { type: string }, F>(def: TaskDefinition<S, E, F, ExtensionContext>): void;
  start(name: string, input: unknown): Promise<string>;
  dispatch(taskId: string, event: SystemEvent | { type: string }): Promise<void>;
  cancel(taskId: string): Promise<void>;
}

export interface InteractionsApi {
  /** Demande persistée ; la réponse arrive dans la tâche comme `HUMAN_DECISION`. */
  request(req: { taskId: string; title: string; detail?: string; options: { id: string; label: string }[] }): Promise<string>;
}

export interface ExtensionLog {
  info(msg: string, fields?: Record<string, string | number | boolean>): void;
  warn(msg: string, fields?: Record<string, string | number | boolean>): void;
}

export interface ExtensionContext {
  readonly extensionId: string;
  readonly chat: ChatApi;
  readonly agents: AgentsApi;
  readonly workspace: WorkspaceApi;
  readonly git: GitApi;
  readonly stack: StackApi;
  readonly tasks: TasksApi;
  readonly interactions: InteractionsApi;
  readonly evidence: EvidenceApi;
  readonly log: ExtensionLog;
}

export interface ExtensionModule {
  activate(ctx: ExtensionContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
