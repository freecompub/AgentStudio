import type { AgentRuntime, CommandListing } from "@agent-studio/core";
import type { Workspace } from "@agent-studio/workspace";
import type { EventChannel, EventPayload, InteractionDto, TaskCardDto } from "../shared/ipc-contract.js";

/** Accès aux espaces de travail (ouverture d'un dépôt existant, clonage). */
export interface WorkspaceProvider {
  open(path: string): Promise<Workspace>;
  clone(url: string, dest: string): Promise<Workspace>;
}

/** Construit le runtime d'agent une fois le jeton obtenu. */
export type RuntimeFactory = (gitHubToken: string) => AgentRuntime;

/** Émission d'événements vers la fenêtre. */
export interface EventSink {
  emit<C extends EventChannel>(channel: C, payload: EventPayload<C>): void;
}

export interface AppSettings {
  lastWorkspace?: string;
}

export interface SettingsStore {
  load(): Promise<AppSettings>;
  save(settings: AppSettings): Promise<void>;
}

export interface FolderPicker {
  pick(): Promise<string | null>;
}

export interface ExternalOpener {
  open(url: string): Promise<void>;
}

/** Résultat du routage d'un message tapé dans le chat. */
export type RouteOutcome = { kind: "chat" } | { kind: "handled" } | { kind: "unknown-command"; name: string };

/** Services liés à un projet ouvert : registre, extensions, moteur de tâches, interactions. */
export interface WorkspaceServices {
  /** `/commande` → extension ; texte libre → à envoyer à la session principale. */
  route(text: string): Promise<RouteOutcome>;
  commands(): CommandListing[];
  tasks(): Promise<TaskCardDto[]>;
  cancelTask(taskId: string): Promise<void>;
  pendingInteractions(): Promise<InteractionDto[]>;
  respond(id: string, option: string, comment?: string): Promise<void>;
  dispose(): Promise<void>;
}

export interface WorkspaceServicesArgs {
  workspace: Workspace;
  /** Runtime d'agent obtenu à la demande (authentification au premier besoin). */
  runtime: () => Promise<AgentRuntime>;
  onTask(card: TaskCardDto): void;
  onInteractions(pending: InteractionDto[]): void;
  /** Message d'une extension à consigner dans la conversation. */
  onPost(extensionId: string, markdown: string): void;
}

export type WorkspaceServicesFactory = (args: WorkspaceServicesArgs) => Promise<WorkspaceServices>;
