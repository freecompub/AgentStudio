/**
 * Protocoles du service Workspace (D29). Le reste de l'application ne dépend
 * que de ces interfaces ; les implémentations Git/disque sont injectées.
 */

/** Exécution de commandes git, sans shell. Renvoie stdout brut. */
export interface GitRunner {
  run(args: readonly string[], opts?: { env?: Record<string, string>; timeoutMs?: number }): Promise<string>;
}

/** Fabrique un `GitRunner` lié à un dossier. */
export type GitRunnerFactory = (cwd: string) => GitRunner;

/** Accès aux fichiers confiné à la racine du projet. */
export interface FileStore {
  read(rel: string): Promise<string>;
  write(rel: string, content: string): Promise<void>;
  /** Fichiers suivis et non suivis, hors fichiers ignorés, triés. */
  list(): Promise<string[]>;
}

export interface Checkpoint {
  id: string;
  /** Commit instantané contenant tout l'arbre de travail (fichiers ignorés exclus). */
  sha: string;
  /** HEAD au moment du checkpoint. */
  head: string;
  label: string;
  createdAt: string;
}

export type FileChangeStatus = "added" | "modified" | "deleted";

export interface FileChange {
  path: string;
  status: FileChangeStatus;
}

export interface WorkspaceDiff {
  files: FileChange[];
  patch: string;
}

/** Points de retour garantis (D23). */
export interface CheckpointStore {
  create(label: string): Promise<Checkpoint>;
  /** Du plus récent au plus ancien. */
  list(): Promise<Checkpoint[]>;
  diff(checkpointId: string): Promise<WorkspaceDiff>;
  rollback(checkpointId: string): Promise<void>;
}

export interface SyncResult {
  pulled: number;
  pushed: number;
}

/** Opérations Git simplifiées (D7). */
export interface Repository {
  head(): Promise<string>;
  /** Indexe tout (ou seulement `paths`) et commit ; `null` s'il n'y a rien à valider. */
  commit(message: string, opts?: { paths?: string[] }): Promise<string | null>;
  /** Avance rapide depuis l'amont puis push ; échoue en cas de divergence. */
  sync(): Promise<SyncResult>;
}

/** Façade composée, seule porte d'accès au disque et à Git. */
export interface Workspace {
  readonly root: string;
  readonly files: FileStore;
  readonly checkpoints: CheckpointStore;
  readonly repo: Repository;
}
