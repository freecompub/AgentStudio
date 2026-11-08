import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeProcessRunner } from "../process/node-process-runner.js";
import type { FormatReport, LintReport, ProcessRunner, StackAdapter } from "../protocols.js";
import { compileBuildErrorSpec, readBuildErrors } from "./build-errors.js";
import { parseCoberturaReport } from "../coverage/cobertura-report.js";
import { lireLint, lireTests } from "./read-report.js";
import { JETON_RAPPORT, JETON_RAPPORTS, substituer } from "./tokens.js";
import { executerTests } from "./execution-tests.js";
import { parseStrykerReport } from "../mutation/stryker-report.js";
import { globToRegExp } from "../glob.js";
import type { StackProfile } from "./stack-profile.js";
import { detecte } from "./detect.js";
import { analyserImports } from "./architecture.js";
import { compilerMotifSur } from "./motif-sur.js";

/**
 * Adaptateur bâti sur un profil déclaratif (J5). Il ne connaît aucun langage : il exécute les
 * commandes que le projet déclare et confie leur sortie au lecteur nommé.
 *
 * Seuls quelques jetons sont substitués dans les arguments (voir `tokens.ts`) : `{rapport}`, un
 * fichier temporaire **hors du projet** ; `{fichiers}`, développé en autant d'arguments que de
 * fichiers ; `{couverture}` et `{dossier}`, des dossiers temporaires hors du projet. Le reste est
 * passé tel quel, sans shell.
 */
export interface ProfileAdapterDeps {
  runner?: ProcessRunner;
  defaultTimeoutMs?: number;
}


/**
 * Rapport de mutation rangé par l'outil dans son dossier de sortie : `mutation-report.json` de
 * préférence (Stryker), sinon le premier `.json` trouvé. `null` si rien n'a été écrit.
 */
async function rapportDansDossier(dossier: string): Promise<string | null> {
  const entrees = await readdir(dossier, { withFileTypes: true, recursive: true }).catch(() => []);
  const json = entrees.filter((e) => e.isFile() && e.name.endsWith(".json"));
  const choisi = json.find((e) => e.name === "mutation-report.json") ?? json[0];
  return choisi ? readFile(join(choisi.parentPath, choisi.name), "utf8") : null;
}

