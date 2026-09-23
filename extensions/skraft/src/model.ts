/**
 * Modèle d'état unifié du pipeline skraft (SPEC-skraft §5.1) : un seul type, un seul validateur
 * (défaut C2 rendu impossible). Types purs, sérialisables, persistés par le moteur.
 */
import { z } from "zod";
import type { DeliverScenario, Granularity } from "./deliver.js";
import type { Difficulty, DifficultyIndicators, LensName } from "./difficulty.js";
import type { LensVerdict, Verdict } from "./review.js";
import type { Story } from "./story.js";

export type Phase = "RESEARCH" | "DESIGN" | "DISTILL" | "DELIVER";

export type Stage =
  | "INIT"
  | "CLASSIFY"
  | "CONFIRM_DIFFICULTY"
  | "ROUTE"
  | "SPECIALIST"
  | "ARTIFACT_GATE"
  | "REVIEW"
  | "VERDICT_GATE"
  | "RATIFICATION"
  | "COMMIT"
  | "BLOCKED"
  | "ESCALATED"
  | "DONE"
  | "ABORTED";

export type Role =
  | "skraft-classifier"
  | "skraft-researcher"
  | "skraft-architect-model"
  | "skraft-architect-decide"
  | "skraft-acceptance"
  | "skraft-test"
  | "skraft-dev";

export interface ArtifactRecord {
  path: string;
  sha256: string;
  producedBy: string;
  attempt: number;
}

export interface ReviewRecord {
  attempt: number;
  lenses: LensVerdict[];
  verdict: Verdict;
  reportPath: string;
}

export interface AdrRecord {
  id: string;
  path: string;
  status: "Proposed" | "Accepted" | "Rejected";
  decisionBy?: string;
}

/** Pas de la sous-machine DELIVER : test unitaire, puis code (un tour) ou vert et nettoyage (sessions séparées). */
export type DeliverStep = "test" | "dev" | "green" | "refactor" | "fix" | "scenario-gate";

/** Sous-machine DELIVER (§7.4). Les champs après `scenarioCheckpoint` sont internes au réducteur. */
export interface DeliverState {
  scenarios: DeliverScenario[];
  current: number;
  granularity: Granularity;
  /** Empreinte gelée en DISTILL. */
  acceptanceHash: string;
  /** Empreinte des tests unitaires après chaque RED validé. */
  unitTestsHash: string | null;
  scenarioCheckpoint: string | null;
  step: DeliverStep;
  /** Dernier point sûr (début du scénario ou dernier pas validé) : cible des rollbacks. */
  stepCheckpoint: string | null;
  /** Tests connus et tests verts au dernier point sûr, et au début du scénario. */
  baseline: { all: string[]; passed: string[] };
  scenarioBaseline: { all: string[]; passed: string[] };
  /** Tests unitaires ajoutés pendant le scénario, et celui qui attend son vert. */
  unitTests: string[];
  newTest: string | null;
  /** Le test d'acceptance du scénario est vert au dernier vert (mode strict, avant le nettoyage). */
  acceptanceGreen: boolean;
  attempts: number;
  /** Échecs du scénario en cours (porte de fin de scénario ou budget d'un pas épuisé). */
  scenarioFailures: number;
  /** Motif transmis au prochain agent (rejet d'une porte, revue). */
  feedback: string[];
  /** Informations pour les lentilles (mutation non mesurée, etc.). */
  notes: string[];
  /** Faits établis par les portes de fin de scénario (mutation, dépendances…), pour la revue (§9.1). */
  facts: string[];
  /** Correction des défauts de revue en cours (§9.3). */
  fixing: boolean;
}

export interface SkraftInput {
  storyPath: string;
  /** Confirmation de la difficulté par l'utilisateur (O3 : mode simple) ; sinon automatique. */
  confirmDifficulty?: boolean;
  /** Surcharge de l'ordre des phases (tests) ; défaut : configuration unique. */
  phaseOrder?: Phase[];
  /** Granularité de DELIVER imposée par réglage (SPEC.md D22) ; défaut : selon la difficulté. */
  granularity?: Granularity;
}

