/**
 * Protocoles des adaptateurs de stack (§9.7) : lancer les tests, lire leur rapport,
 * reconnaître les fichiers de test. La mutation et l'architecture viendront avec J5/S5.
 */

export type FailureKind = "assertion" | "missing_symbol" | "other_error";

export interface TestResult {
  /** Identifiant stable : `<fichier relatif> > <titre complet>` ou le fichier seul si la suite n'a pas chargé. */
  id: string;
  file: string;
  status: "passed" | "failed" | "skipped";
  failureKind?: FailureKind;
  message?: string;
}

export interface TestRun {
  results: TestResult[];
  exitCode: number | null;
  timedOut: boolean;
  /** Sortie brute (tronquée), pour les preuves et le diagnostic. */
  output: string;
  durationMs: number;
}

export interface RunTestsOptions {
  root: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Chaque ligne de sortie : sert aussi de signe de vie pour le watchdog (§6.4). */
  onOutput?: (chunk: string) => void;
}

/** Rapport de mutation (§9.6) : score global et par fichier, mutants survivants. */
export interface MutationReport {
  /** Pourcentage de mutants tués, de 0 à 100. */
  score: number;
  files: { file: string; score: number; survived: { line: number; operator: string }[] }[];
}

/** Règle de dépendance : un module ne doit pas importer certains modules (§9.7). */
export interface DependencyRule {
  module: string;
  forbidden: string[];
}

export interface ArchitectureReport {
  modules: { name: string; imports: string[] }[];
  violations: { module: string; file: string; imported: string }[];
}

/** Emplacements conventionnels d'une stack (motifs `@stack:*` des manifestes, SPEC-skraft §10). */
export interface StackLayout {
  acceptanceTests: string[];
  unitTests: string[];
  sources: string[];
}

export interface StackAdapter {
  readonly id: "typescript" | "swift" | "dotnet";
  readonly layout: StackLayout;
  /** Vrai si l'adaptateur reconnaît le projet. */
  detect(root: string): Promise<boolean>;
  runTests(opts: RunTestsOptions): Promise<TestRun>;
  isTestFile(path: string): boolean;
  /** Motif (source d'expression régulière) équivalent à `isTestFile`, transmissible à un autre processus. */
  readonly testFilePattern: string;
  /** Tests de mutation (facultatif selon la stack). */
  mutation?(opts: { root: string; timeoutMs?: number; signal?: AbortSignal }): Promise<MutationReport>;
  /** Analyse des dépendances entre modules (facultatif selon la stack). */
  architecture?(opts: { root: string; rules: DependencyRule[] }): Promise<ArchitectureReport>;
}

// ---------- Exécution de processus ------------------------------------------------

export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface ProcessOptions {
  cwd: string;
  env?: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
}

/** Lance une commande sans shell ; tue tout l'arbre de processus au-delà du délai (§9.7). */
export interface ProcessRunner {
  run(cmd: string, args: readonly string[], opts: ProcessOptions): Promise<ProcessResult>;
}