export function createProfileAdapter(profile: StackProfile, deps: ProfileAdapterDeps = {}): StackAdapter {
  const runner = deps.runner ?? createNodeProcessRunner();
  const fichierTemporaire = (ext: string) => join(tmpdir(), `agent-studio-${profile.id}-${randomBytes(6).toString("hex")}.${ext}`);
  const motifs = (globs: readonly string[]) => globs.map((g) => globToRegExp(g));
  /** Pour le GEL des tests : insensible à la casse (ADR 0035), sinon une majuscule le contourne. */
  const motifsSansCasse = (globs: readonly string[]) => globs.map((g) => globToRegExp(g, "i"));
  // BDD (ADR 0074) : les `.feature` et leurs étapes sont des tests d'acceptance, que le gel couvre.
  const bdd = profile.bdd?.length ? profile.bdd.map((c) => ({ lanceur: c.lanceur, features: c.features.replace(/\/+$/, ""), etapes: c.etapes.replace(/\/+$/, "") })) : undefined;
  const layout = bdd ? { ...profile.layout, acceptanceTests: [...profile.layout.acceptanceTests, ...bdd.flatMap((c) => [`${c.features}/**`, `${c.etapes}/**`])] } : profile.layout;
  const testGlobs = [...layout.unitTests, ...layout.acceptanceTests];
  // Motif d'import compilé une fois ; le profil a déjà été validé à la lecture (`parseStackProfile`).
  const compile = profile.architecture ? compilerMotifSur("architecture.import", profile.architecture.import, ["module"]) : null;
  const architecture = compile && "re" in compile ? compile.re : null;

  return {
    // L'identifiant du port reste fermé tant que d'autres stacks ne sont pas déclarées ailleurs.
    id: profile.id as StackAdapter["id"],
    layout,
    ...(bdd ? { bdd } : {}),
    // `bdd` absent du profil : rien n'est décidé pour ce composant (08/11).
    bddNonDecide: profile.bdd === undefined ? ["."] : [],
    infrastructureModules: profile.infrastructureModules,
    // `[].join("|")` rend la chaîne vide, et `new RegExp("")` reconnaît TOUT. L'extension
    // reconstruit un RegExp depuis ce motif (extension-host) : un motif vide y ferait de chaque
    // fichier un fichier de test, et la garde d'écriture de la phase rouge n'interdirait plus
    // rien. `(?!)` ne reconnaît jamais rien, ce qui est le repli sûr et s'accorde avec
    // `isTestFile` juste en dessous.
    testFilePattern: testGlobs.length === 0 ? "(?!)" : testGlobs.map((g) => globToRegExp(g).source).join("|"),
    // Insensible à la casse (ADR 0035) : `isTestFile` sert au GEL des tests (D21/D22). Un test
    // gelé que la casse rendrait méconnaissable redeviendrait modifiable.
    isTestFile: (p) => motifsSansCasse(testGlobs).some((re) => re.test(p.replaceAll("\\", "/"))),

    async detect(root) {
      return detecte(profile.detect, root);
    },

    async runTests(opts) {
      const e = await executerTests(profile, runner, {
        cwd: opts.root,
        timeoutMs: opts.timeoutMs ?? deps.defaultTimeoutMs ?? 10 * 60_000,
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.onOutput ? { onOutput: opts.onOutput } : {}),
      });
      const base = { exitCode: e.exitCode, output: e.sortie, durationMs: e.durationMs };
      if (e.timedOut) return { ...base, results: [], timedOut: true };
      if (e.results === null) {
        // Pas de rapport : sur un langage compilé, c'est le cas normal d'un symbole absent — la
        // compilation s'arrête avant d'exécuter quoi que ce soit. Le profil dit comment lire ces
        // erreurs ; sans cette section, le rouge légitime du pas RED n'atteindrait pas la porte.
        const jeton = profile.tests.command.some((a) => a.includes(JETON_RAPPORTS)) ? JETON_RAPPORTS : JETON_RAPPORT;
        throw new Error(
          `Rapport de tests absent (code ${e.exitCode}) : la commande déclarée écrit-elle bien dans ${jeton} ?` +
            `${profile.buildErrors ? "" : " Si ce projet est compilé, déclarez `buildErrors` pour que les erreurs de compilation soient lues."}\n${e.sortie.slice(-2000)}`,
        );
      }
      return { ...base, results: e.results, timedOut: false, ...(e.coverage ? { coverage: e.coverage } : {}) };
    },

    ...(profile.lint
      ? {
          async lint(opts): Promise<LintReport> {
            const c = profile.lint!;
            const args = substituer(c.command.slice(1), "", opts.files ?? []);
            const r = await runner
              .run(c.command[0]!, args, {
                cwd: opts.root,
                timeoutMs: opts.timeoutMs ?? 5 * 60_000,
                ...(opts.signal ? { signal: opts.signal } : {}),
              })
              .catch(() => null);
            // Outil absent, en échec ou muet : rien n'a été jugé, et la porte doit le dire.
            if (!r || r.timedOut || !r.stdout.trim()) return { available: false, violations: [] };
            try {
              return { ...lireLint(c.report, JSON.parse(r.stdout), opts.root), tool: c.command[0]! };
            } catch {
              return { available: false, violations: [] };
            }
          },
        }
      : {}),

    // Analyse des imports déclarée (ADR 0072) : la règle de dépendance devient vérifiable.
    ...(architecture
      ? {
          architecture: ({ root, rules }) => analyserImports(profile.architecture!, architecture, root, rules),
        }
      : {}),

    ...(profile.format
      ? {
          async format(opts): Promise<FormatReport> {
            const c = profile.format!;
            const r = await runner
              .run(c.command[0]!, substituer(c.command.slice(1), "", opts.files ?? []), {
                cwd: opts.root,
                timeoutMs: opts.timeoutMs ?? 5 * 60_000,
                ...(opts.signal ? { signal: opts.signal } : {}),
              })
              .catch(() => null);
            // Outil absent ou trop lent : rien n'a été vérifié, ce qui ne vaut pas « au format ».
            if (!r || r.timedOut || r.exitCode === null) return { available: false, ok: false };
            if (r.exitCode === 0) return { available: true, ok: true, tool: c.command[0]! };
            const sortie = `${r.stdout}\n${r.stderr}`.trim().slice(-4_000);
            return { available: true, ok: false, tool: c.command[0]!, ...(sortie ? { sortie } : {}) };
          },
        }
      : {}),

    ...(profile.mutation
      ? {
          async mutation(opts) {
            const c = profile.mutation!;
            const rapport = fichierTemporaire("json");
            // Dossier de sortie (`{dossier}`) pour un outil qui range lui-même son rapport.
            const dossier = fichierTemporaire("mutation");
            await mkdir(dossier, { recursive: true });
            try {
              const r = await runner.run(c.command[0]!, substituer(c.command.slice(1), rapport, [], "", dossier), {
                cwd: opts.root,
                timeoutMs: opts.timeoutMs ?? 60 * 60_000,
                ...(opts.signal ? { signal: opts.signal } : {}),
              });
              if (r.timedOut) throw new Error("L'outil de mutation a dépassé le délai");
              const brut = (await readFile(rapport, "utf8").catch(() => null)) ?? (await rapportDansDossier(dossier)) ?? r.stdout;
              const json = JSON.parse(brut);
              return parseStrykerReport(json, opts.root);
            } finally {
              await rm(rapport, { force: true });
              await rm(dossier, { recursive: true, force: true });
            }
          },
        }
      : {}),
  };
}

