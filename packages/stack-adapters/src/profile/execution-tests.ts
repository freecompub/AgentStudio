import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCoberturaReport } from "../coverage/cobertura-report.js";
import type { CoverageReport, ProcessRunner, TestResult } from "../protocols.js";
import { compileBuildErrorSpec, readBuildErrors } from "./build-errors.js";
import { lireTests } from "./read-report.js";
import type { StackProfile } from "./stack-profile.js";
import { JETON_RAPPORT, JETON_RAPPORTS, substituer } from "./tokens.js";

/**
 * Lancement de la commande de test d'un profil, partagé par l'adaptateur et par les canaris de
 * `/stack doctor` : ce que les canaris éprouvent doit être exactement ce que les portes reçoivent.
 */
export interface ExecutionTests {
  /** `null` : aucun rapport, et aucune erreur de compilation lisible. Rien n'a été relevé. */
  results: TestResult[] | null;
  exitCode: number | null;
  timedOut: boolean;
  /** Fin de la sortie standard et d'erreur, pour les messages. */
  sortie: string;
  durationMs: number;
  coverage?: CoverageReport;
}

export interface ExecuterTestsOptions {
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
}

const temporaire = (profile: StackProfile, ext: string) => join(tmpdir(), `agent-studio-${profile.id}-${randomBytes(6).toString("hex")}.${ext}`);