export interface SkraftState {
  schemaVersion: 1;
  slug: string;
  storyPath: string;
  stage: Stage;
  phase: Phase | null;
  phaseOrder: Phase[];
  skipPhases: Phase[];
  phasesCompleted: Phase[];
  difficulty: { level: Difficulty; indicators: DifficultyIndicators; confirmedBy: "user" | "auto" } | null;
  baseSha: string;
  branch: string;
  checkpoints: Partial<Record<Phase, string>>;
  artifacts: Record<Phase, ArtifactRecord[]>;
  reviews: Record<Phase, ReviewRecord[]>;
  attempts: number;
  budget: { maxAttemptsPerPhase: number };
  lastRejection: { gate: string; reasons: string[] } | null;
  openQuestions: { id: string; text: string; answer?: string }[];
  adrs: AdrRecord[];
  pendingInteraction: string | null;
  /** Sous-machine DELIVER (§7.4) ; `null` hors de la phase. */
  deliver: DeliverState | null;
  // ---- champs internes (non prescrits par la spec, nécessaires au réducteur) ----
  confirmDifficulty: boolean;
  story: Story | null;
  indicators: DifficultyIndicators | null;
  proposed: { level: Difficulty; justification: string } | null;
  lenses: LensName[];
  /** DESIGN se déroule en deux sessions : modélisation puis décisions (§7.2). */
  designStep: "model" | "decide";
  /** Blocage signalé par un agent, en attente de réponse (§5.2, BLOCKED). */
  blocker: { question: string; choices: string[] } | null;
  /** Origine d'une escalade, pour savoir quoi relancer. */
  escalation: { from: "INIT" | "CLASSIFY" | "PHASE"; reason: string } | null;
  /** Réponses de l'utilisateur à transmettre au prochain dossier de passation. */
  answers: { question: string; answer: string }[];
  /** Questions ouvertes déjà soumises à l'utilisateur (pas de double demande). */
  questionsAsked: string[];
  /** Empreinte des tests d'acceptance, gelés à la sortie de DISTILL (§7.3). */
  acceptanceHash: string | null;
  /** Tests d'acceptance déjà verts, requalifiés en non-régression avec justification. */
  regressions: string[];
  /** Granularité imposée par réglage, sinon choisie selon la difficulté. */
  granularitySetting: Granularity | null;
  /** Réessais par phase (mesures d'usage, §12). */
  retries: Record<string, number>;
}

export type SkraftEvent =
  | {
      type: "INITIALIZED";
      slug: string;
      story: Story;
      baseSha: string;
      branch: string;
      indicators: DifficultyIndicators;
    }
  | { type: "INIT_FAILED"; reasons: string[] }
  | { type: "DIFFICULTY_PROPOSED"; level: string; justification: string }
  | { type: "PHASE_CHECKPOINTED"; phase: Phase; checkpointId: string }
  | { type: "AGENT_REPORTED"; role: Role; summary: string; files: string[] }
  | { type: "BLOCKER_REPORTED"; question: string; choices: string[] }
  | { type: "GATE_OK"; artifacts: ArtifactRecord[]; adrs?: AdrRecord[]; openQuestions?: string[]; acceptanceHash?: string; regressions?: string[] }
  | { type: "GATE_FAIL"; gate: string; reasons: string[] }
  | { type: "LENSES_DONE"; lenses: LensVerdict[]; reportPath: string }
  | { type: "COMMITTED"; sha: string | null }
  | { type: "DELIVER_PLANNED"; scenarios: DeliverScenario[]; all: string[]; passed: string[] }
  | { type: "SCENARIO_STARTED"; checkpointId: string }
  | { type: "STEP_OK"; checkpointId: string; all: string[]; passed: string[]; newTest?: string; unitTestsHash?: string; acceptanceGreen?: boolean }
  | { type: "STEP_FAIL"; reason: string }
  | { type: "SCENARIO_OK"; notes: string[]; facts?: string[] }
  | { type: "SCENARIO_FAIL"; reasons: string[] };

export type SkraftEffect =
  | { kind: "init"; storyPath: string }
  | { kind: "classify"; indicators: DifficultyIndicators; proposed: Difficulty }
  | { kind: "askDifficulty"; proposed: Difficulty; justification: string; options: Difficulty[] }
  | { kind: "checkpointPhase"; phase: Phase }
  | { kind: "runSpecialist"; phase: Phase; role: Role; attempt: number; feedback: string[] }
  | { kind: "runGate"; phase: Phase; attempt: number }
  | { kind: "runReview"; phase: Phase; lenses: LensName[]; attempt: number }
  | { kind: "askRatification"; adr: AdrRecord }
  | { kind: "applyAdrStatuses"; adrs: { path: string; status: "Accepted" | "Rejected" }[] }
  | { kind: "askBlocker"; question: string; choices: string[] }
  | { kind: "askQuestion"; id: string; text: string }
  | { kind: "askEscalation"; reason: string; options: ("retry" | "skip" | "abort")[] }
  | { kind: "rollback"; to: string }
  | { kind: "commitPhase"; phase: Phase; message: string }
  | { kind: "finalReport" }
  | { kind: "planDeliver" }
  | { kind: "startScenario"; scenarioId: string }
  | { kind: "runDeliverAgent"; step: "test" | "dev" | "green" | "refactor" | "fix"; scenarioId: string; attempt: number; feedback: string[] }
  | { kind: "verifyUnitRed"; scenarioId: string; since: string; baseline: { all: string[]; passed: string[] }; pending: string[] }
  | {
      kind: "verifyUnitGreen";
      mode: "dev" | "green" | "refactor" | "fix";
      scenarioId: string;
      since: string;
      newTest: string | null;
      unitTestsHash: string | null;
      pending: string[];
    }
  | { kind: "scenarioGate"; scenarioId: string; since: string; unitTests: string[]; pending: string[] };

