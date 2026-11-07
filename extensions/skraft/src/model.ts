/**
 * Modèle d'état unifié du pipeline skraft (SPEC-skraft §5.1) : un seul type, un seul validateur
 * (défaut C2 rendu impossible). Types purs, sérialisables, persistés par le moteur.
 */
import type { EcartDeclare, LigneDuPlan } from "./distill.js";
import { z } from "zod";
import type { CauseDEchec, DeliverScenario, Granularity, MutantExempte, MutantSurvivant } from "./deliver.js";
import type { Difficulty, DifficultyIndicators, LensName } from "./difficulty.js";
import type { LensVerdict, Verdict } from "./review.js";
import type { DefectResponse, DefectThread } from "./review-thread.js";
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
  // Transitoire, jamais enregistré (ADR 0013) : la synthèse du verdict a lieu dans la transition
  // `LENSES_DONE`, qui mène directement à RATIFICATION, COMMIT, SPECIALIST ou ESCALATED. Gardé
  // parce que SPEC-skraft §5.1 le déclare (écart S3 de docs/12).
  | "VERDICT_GATE"
  | "RATIFICATION"
  | "COMMIT"
  | "BLOCKED"
  | "ESCALATED"
  /** Désaccord persistant entre un agent et une lentille, soumis à l'humain (ADR 0046). */
  | "ARBITRATION"
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
export type DeliverStep = "test" | "dev" | "green" | "refactor" | "fix-test" | "fix" | "scenario-gate" | "mutation-arbitration";

/** Sous-machine DELIVER (§7.4). Les champs après `scenarioCheckpoint` sont internes au réducteur. */
/** Écart au plan de test validé : la déclaration, son auteur et son scénario (ADR 0067). */
export type EcartAuPlan = EcartDeclare & { par: string; scenario: string };

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
  /** Tests connus et tests verts au dernier point sûr, et au point de reprise (début du scénario ou de la correction). */
  baseline: { all: string[]; passed: string[] };
  scenarioBaseline: { all: string[]; passed: string[] };
  /** Tests verts au début de DELIVER : un test de cette liste devenu rouge est un candidat à l'obsolescence (ADR 0066). */
  avantDeliver?: string[];
  /** Cause du dernier refus du scénario, connue du code : elle choisit les options de l'escalade (ADR 0066). */
  derniereCause?: CauseDEchec;
  /** Motifs du dernier échec du scénario, pour le disjoncteur (ADR 0073). */
  dernierEchecDuScenario?: string[];
  /** Empreinte des tests unitaires au même point que `scenarioBaseline` : rendue à chaque reprise (D12 de docs/12). */
  scenarioUnitTestsHash?: string | null;
  /** Tests unitaires ajoutés pendant le scénario, et celui qui attend son vert. */
  unitTests: string[];
  newTest: string | null;
  /** Le test d'acceptance du scénario est vert au dernier vert (mode strict, avant le nettoyage). */
  acceptanceGreen: boolean;
  attempts: number;
  /** Échecs du scénario en cours (porte de fin de scénario ou budget d'un pas épuisé). */
  scenarioFailures: number;
  /** Cycles test → code du scénario en cours : plusieurs sont normaux, une infinité ne l'est pas. */
  cycles: number;
  /** Motif transmis au prochain agent (rejet d'une porte, revue). */
  feedback: string[];
  /** Informations pour les lentilles (mutation non mesurée, etc.). */
  notes: string[];
  // Champs ajoutés en S6 : facultatifs, un état persisté avant S6 reste lisible (schemaVersion 1).
  /** Faits établis par les portes de fin de scénario (mutation, dépendances…), pour la revue (§9.1). */
  facts?: string[];
  /** Correction des défauts de revue en cours (§9.3). */
  fixing?: boolean;
  /** Défauts blocker et major de la revue, retransmis à chaque relance de la correction. */
  reviewDefects?: string[];
  /** Retour de revue routé (ADR 0046) : défauts adressés à l'agent des tests, et au développeur. */
  reviewFeedback?: { test: string[]; code: string[] };
  /** Tests ajoutés par la correction côté tests et encore rouges : le développeur doit les faire passer. */
  fixTargets?: string[];
  /** Éléments du contrat ratifié présents dans le code à la revue : aucune correction ne doit les retirer. */
  contractSymbols?: string[];
  /**
   * Réponses de l'agent du pas en cours, appliquées aux fils seulement si sa porte valide le pas :
   * un pas refusé est annulé par rollback, ses « corrigé » avec lui.
   */
  pendingResponses?: DefectResponse[];
  /** Écarts au plan déclarés par le pas en cours : gardés si sa porte le valide (ADR 0067). */
  pendingDeviations?: EcartAuPlan[];
  /** Fils à l'entrée en correction : restaurés avec le code si la porte de fin de scénario échoue. */
  threadsAtFixStart?: DefectThread[];
  /**
   * Mutants contestés en cours d'arbitrage (ADR 0065) : ceux qui attendent l'humain, avec l'avis de
   * l'arbitre de mutation à lui montrer.
   */
  mutationArbitration?: { human: { id: string; avis: string }[] };
}

