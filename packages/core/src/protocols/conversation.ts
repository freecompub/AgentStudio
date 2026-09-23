/**
 * Protocoles de la session principale (§4.2 « Gestionnaire de sessions ») :
 * persistance de la conversation affichée et points de retour associés à chaque tour.
 */

export type ChatRole = "user" | "assistant" | "notice";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
  /** Pour un message utilisateur : checkpoint pris juste avant le tour. */
  checkpointId?: string;
  /** Le tour a été annulé par l'utilisateur (fichiers restaurés). */
  undone?: boolean;
  /** Extension à l'origine d'un message (affichée, D34). */
  origin?: string;
}

export interface ConversationRecord {
  version: 1;
  workspaceRoot: string;
  /** Identifiant de la session côté runtime, pour `resumeSession`. */
  runtimeSessionId: string | null;
  messages: ChatMessage[];
}

/** Stockage de la conversation d'un espace de travail. */
export interface ConversationStore {
  load(workspaceRoot: string): Promise<ConversationRecord | null>;
  save(record: ConversationRecord): Promise<void>;
}

/** Sous-ensemble de `CheckpointStore` (paquet workspace) dont la session principale a besoin. */
export interface TurnCheckpoints {
  create(label: string): Promise<{ id: string }>;
  rollback(checkpointId: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}
