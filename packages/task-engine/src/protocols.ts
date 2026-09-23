/**
 * Protocoles du moteur de tâches (§6). Une tâche est un réducteur pur plus un runner d'effets ;
 * le moteur fournit persistance, checkpoints, reprise, annulation et événements système.
 */

/** Événements injectés par le moteur (§6.2). */
export type SystemEvent =
  | { type: "TIMEOUT"; reason: string }
  | { type: "ENV_FAILURE"; reason: string }
  | { type: "HUMAN_DECISION"; decision: string; comment?: string }
  | { type: "RESUMED" }
  | { type: "ABORT" };

export type TaskEvent<E> = E | SystemEvent;

export interface EffectContext<S = unknown> {
  taskId: string;
  /** État courant de la tâche (lecture seule), pour construire un dossier de passation. */
  state: S;
  /** Déclenché par une annulation : l'effet doit s'interrompre au plus tôt. */
  signal: AbortSignal;
}

export interface TaskDefinition<S, E extends { type: string }, F, D> {
  name: string;
  initialState(input: unknown): S;
  /** Premiers effets à exécuter au lancement. */
  initialEffects(state: S): F[];
  /** PUR : aucune I/O. */
  transition(state: S, event: TaskEvent<E>): { state: S; effects: F[] };
  /** Exécute un effet ; renvoie l'événement suivant, ou rien (attente d'un événement externe). */
  runEffect(effect: F, deps: D, ctx: EffectContext<S>): Promise<TaskEvent<E> | void>;
  /** Checkpoint Git avant l'effet (D23). Défaut : oui. */
  checkpointBefore?(effect: F): boolean;
  /** État terminal : la tâche ne reprendra plus. */
  isTerminal(state: S): boolean;
}

export type TaskStatus = "running" | "waiting" | "finished";

export interface InflightEffect<F> {
  effect: F;
  checkpointId: string | null;
  startedAt: string;
}

/** Ce qui est persisté après chaque transition et avant chaque effet. */
export interface TaskRecord<S = unknown, F = unknown> {
  id: string;
  name: string;
  state: S;
  /** Effets restant à exécuter, dans l'ordre. */
  pending: F[];
  /** Effet commencé et non terminé : rejoué depuis son checkpoint au redémarrage (§6.3). */
  inflight: InflightEffect<F> | null;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TaskStore {
  save(record: TaskRecord): Promise<void>;
  load(id: string): Promise<TaskRecord | null>;
  list(): Promise<TaskRecord[]>;
}

/** Points de retour du dépôt (implémentés par `CheckpointStore` du Workspace). */
export interface TaskCheckpoints {
  create(label: string): Promise<{ id: string }>;
  rollback(id: string): Promise<void>;
}
