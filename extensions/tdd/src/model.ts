/**
 * Modèle de la tâche `tdd-cycle` (§8). Types purs, sérialisables (persistés par le moteur).
 */

export type Phase =
  | "PLANNING"
  | "PLAN_REVIEW"
  | "STEP_START"
  | "CYCLE"
  | "CYCLE_VERIFY"
  | "RED"
  | "RED_VERIFY"
  | "GREEN"
  | "GREEN_VERIFY"
  | "REFACTOR"
  | "REFACTOR_VERIFY"
  | "ESCALATED"
  | "DONE"
  | "ABORTED";

export interface Step {
  id: string;
  behavior: string;
  status: "pending" | "done" | "skipped";
}

/** D22 : un tour par comportement (défaut) ou une session par pas RED / GREEN / REFACTOR. */
export type Granularity = "turn" | "strict";

export interface TddInput {
  feature: string;
  granularity?: Granularity;
  maxAttempts?: number;
  skipRefactor?: boolean;
  /** Plan approuvé sans demande à l'utilisateur. */
  autoApprovePlan?: boolean;
}

export interface TddState {
  phase: Phase;
  feature: string;
  steps: Step[];
  current: number;
  attempts: number;
  maxAttempts: number;
  skipRefactor: boolean;
  autoApprovePlan: boolean;
  granularity: Granularity;
  /** L'étape en cours est passée en mode strict après un échec du tour unique (D22). */
  stepStrict: boolean;
  /** Points de retour (identifiants de checkpoints du Workspace). */
  checkpoints: { step?: string; red?: string; green?: string };
  baselineTests: string[];
  newTestIds: string[];
  /** Empreinte des fichiers de test gelés après RED (D21). */
  testsHash?: string;
  /** Dernier motif de rejet, transmis tel quel à l'agent (§8.3). */
  feedback?: string;
  escalation?: { from: "PLANNING" | "RED" | "GREEN"; reason: string };
  /** Réessais par état (usage par état, D37). */
  retries: Record<string, number>;
  /** Résumés `report_phase` (dossier de passation, §6.6). */
  reports: { stepId: string; phase: "CYCLE" | "RED" | "GREEN" | "REFACTOR"; summary: string; files: string[] }[];
}

export type TddEvent =
  | { type: "PLAN_SUBMITTED"; steps: { id: string; behavior: string }[] }
  | { type: "CHECKPOINT_CREATED"; checkpointId: string; baselineTests: string[] }
  | { type: "AGENT_DONE"; summary: string; files: string[]; runId?: string }
  | { type: "VERIFY_OK"; checkpointId: string; newTestIds?: string[]; testsHash?: string }
  | { type: "VERIFY_FAIL"; reason: string };

export type TddEffect =
  | { kind: "runPlanner"; feature: string; feedback?: string }
  | { kind: "askPlanReview"; steps: Step[] }
  | { kind: "createCheckpoint"; label: string }
  | { kind: "runPairAgent"; step: Step; feedback?: string }
  | { kind: "verifyCycle"; since: string; baseline: string[]; step: Step; runId?: string }
  | { kind: "runTestAgent"; step: Step; feedback?: string }
  | { kind: "runDevAgent"; mode: "green" | "refactor"; step: Step; testIds: string[]; feedback?: string }
  | { kind: "verifyRed"; since: string; baseline: string[]; step: Step }
  | { kind: "verifyGreen"; since: string; testsHash: string; message: string; mode: "green" | "refactor" }
  | { kind: "rollback"; to: string }
  | { kind: "askHuman"; reason: string; from: "PLANNING" | "RED" | "GREEN"; options: ("retry" | "skip" | "abort")[] };

/** Libellés des états pour les cartes de tâche (§7.2), repris dans le manifeste. */
export const PHASE_LABELS: Record<Phase, string> = {
  PLANNING: "Découpage en comportements",
  PLAN_REVIEW: "Plan à valider",
  STEP_START: "Préparation de l'étape",
  CYCLE: "Test puis code (un tour)",
  CYCLE_VERIFY: "Vérification du cycle",
  RED: "Écriture du test",
  RED_VERIFY: "Vérification du test rouge",
  GREEN: "Écriture du code",
  GREEN_VERIFY: "Vérification du vert",
  REFACTOR: "Nettoyage",
  REFACTOR_VERIFY: "Vérification du nettoyage",
  ESCALATED: "Décision requise",
  DONE: "Terminé",
  ABORTED: "Annulé",
};