/** Libellés des états et des phases pour la carte de tâche (§10, §11). */
export const STAGE_LABELS: Record<string, string> = {
  INIT: "Préparation",
  CLASSIFY: "Évaluation de la difficulté",
  CONFIRM_DIFFICULTY: "Difficulté à confirmer",
  RESEARCH: "Enquête sur le code existant",
  DESIGN: "Conception et décisions d'architecture",
  DISTILL: "Écriture des scénarios et des tests d'acceptance",
  DELIVER: "Implémentation en TDD",
  ROUTE: "Questions à trancher avant la suite",
  ARTIFACT_GATE: "Vérification des livrables",
  REVIEW: "Revue",
  RATIFICATION: "Décisions d'architecture à valider",
  COMMIT: "Enregistrement de la phase",
  BLOCKED: "Question en attente",
  ESCALATED: "Décision requise",
  DONE: "Terminé",
  ABORTED: "Annulé",
};

// ---------- validation à chaque chargement (§5.1) ------------------------------------

const phase = z.enum(["RESEARCH", "DESIGN", "DISTILL", "DELIVER"]);
const byPhase = <T extends z.ZodTypeAny>(t: T) => z.object({ RESEARCH: z.array(t), DESIGN: z.array(t), DISTILL: z.array(t), DELIVER: z.array(t) });

const stateSchema = z.object({
  schemaVersion: z.literal(1),
  slug: z.string(),
  storyPath: z.string().min(1),
  stage: z.enum(["INIT", "CLASSIFY", "CONFIRM_DIFFICULTY", "ROUTE", "SPECIALIST", "ARTIFACT_GATE", "REVIEW", "VERDICT_GATE", "RATIFICATION", "COMMIT", "BLOCKED", "ESCALATED", "DONE", "ABORTED"]),
  phase: phase.nullable(),
  phaseOrder: z.array(phase).min(1),
  skipPhases: z.array(phase),
  phasesCompleted: z.array(phase),
  difficulty: z.object({ level: z.enum(["simple", "medium", "medium-hard", "challenging"]), indicators: z.unknown(), confirmedBy: z.enum(["user", "auto"]) }).nullable(),
  baseSha: z.string(),
  branch: z.string(),
  checkpoints: z.record(z.string(), z.string()),
  artifacts: byPhase(z.object({ path: z.string(), sha256: z.string(), producedBy: z.string(), attempt: z.number() })),
  reviews: byPhase(z.object({ attempt: z.number(), lenses: z.array(z.unknown()), verdict: z.enum(["APPROVED", "CHANGES_REQUESTED", "REJECTED"]), reportPath: z.string() })),
  attempts: z.number().int().min(0),
  budget: z.object({ maxAttemptsPerPhase: z.number().int().min(1) }),
  lastRejection: z.object({ gate: z.string(), reasons: z.array(z.string()) }).nullable(),
  openQuestions: z.array(z.object({ id: z.string(), text: z.string(), answer: z.string().optional() })),
  adrs: z.array(z.object({ id: z.string(), path: z.string(), status: z.enum(["Proposed", "Accepted", "Rejected"]), decisionBy: z.string().optional() })),
  pendingInteraction: z.string().nullable(),
  retries: z.record(z.string(), z.number().int().min(0)),
  deliver: z
    .object({
      scenarios: z.array(z.object({ id: z.string(), ac: z.number(), acceptanceTestId: z.string(), role: z.enum(["driver", "regression"]), status: z.enum(["pending", "in_progress", "done"]) })),
      current: z.number().int().min(0),
      granularity: z.enum(["turn-per-scenario", "session-per-step"]),
      acceptanceHash: z.string(),
      unitTestsHash: z.string().nullable(),
      scenarioCheckpoint: z.string().nullable(),
    })
    .loose()
    .nullable(),
});

/** Un état qui ne respecte pas le schéma n'est jamais exécuté (§5.1). */
export function validateState(s: unknown): { ok: true } | { ok: false; reason: string } {
  const r = stateSchema.safeParse(s);
  if (r.success) return { ok: true };
  return { ok: false, reason: `état corrompu : ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
}
