/**
 * API publique des extensions (§5.4), version 0.1 : non figée avant la 1.0 (D14).
 * Une extension ne voit que `ExtensionContext` : aucun objet du SDK, aucune session (D10).
 */
import type { Evidence, TerminalOutput, TerminalToolName } from "@agent-studio/core";
import type { ArchitectureReport, DependencyRule, LintReport, MutationReport, TestRun } from "@agent-studio/stack-adapters";
import type { SystemEvent, TaskDefinition } from "@agent-studio/task-engine";

export const API_VERSION = "0.1.0";

// Erreurs et utilitaires utilisables sans dépendre du cœur (D10). Voir `errors.ts`.
export { EnvFailureError, TurnBudgetError, TurnContextError, TurnCostError, TurnTimeoutError, WorkDefectError } from "./errors.js";
// Les globs viennent de `stack-adapters`, plus bas : une extension n'a qu'un paquet à connaître.
export { globToRegExp, matchesAny, matchesAnyIgnoringCase } from "@agent-studio/stack-adapters";
// Barre de qualité du projet (ADR 0049) : `.agent-studio/quality.yaml`, commune aux extensions.
export { coreFilesMissing, layerOf, parseQualityBar, type Layer, type QualityBar, type QualityBarSource } from "@agent-studio/stack-adapters";

export type { Evidence, TerminalOutput, TerminalToolName, TestRun, SystemEvent, TaskDefinition };
export type { ArchitectureReport, CoverageReport, DependencyRule, LintReport, MutationReport, TestResult } from "@agent-studio/stack-adapters";
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
  /**
   * Fichier Markdown du rôle, relatif au dossier de l'extension (ex. `agents/dev.agent.md`) : le
   * **contenu**, partageable avec d'autres harnais (Copilot CLI, Claude Code). Le frontmatter est ignoré.
   */
  prompt?: string;
  /**
   * Consignes propres à agent-studio (orchestration), ajoutées au contenu. Au moins l'un de
   * `prompt` ou `role` est requis.
   */
  role?: string;
  /** Skills du rôle : injectées dans la session, ou chargées à la demande par `load_skill` (D26). `nom#Titre` = une section. */
  skills?: { mandatory?: string[]; onDemand?: string[] };
  output: TerminalToolName;
  /** Périmètre d'écriture (globs, ou `@stack:acceptanceTests|unitTests|sources`) ; absent = lecture seule. */
  write?: string[];
  /**
   * Outils mis à disposition de l'agent : outils standard du cœur (§6.5, `run_tests` exige
   * `shell:test`) ou outils de l'extension déclarés dans `contributes.tools`.
   */
  tools?: string[];
  /**
   * Classe de modèle du rôle (ADR 0048) : `strong` pour concevoir, `standard` pour produire,
   * `light` pour classer ou confronter des faits. Jamais un identifiant de modèle : le projet
   * associe chaque classe à un modèle réel. Absente : le modèle du projet, ou le runtime décide.
   */
  modelClass?: "strong" | "standard" | "light";
}

/** Skill : dossier contenant `SKILL.md` (ou fichier `.md`), relatif au dossier de l'extension. */
export interface ManifestSkill {
  name: string;
  path: string;
}

export interface ManifestTool {
  name: string;
  description: string;
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
    skills?: ManifestSkill[];
    tools?: ManifestTool[];
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
  /** Rattache l'appel à une tâche : preuves des `run_tests` et usage de l'agent (D20, D37). */
  evidence?: EvidenceTag;
  /** Gel des tests actif dans le tour : après une exécution rouge, plus aucune écriture de test (D22). */
  freezeTestsAfterRed?: boolean;
  /** Motifs (dont `@stack:*`) interdits en écriture pendant ce tour, en plus du périmètre du rôle (tests gelés). */
  readOnly?: string[];
}

/** Sortie structurée du rôle, ou question bloquante (`report_blocker`, si le rôle le déclare). */
export type AgentRunResult<N extends TerminalToolName> =
  | { output: TerminalOutput<N>; blocker?: undefined; skillsLoaded?: string[] }
  | { output?: undefined; blocker: { question: string; choices: string[] }; skillsLoaded?: string[] };

export interface AgentsApi {
  /** Lance un agent déclaré par l'extension ; ne renvoie qu'un résultat sérialisé. */
  run<N extends TerminalToolName>(name: string, prompt: string, opts?: AgentRunOptions): Promise<AgentRunResult<N>>;
}

export interface WorkspaceApi {
  readFile(path: string): Promise<string>;
  /** Écriture par le code de l'extension, limitée aux motifs `fs:write:<glob>` déclarés (D11, D29). */
  writeFile(path: string, content: string): Promise<void>;
  /**
   * Crée un dossier et ses parents (ADR 0037) : l'orchestrateur prépare l'arborescence pour que
   * l'agent n'ait pas à s'en soucier. Confiné comme l'écriture.
   */
  ensureDir(path: string): Promise<void>;
  listFiles(): Promise<string[]>;
  checkpoint(label: string): Promise<{ id: string }>;
  rollback(checkpointId: string): Promise<void>;
  /** Fichiers modifiés depuis un checkpoint. */
  changedFiles(checkpointId: string): Promise<{ path: string; status: "added" | "modified" | "deleted" }[]>;
  /** Empreinte des fichiers de test du projet, au sens de l'adaptateur de stack (gel des tests, D21). */
  fingerprintTests(): Promise<string>;
  /** Empreinte des fichiers correspondant aux motifs (`@stack:*` résolus), ex. tests d'acceptance gelés. */
  fingerprint(globs: string[]): Promise<string>;
}

