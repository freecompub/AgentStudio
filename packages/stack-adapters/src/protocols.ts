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
  /**
   * Couverture, quand le profil déclare comment la lire. Absente si le projet ne la produit pas :
   * une porte doit pouvoir distinguer « non mesurée » de « nulle ».
   */
  coverage?: CoverageReport;
}

/** Couverture de lignes, par fichier. Produite par la même exécution que les tests (§9.7). */
export interface CoverageReport {
  files: { file: string; covered: number; total: number; score: number; lines?: { number: number; covered: boolean }[] }[];
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
  /**
   * `killed` et `total` (mutants jugés) permettent de retirer un mutant du score, quand une
   * dérogation l'a reconnu équivalent (D22 de docs/12) ; `replacement` : le code du mutant.
   */
  files: {
    file: string;
    score: number;
    killed?: number;
    total?: number;
    /** Ligne de chaque mutant détecté : la porte peut ne juger que les lignes modifiées par une story (08/11). */
    killedLines?: number[];
    survived: { line: number; operator: string; replacement?: string }[];
  }[];
}

/**
 * Rapport du linter du projet. La qualité de forme — longueur des méthodes, imbrication,
 * nombre d'attributs — est jugée par l'outil que le projet a déjà configuré (ESLint, ruff…), avec ses propres seuils : deux autorités contradictoires sur la même question
 * bloqueraient du code que la CI du projet accepte.
 */
export interface LintReport {
  /** Faux quand le projet n'a pas de linter configuré : la porte ne juge alors rien. */
  available: boolean;
  /** Commande employée, citée dans les faits de la revue. */
  tool?: string;
  /**
   * Fichiers réellement examinés, chemins relatifs. Une liste vide, ou incomplète au regard des
   * fichiers demandés, veut dire que le linter n'a rien jugé — absence de violation ne vaut
   * alors pas conformité.
   */
  analyzed?: string[];
  violations: { file: string; line?: number; rule: string; message: string }[];
}

/**
 * Vérification de la mise en forme (ADR 0071), par l'outil du projet en mode vérification : le
 * code de sortie dit si le code est au format. `available` faux : outil absent, muet ou trop
 * lent — rien n'a été vérifié, ce qui ne vaut jamais « au format ».
 */
export interface FormatReport {
  available: boolean;
  ok: boolean;
  /** Programme employé, cité dans les faits de la revue. */
  tool?: string;
  /** Sortie de l'outil quand le code n'est pas au format : ce qu'il faut corriger. */
  sortie?: string;
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

/**
 * Un composant en BDD (ADR 0074) : ses `.feature` sont ses tests d'acceptance, liés par les
 * définitions d'étapes du dossier `etapes`, et lancés par `lanceur` (Reqnroll, Cucumber…).
 */
export interface CoupleBdd {
  lanceur: string;
  features: string;
  etapes: string;
}

export interface StackAdapter {
  readonly id: "typescript" | "dotnet";
  readonly layout: StackLayout;
  /** Couples BDD du projet (ADR 0074) ; absent : pas de BDD, le TDD seul. */
  readonly bdd?: CoupleBdd[];
  /**
   * Modules et frameworks que cet écosystème tient pour de l'infrastructure ou de l'interface :
   * ce qu'un domaine ne devrait pas importer. La liste dépend du langage — `Microsoft.AspNetCore` ne veut
   * rien dire en Python — donc elle vit ici, et non dans une extension, qui doit rester
   * indépendante des langages (D10).
   */
  readonly infrastructureModules: string[];
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
  /**
   * Linter du projet (facultatif selon la stack). Ne lève pas quand l'outil est absent :
   * renvoie `available: false`, pour que la porte le dise au lieu de conclure.
   */
  lint?(opts: { root: string; files?: string[]; timeoutMs?: number; signal?: AbortSignal }): Promise<LintReport>;
  /** Mise en forme vérifiée sans rien modifier (ADR 0071) ; absente si le projet n'en déclare pas. */
  format?(opts: { root: string; files?: string[]; timeoutMs?: number; signal?: AbortSignal }): Promise<FormatReport>;
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
