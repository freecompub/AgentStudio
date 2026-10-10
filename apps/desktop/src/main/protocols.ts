import type { AgentRuntime, CommandListing, ModelClass, Role, ToolCallGuard, ToolSpec, UserConfirmer } from "@agent-studio/core";
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
  /** Mode d'affichage choisi par l'utilisateur ; absent = mode par défaut du profil. */
  uiMode?: "simple" | "advanced";
  /** Modèle retenu par projet (racine → identifiant), D38 / ADR 0020. */
  models?: Record<string, string>;
  /** Modèle réel par classe de rôle, par projet (racine → classe → identifiant), ADR 0048. */
  modelClasses?: Record<string, Partial<Record<ModelClass, string>>>;
  /** Hôte GitHub retenu : `github.com` ou une instance Enterprise (D4). */
  authHostname?: string;
}

export interface SettingsStore {
  load(): Promise<AppSettings>;
  save(settings: AppSettings): Promise<void>;
}

export interface FolderPicker {
  pick(): Promise<string | null>;
  /** Choix d'un paquet d'extension (.asx) à installer. */
  pickPackage?(): Promise<string | null>;
}

export interface SystemNotifier {
  notify(title: string, body: string): void;
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
  /** Hooks `onPreToolUse` des extensions actives, pour l'arbitre de la session principale. */
  hookGuards(): ToolCallGuard[];
  /** Outils donnés à l'agent principal (`proposer_workflow` si un workflow est actif, ADR 0055). */
  outilsAgent(): ToolSpec[];
  tasks(): Promise<TaskCardDto[]>;
  cancelTask(taskId: string): Promise<void>;
  pendingInteractions(): Promise<InteractionDto[]>;
  respond(id: string, option: string, comment?: string, by?: { role: Role }): Promise<void>;
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
  /** Notification système (jalons et alertes), si l'application est en arrière-plan (§7.2). */
  notify?(title: string, body: string): void;
  /**
   * Confirmation dans la fenêtre, pour les commandes du cœur qui élargissent ce que
   * l'application a le droit de lancer — écrire un profil de stack, par exemple (§8.5).
   * Absente, la commande `/stack` n'est pas enregistrée : mieux vaut pas de commande qu'une
   * commande qui écrirait sans demander.
   */
  confirmer?: UserConfirmer;
  /**
   * Modèle réel pour une classe de rôle d'un agent de tâche (ADR 0048), relu dans les réglages à
   * chaque appel. Absent : les agents des tâches ne demandent aucun modèle.
   */
  modelFor?(cls: ModelClass | undefined): Promise<string | undefined>;
}

export type WorkspaceServicesFactory = (args: WorkspaceServicesArgs) => Promise<WorkspaceServices>;