/** Mutant reconnu équivalent : exempté de la porte de mutation (ADR 0065). */
export interface Derogation extends MutantExempte {
  par: "agent" | "humain";
  raison: string;
  contestation: string;
  defaut: string;
}

/** Arbitrage d'un défaut de porte contesté, tracé par le moteur (ADR 0065). */
export interface ArbitrageRecord {
  porte: string;
  élément: string;
  contestation: string;
  décision: "dérogation" | "à corriger" | "obsolète";
  par: "agent" | "humain";
  raison: string;
}

export interface SkraftInput {
  storyPath: string;
  /** Skill d'architecture demandée à l'appel (`--archi`) ; absente ou inconnue : la clean architecture par défaut. */
  archi?: string;
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
  /** Référence de la couverture du diff de toute la tâche, conservée au redémarrage. */
  qualityCheckpoint?: string;
  branch: string;
  checkpoints: Partial<Record<Phase, string>>;
  artifacts: Record<Phase, ArtifactRecord[]>;
  reviews: Record<Phase, ReviewRecord[]>;
  attempts: number;
  budget: { maxAttemptsPerPhase: number; maxCyclesPerScenario: number };
  lastRejection: { gate: string; reasons: string[] } | null;
  openQuestions: { id: string; text: string; answer?: string }[];
  /** Matrice du plan de test gardée depuis DISTILL (ADR 0067). */
  planDeTest?: Record<string, LigneDuPlan>;
  /** Écarts au plan de test déclarés et validés en DELIVER, commités dans `ecarts-au-plan.md` (ADR 0067). */
  ecartsAuPlan?: EcartAuPlan[];
  /** Skill d'architecture retenue au lancement, recopiée dans le dossier de DESIGN, DISTILL et DELIVER. */
  architecture?: string;
  /** Inventaire de la recherche validée (skraft-plugin v1.15.1) : recopié dans le dossier de DESIGN et DISTILL. */
  recherche?: { conventions: string; existant: string } | null;
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
  /** Blocage signalé par un agent, en attente de réponse (§5.2, BLOCKED) ; `lens` : par une lentille de revue. */
  blocker: { question: string; choices: string[]; lens?: LensName } | null;
  /**
   * Par phase, index dans `artifacts` du premier livrable du run en cours : ceux d'avant viennent
   * d'un run effacé par un rembobinage, et ne doivent plus nourrir les faits (D6 de docs/12).
   */
  debutDuRun?: Partial<Record<Phase, number>>;
  /** Par phase, index dans `reviews` de la première revue du run en cours : les rapports d'avant ne sont pas réécrits (D8 de docs/12). */
  debutDesRevues?: Partial<Record<Phase, number>>;
  /** Retour donné au spécialiste en cours, rendu tel quel après une question bloquante (D9 de docs/12). */
  retour?: string[];
  /** Mutants exemptés de la porte de mutation, pour le run en cours de DELIVER (ADR 0065). */
  derogations?: Derogation[];
  /** Lignes exemptées de la couverture du diff par l'humain, pour le run en cours de DELIVER. */
  derogationsCouverture?: { file: string; line: number; raison: string; contestation: string; defaut: string }[];
  /**
   * Tests existants déclarés obsolètes par l'humain à l'escalade d'un scénario (ADR 0066) : hors des
   * portes jusqu'à la fin du cycle ; le bilan rappelle de les mettre à jour.
   */
  testsObsoletes?: { test: string; scenario: string; raison: string }[];
  /** Dernier refus compté d'une phase, avec son numéro d'essai : le disjoncteur compare au suivant (ADR 0073). */
  dernierRefusDePhase?: { phase: string; essai: number; gate: string; reasons: string[] };
  /** Toutes les décisions d'arbitrage, en ajout seul : le moteur trace chaque nouvelle (ADR 0065). */
  arbitrages?: ArbitrageRecord[];
  /** ADR connus à l'entrée de la phase en cours : la liste y revient au rembobinage (D2 de docs/12). */
  adrsAvantPhase?: AdrRecord[];
  /** Questions de revue posées dans la phase en cours (D4 de docs/12) ; au-delà de 2, escalade. */
  reviewQuestions?: number;
  /** Origine d'une escalade, pour savoir quoi relancer. */
  escalation: { from: "INIT" | "CLASSIFY" | "ROUTE" | "COMMIT" | "PHASE"; reason: string } | null;
  /** Réponses de l'utilisateur à transmettre au prochain dossier de passation. */
  answers: { question: string; answer: string }[];
  /** Questions ouvertes déjà soumises à l'utilisateur (pas de double demande). */
  questionsAsked: string[];
  /** Questions dont la demande a réellement été créée : « relancer » après une panne en ROUTE repose les autres (D17 de docs/12). */
  questionsConfirmees?: string[];
  /** Phases approuvées dont le commit a échoué, continuées sans commit par l'humain (D19 de docs/12). */
  nonCommitees?: Phase[];
  /** Empreinte des tests d'acceptance, gelés à la sortie de DISTILL (§7.3). */
  acceptanceHash: string | null;
  /** Tests d'acceptance déjà verts, requalifiés en non-régression avec justification. */
  regressions: string[];
  /** Granularité imposée par réglage, sinon choisie selon la difficulté. */
  granularitySetting: Granularity | null;
  /** Skills chargées à la demande par `load_skill`, tracées par rôle et par phase (D26) ; absent d'un état antérieur. */
  skillsLoaded?: { phase: Phase | null; role: Role; skills: string[] }[];
  /** Réessais par phase (mesures d'usage, §12) ; absent d'un état persisté avant S6. */
  retries?: Record<string, number>;
  /** Fils des défauts de revue de la phase en cours (ADR 0046) ; vidés au commit de la phase. */
  reviewThreads?: DefectThread[];
  /**
   * Rejets cumulés, toutes phases (porte, revue, scénario). Ne fait que croître : le moteur de
   * tâches y repère chaque nouveau rejet pour le tracer avec `lastRejection` (ADR 0032).
   */
  rejections?: number;
}

