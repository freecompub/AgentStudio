import type { AgentRuntime, ModelClass } from "@agent-studio/core";
import type { Workspace } from "@agent-studio/workspace";
import type { EventChannel, EventPayload } from "../shared/ipc-contract.js";

/** Accès aux espaces de travail (ouverture d'un dépôt existant, clonage). */
export interface WorkspaceProvider {
  open(path: string): Promise<Workspace>;
  clone(url: string, dest: string): Promise<Workspace>;
}

/** Construit le runtime d'agent une fois le jeton obtenu. */
export type RuntimeFactory = (gitHubToken: string, hostname: string) => AgentRuntime;

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

// Services d'un projet : déplacés dans @agent-studio/project-services, partagés avec le serveur MCP (ADR 0068).
export type { RouteOutcome, WorkspaceServices, WorkspaceServicesArgs, WorkspaceServicesFactory } from "@agent-studio/project-services";
