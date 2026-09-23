/**
 * Usage par tâche et par état de machine (D37, §13) : requêtes, tokens, réessais, durée.
 * Affiché dans l'unité du fournisseur (`RuntimeCapabilities.usageUnit`).
 */
export interface UsageDelta {
  requests?: number;
  inputTokens?: number;
  outputTokens?: number;
  retries?: number;
  durationMs?: number;
  effects?: number;
}

export interface UsageRow {
  phase: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  retries: number;
  durationMs: number;
  effects: number;
}

export interface UsageRecorder {
  add(taskId: string, phase: string, delta: UsageDelta): Promise<void>;
  /** Lignes par état, dans l'ordre de première apparition. */
  report(taskId: string): Promise<UsageRow[]>;
  onChange(cb: (taskId: string, rows: UsageRow[]) => void): () => void;
}
