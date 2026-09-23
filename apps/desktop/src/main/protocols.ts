import type { AgentRuntime } from "@agent-studio/core";
import type { Workspace } from "@agent-studio/workspace";
import type { EventChannel, EventPayload } from "../shared/ipc-contract.js";

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