/** Fichiers du dossier, récursivement. Vide si le dossier n'existe pas : rien n'a été écrit. */
async function fichiersSous(dossier: string, ext?: string): Promise<string[]> {
  const entrees = await readdir(dossier, { withFileTypes: true, recursive: true }).catch(() => []);
  return entrees
    .filter((e) => e.isFile() && (ext === undefined || e.name.endsWith(ext)))
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

/** Erreurs de compilation, si le profil dit comment les lire. Le motif est déjà validé à la lecture. */
function erreursDeCompilation(profile: StackProfile, sortie: string, root: string): TestResult[] {
  if (!profile.buildErrors) return [];
  const compile = compileBuildErrorSpec(profile.buildErrors);
  return "error" in compile ? [] : readBuildErrors(sortie, compile.spec, root);
}

/**
 * Couverture, si le profil déclare un lecteur. Un rapport absent ou illisible rend `undefined` :
 * la porte doit pouvoir dire « non mesurée » plutôt que de conclure à une couverture nulle.
 */
async function lireCouverture(profile: StackProfile, dossier: string, root: string): Promise<CoverageReport | undefined> {
  if (!profile.tests.coverage || !dossier) return undefined;
  // Les rapports sont cherchés dans l'arborescence : `dotnet test` en range un par projet de test,
  // sous un sous-dossier dont il choisit le nom ; `vitest` l'écrit à plat. Tous sont réunis.
  const lus: CoverageReport[] = [];
  for (const chemin of await fichiersSous(dossier, ".xml")) {
    const brut = await readFile(chemin, "utf8").catch(() => null);
    const lu = brut === null ? null : parseCoberturaReport(brut, root);
    if (lu) lus.push(lu);
  }
  return lus.length ? reunirCouvertures(lus) : undefined;
}

type FichierCouvert = CoverageReport["files"][number];

/**
 * Réunion de rapports de couverture : une ligne est couverte si l'un des rapports la couvre. Sans
 * le détail des lignes, on ne peut pas faire l'union : le meilleur rapport du fichier est gardé,
 * ce qui ne surestime jamais la couverture.
 */
function reunirCouvertures(rapports: readonly CoverageReport[]): CoverageReport {
  const parFichier = new Map<string, FichierCouvert[]>();
  for (const f of rapports.flatMap((r) => r.files)) parFichier.set(f.file, [...(parFichier.get(f.file) ?? []), f]);
  return {
    files: [...parFichier.values()].map((versions): FichierCouvert => {
      if (versions.length === 1) return versions[0]!;
      if (versions.some((v) => !v.lines)) return versions.reduce((a, b) => (b.covered > a.covered ? b : a));
      const lignes = new Map<number, boolean>();
      for (const l of versions.flatMap((v) => v.lines!)) lignes.set(l.number, (lignes.get(l.number) ?? false) || l.covered);
      const covered = [...lignes.values()].filter(Boolean).length;
      return {
        file: versions[0]!.file,
        covered,
        total: lignes.size,
        score: lignes.size ? Math.round((covered / lignes.size) * 1000) / 10 : 0,
        lines: [...lignes].sort(([a], [b]) => a - b).map(([number, c]) => ({ number, covered: c })),
      };
    }),
  };
}

/**
 * Lance la commande de test et relève ses résultats. Un rapport présent mais illisible lève une
 * erreur : rien n'en est tiré, et l'appelant décide de ce que cela vaut.
 *
 * `{rapports}` (ADR 0072, révisé le 08/11) : un dossier où la commande écrit un rapport par projet
 * de test ; tous sont lus et réunis. Avec `{rapport}`, un seul fichier : une commande qui lance
 * plusieurs projets y verrait le dernier écraser les autres.
 */
export async function executerTests(profile: StackProfile, runner: ProcessRunner, opts: ExecuterTestsOptions): Promise<ExecutionTests> {
  const plusieurs = profile.tests.command.some((a) => a.includes(JETON_RAPPORTS));
  // TAP sans `{rapport}` dans la commande : `prove`, `bats` n'écrivent que sur la sortie standard (ADR 0072).
  const surLaSortie = profile.tests.report === "tap" && !plusieurs && !profile.tests.command.some((a) => a.includes(JETON_RAPPORT));
  const rapport = plusieurs ? temporaire(profile, "rapports") : temporaire(profile, { "junit-xml": "xml", tap: "tap" }[profile.tests.report as string] ?? "json");
  if (plusieurs) await mkdir(rapport, { recursive: true });
  // Même exécution pour les deux : mesurer la couverture ne doit pas coûter un second passage
  // de toute la suite. L'outil écrit où le profil le lui dit, via `{couverture}`.
  const couverture = profile.tests.coverage ? temporaire(profile, "couverture") : "";
  if (couverture) await mkdir(couverture, { recursive: true });
  try {
    const r = await runner.run(profile.tests.command[0]!, substituer(profile.tests.command.slice(1), rapport, [], couverture, "", plusieurs ? rapport : ""), {
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs,
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.onOutput ? { onOutput: opts.onOutput } : {}),
    });
    const sortie = `${r.stdout}${r.stderr}`.slice(-20_000);
    const base = { exitCode: r.exitCode, sortie, durationMs: r.durationMs };
    if (r.timedOut) return { ...base, results: null, timedOut: true };

    const bruts = surLaSortie
      ? [r.stdout]
      : plusieurs
        ? await Promise.all((await fichiersSous(rapport)).map((f) => readFile(f, "utf8")))
        : await readFile(rapport, "utf8").then((b) => [b], () => [] as string[]);
    // Les erreurs de compilation sont lues même quand des rapports existent : un symbole absent
    // arrête la compilation d'UN projet, qui seul ne produit pas de rapport. Ne les lire qu'en
    // l'absence de tout rapport effaçait ce rouge, le plus courant du pas RED.
    const erreurs = erreursDeCompilation(profile, sortie, opts.cwd);
    if (bruts.length === 0) return { ...base, results: erreurs.length > 0 ? erreurs : null, timedOut: false };
    const coverage = await lireCouverture(profile, couverture, opts.cwd);
    return {
      ...base,
      results: [...bruts.flatMap((b) => lireTests(profile.tests.report, b, opts.cwd)), ...erreurs],
      timedOut: false,
      ...(coverage ? { coverage } : {}),
    };
  } finally {
    await rm(rapport, { recursive: true, force: true });
    if (couverture) await rm(couverture, { recursive: true, force: true });
  }
}
