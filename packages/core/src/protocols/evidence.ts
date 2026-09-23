/**
 * Preuves produites par le code (D20) : chaque exécution de tests, qu'elle vienne de l'outil
 * `run_tests` appelé par un agent ou d'une porte, est enregistrée par le cœur, jamais par l'agent.
 */
export interface EvidenceFailure {
  id: string;
  failureKind?: "assertion" | "missing_symbol" | "other_error";
  message?: string;
}

export interface Evidence {
  id: string;
  taskId: string;
  stepId?: string;
  /** Qui a demandé l'exécution : un agent (outil `run_tests`) ou une porte du code. */
  source: "run_tests" | "gate";
  /** Étiquette libre fournie par la tâche (ex. RED, GREEN, CYCLE). */
  phase?: string;
  at: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  counts: { passed: number; failed: number; skipped: number };
  /** Identifiants de tous les tests exécutés, pour retrouver un test précis dans la séquence. */
  testIds: string[];
  failing: EvidenceFailure[];
  /** Empreinte des fichiers de test au moment de l'exécution. */
  testsHash: string;
  /** HEAD Git au moment de l'exécution. */
  head: string;
}

export interface EvidenceStore {
  append(e: Evidence): Promise<void>;
  list(taskId: string): Promise<Evidence[]>;
}