export type SkraftEvent =
  | {
      type: "INITIALIZED";
      slug: string;
      story: Story;
      baseSha: string;
      qualityCheckpoint?: string;
      branch: string;
      indicators: DifficultyIndicators;
    }
  | { type: "INIT_FAILED"; reasons: string[] }
  | { type: "DIFFICULTY_PROPOSED"; level: string; justification: string }
  | { type: "PHASE_CHECKPOINTED"; phase: Phase; checkpointId: string }
  | { type: "AGENT_REPORTED"; role: Role; summary: string; files: string[]; skills?: string[]; coveredBy?: string; responses?: DefectResponse[]; /** Écarts au plan de test déclarés (ADR 0067). */ planDeviations?: EcartDeclare[] }
  | { type: "BLOCKER_REPORTED"; question: string; choices: string[] }
  /** Une lentille demande une décision que ni la story ni les réponses ne tranchent (D4 de docs/12). */
  | { type: "LENS_BLOCKED"; lens: LensName; question: string; choices: string[] }
  | {
      type: "GATE_OK";
      artifacts: ArtifactRecord[];
      adrs?: AdrRecord[];
      openQuestions?: string[];
      /** DISTILL : matrice du plan de test, par critère, pour vérifier les écarts déclarés en DELIVER (ADR 0067). */
      planDeTest?: Record<string, LigneDuPlan>;
      /** RESEARCH : conventions et existant réutilisable, transmis à DESIGN et DISTILL. */
      recherche?: { conventions: string; existant: string };
      acceptanceHash?: string;
      regressions?: string[];
      /** DELIVER : faits et notes de la mutation de fin de phase, pour les lentilles (ADR 0049). */
      facts?: string[];
      notes?: string[];
    }
  | { type: "GATE_FAIL"; gate: string; reasons: string[]; /** Porte de mutation : les survivants, un défaut chacun (ADR 0065). */ mutants?: MutantSurvivant[]; /** Couverture du diff : les lignes non couvertes, par fichier. */ lignes?: { file: string; lines: number[] }[] }
  | { type: "QUESTION_ASKED"; id: string }
  | { type: "MUTANTS_JUDGED"; rulings: { defect: string; decision: "accepted" | "maintained"; reason?: string }[] }
  | {
      type: "LENSES_DONE";
      lenses: LensVerdict[];
      reportPath: string;
      /** DELIVER : éléments du contrat ratifié présents dans le code au moment de la revue (ADR 0047). */
      contractSymbols?: string[];
    }
  | { type: "COMMITTED"; sha: string | null }
  | { type: "DELIVER_PLANNED"; scenarios: DeliverScenario[]; all: string[]; passed: string[] }
  | { type: "SCENARIO_STARTED"; checkpointId: string }
  | {
      type: "STEP_OK";
      checkpointId: string;
      all: string[];
      passed: string[];
      newTest?: string;
      unitTestsHash?: string;
      acceptanceGreen?: boolean;
      /** Pas « test » sans test unitaire : le comportement est couvert par l'acceptance (ADR 0045). */
      viaAcceptance?: boolean;
      /** Correction côté tests : tests ajoutés encore rouges, à faire passer par le développeur (ADR 0046). */
      fixTargets?: string[];
    }
  | { type: "STEP_FAIL"; reason: string; rouges?: string[] }
  | { type: "SCENARIO_OK"; notes: string[]; facts?: string[] }
  | { type: "SCENARIO_FAIL"; reasons: string[]; rouges?: string[]; lignes?: { file: string; lines: number[] }[] };

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
  /** `lens` : question d'une lentille de revue (D4 de docs/12). */
  | { kind: "askBlocker"; question: string; choices: string[]; lens?: LensName }
  | { kind: "askQuestion"; id: string; text: string }
  | { kind: "askEscalation"; reason: string; options: ("obsolete" | "exempt" | "retry" | "skip" | "continue" | "abort")[] }
  | { kind: "askArbitration"; thread: DefectThread }
  | { kind: "arbitrateMutants"; threads: DefectThread[] }
  | { kind: "askMutationArbitration"; thread: DefectThread; avis: string }
  | { kind: "rollback"; to: string }
  // Rembobiner le dépôt sans faire oublier les conversations qui le décrivent, c'est garder le
  // souvenir et retirer la chose (ADR 0040, 0050). Les deux vont ensemble.
  | { kind: "forgetSessions"; roles: string[] }
  | { kind: "commitPhase"; phase: Phase; message: string }
  | { kind: "finalReport" }
  | { kind: "planDeliver" }
  | { kind: "startScenario"; scenarioId: string }
  | { kind: "runDeliverAgent"; step: "test" | "dev" | "green" | "refactor" | "fix-test" | "fix"; scenarioId: string; attempt: number; feedback: string[] }
  | { kind: "verifyFixTests"; scenarioId: string; since: string; baseline: { all: string[]; passed: string[] }; /** Tests existants qu'un défaut demande de renforcer (D10 de docs/12). */ editable?: string[] }
  | { kind: "verifyUnitRed"; scenarioId: string; since: string; baseline: { all: string[]; passed: string[] }; pending: string[]; coveredBy?: string }
  | {
      kind: "verifyUnitGreen";
      mode: "dev" | "green" | "refactor" | "fix";
      scenarioId: string;
      since: string;
      newTest: string | null;
      unitTestsHash: string | null;
      pending: string[];
      /** Correction : tests rouges ajoutés côté tests, qui doivent passer (ADR 0046). */
      targets?: string[];
      /** Correction : éléments du contrat ratifié qui doivent rester dans le code (ADR 0047). */
      contractSymbols?: string[];
      /** Correction où chaque défaut est contesté ou renvoyé : le pas peut ne rien modifier (D7 de docs/12). */
      nothingToChange?: true;
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
  ARBITRATION: "Désaccord de revue à arbitrer",
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
  stage: z.enum(["INIT", "CLASSIFY", "CONFIRM_DIFFICULTY", "ROUTE", "SPECIALIST", "ARTIFACT_GATE", "REVIEW", "VERDICT_GATE", "RATIFICATION", "COMMIT", "BLOCKED", "ESCALATED", "ARBITRATION", "DONE", "ABORTED"]),
  phase: phase.nullable(),
  phaseOrder: z.array(phase).min(1),
  skipPhases: z.array(phase),
  phasesCompleted: z.array(phase),
  difficulty: z.object({ level: z.enum(["simple", "medium", "medium-hard", "challenging"]), indicators: z.unknown(), confirmedBy: z.enum(["user", "auto"]) }).nullable(),
  baseSha: z.string(),
  qualityCheckpoint: z.string().optional(),
  branch: z.string(),
  checkpoints: z.record(z.string(), z.string()),
  artifacts: byPhase(z.object({ path: z.string(), sha256: z.string(), producedBy: z.string(), attempt: z.number() })),
  reviews: byPhase(z.object({ attempt: z.number(), lenses: z.array(z.unknown()), verdict: z.enum(["APPROVED", "CHANGES_REQUESTED", "REJECTED"]), reportPath: z.string() })),
  attempts: z.number().int().min(0),
  budget: z.object({ maxAttemptsPerPhase: z.number().int().min(1), maxCyclesPerScenario: z.number().int().min(1) }),
  lastRejection: z.object({ gate: z.string(), reasons: z.array(z.string()) }).nullable(),
  openQuestions: z.array(z.object({ id: z.string(), text: z.string(), answer: z.string().optional() })),
  recherche: z.object({ conventions: z.string(), existant: z.string() }).nullable().optional(),
  architecture: z.string().optional(),
  planDeTest: z.record(z.string(), z.object({ couche: z.string(), doublure: z.string() })).optional(),
  ecartsAuPlan: z.array(z.object({ criterion: z.string(), planned: z.string(), actual: z.string(), rule: z.string(), par: z.string(), scenario: z.string() })).optional(),
  adrs: z.array(z.object({ id: z.string(), path: z.string(), status: z.enum(["Proposed", "Accepted", "Rejected"]), decisionBy: z.string().optional() })),
  pendingInteraction: z.string().nullable(),
  retries: z.record(z.string(), z.number().int().min(0)).optional(),
  rejections: z.number().int().min(0).optional(),
  skillsLoaded: z.array(z.object({ phase: phase.nullable(), role: z.string(), skills: z.array(z.string()) })).optional(),
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