export interface GitApi {
  /** Commit de tous les changements, ou des seuls `paths`. */
  commit(message: string, opts?: { paths?: string[] }): Promise<string | null>;
  /** Crée la branche (ou s'y place si elle existe) : exige `git:branch`. */
  branch(name: string): Promise<void>;
  head(): Promise<string>;
}

export interface StackApi {
  /** Emplacements de la stack du projet (tests d'acceptance, tests unitaires, sources). */
  readonly layout: { acceptanceTests: string[]; unitTests: string[]; sources: string[] };
  /**
   * Modules et frameworks que la stack tient pour de l'infrastructure ou de l'interface. Une
   * extension ne peut pas les connaître sans devenir spécifique à un langage : elle les demande.
   */
  readonly infrastructureModules: string[];
  /** Exécution par le cœur ; avec `evidence`, la preuve est enregistrée (source « gate »). */
  runTests(opts?: { signal?: AbortSignal; evidence?: EvidenceTag }): Promise<TestRun>;
  isTestFile(path: string): boolean;
  /** Tests de mutation de l'adaptateur ; `null` si la stack n'en propose pas (§9.6). */
  mutation(opts?: { signal?: AbortSignal }): Promise<MutationReport | null>;
  /** Contrôle des règles de dépendance entre modules ; `null` si la stack ne sait pas l'analyser. */
  architecture(rules: DependencyRule[]): Promise<ArchitectureReport | null>;
  /**
   * Linter du projet, avec les règles que le projet a lui-même choisies ; `null` si la stack
   * n'en propose pas. La qualité de forme se juge avec l'outil déjà configuré, jamais avec un
   * analyseur maison : deux autorités sur la même question se contrediraient.
   *
   * Exige la permission `shell:test` — le linter est un programme du projet, au même titre
   * qu'un lanceur de tests. L'appeler sans l'avoir déclarée lève, comme pour `mutation`.
   */
  lint(opts?: { files?: string[]; signal?: AbortSignal }): Promise<LintReport | null>;
}

/** Appel d'outil soumis aux hooks (forme normalisée, indépendante du runtime). */
export interface HookToolCall {
  kind: "read" | "write" | "shell" | "url" | "mcp" | "custom-tool" | "other";
  toolName: string;
  path?: string;
  command?: string;
  url?: string;
}

/** Un hook ne peut que refuser (ou laisser passer) : jamais élargir une permission (§5.5). */
export type HookDecision = { decision: "allow" } | { decision: "deny"; reason: string };

export interface HooksApi {
  /**
   * Garde exécutée avant chaque appel d'outil des agents, après celles du cœur. Si elle plante ou
   * dépasse son délai, l'appel est refusé (D28).
   */
  onPreToolUse(handler: (call: HookToolCall) => HookDecision | void | Promise<HookDecision | void>): Disposable;
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

/** Outil d'extension : exécuté par le code de l'extension quand un agent l'appelle (§5.4). */
export interface ExtensionTool {
  name: string;
  description: string;
  /** JSON Schema des arguments. */
  parameters: Record<string, unknown>;
  /** Renvoie le texte transmis à l'agent ; une exception refuse l'appel (l'agent peut corriger). */
  handler(args: unknown): Promise<string>;
}

export interface ToolsApi {
  /** L'outil doit être déclaré dans `contributes.tools`. */
  register(tool: ExtensionTool): Disposable;
}

export interface InteractionsApi {
  /**
   * Demande persistée ; la réponse arrive dans la tâche comme `HUMAN_DECISION`.
   * `requiredRoles` réserve la réponse à certains profils (ex. un architecte ratifie un ADR).
   */
  request(req: {
    taskId: string;
    title: string;
    detail?: string;
    options: { id: string; label: string }[];
    requiredRoles?: ("testeur" | "po" | "developpeur" | "architecte" | "administrateur")[];
    /** Une réponse en texte libre est attendue (question ouverte, précision d'un amendement). */
    freeText?: boolean;
  }): Promise<string>;
}

export interface ExtensionLog {
  info(msg: string, fields?: Record<string, string | number | boolean>): void;
  warn(msg: string, fields?: Record<string, string | number | boolean>): void;
}

/**
 * Trace d'exécution accessible à une extension (ADR 0038) : elle **raconte**, elle n'atteste rien.
 * Une porte ne doit jamais s'y appuyer — les preuves (`evidence`) font seules foi.
 */
export interface ExtensionTrace {
  /**
   * Archive des livrables avant qu'un rollback ne les efface. `étiquette` situe le moment
   * (« DESIGN essai 2 »), et chaque fichier est enregistré avec son chemin.
   */
  rejected(taskId: string, label: string, files: readonly { path: string; content: string }[]): Promise<void>;
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
  /** Trace d'exécution (ADR 0032, 0038) : elle raconte, elle n'atteste rien. */
  readonly trace: ExtensionTrace;
  readonly hooks: HooksApi;
  readonly tools: ToolsApi;
  readonly log: ExtensionLog;
}

export interface ExtensionModule {
  activate(ctx: ExtensionContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
