import { randomBytes } from "node:crypto";
import { access, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeProcessRunner } from "../process/node-process-runner.js";
import type { LintReport, ProcessRunner, StackAdapter, TestResult } from "../protocols.js";
import { parseXunit } from "../swift/swift-report.js";
import { classifyFailure, parseVitestReport } from "../typescript/vitest-report.js";
import { parseEslintReport } from "../typescript/eslint-report.js";
import { parseSwiftLintReport } from "../swift/swiftlint-report.js";
import { parseMuterReport } from "../swift/muter-report.js";
import { globToRegExp } from "../glob.js";
import type { StackProfile } from "./stack-profile.js";

/**
 * Adaptateur bâti sur un profil déclaratif (J5). Il ne connaît aucun langage : il exécute les
 * commandes que le projet déclare et confie leur sortie au lecteur nommé.
 *
 * Deux jetons sont substitués dans les arguments, et eux seuls : `{rapport}`, remplacé par un
 * fichier temporaire **hors du projet**, et `{fichiers}`, développé en autant d'arguments que de
 * fichiers. Le reste est passé tel quel, sans shell.
 */
export interface ProfileAdapterDeps {
  runner?: ProcessRunner;
  defaultTimeoutMs?: number;
}

const JETON_RAPPORT = "{rapport}";
const JETON_FICHIERS = "{fichiers}";

/** Développe les jetons ; `{fichiers}` produit plusieurs arguments, les autres un seul. */
function substituer(args: readonly string[], rapport: string, fichiers: readonly string[]): string[] {
  const out: string[] = [];
  for (const a of args) {
    if (a === JETON_FICHIERS) out.push(...fichiers);
    else out.push(a.replaceAll(JETON_RAPPORT, rapport));
  }
  return out;
}

const existe = (p: string) => access(p).then(() => true, () => false);

export function createProfileAdapter(profile: StackProfile, deps: ProfileAdapterDeps = {}): StackAdapter {
  const runner = deps.runner ?? createNodeProcessRunner();
  const fichierTemporaire = (ext: string) => join(tmpdir(), `agent-studio-${profile.id}-${randomBytes(6).toString("hex")}.${ext}`);
  const motifs = (globs: readonly string[]) => globs.map((g) => globToRegExp(g));
  const testGlobs = [...profile.layout.unitTests, ...profile.layout.acceptanceTests];

  return {
    // L'identifiant du port reste fermé tant que d'autres stacks ne sont pas déclarées ailleurs.
    id: profile.id as StackAdapter["id"],
    layout: profile.layout,
    infrastructureModules: profile.infrastructureModules,
    testFilePattern: testGlobs.map((g) => globToRegExp(g).source).join("|"),
    isTestFile: (p) => motifs(testGlobs).some((re) => re.test(p.replaceAll("\\", "/"))),

    async detect(root) {
      for (const f of profile.detect) if (await existe(join(root, f))) return true;
      return false;
    },

    async runTests(opts) {
      const rapport = fichierTemporaire(profile.tests.report === "junit-xml" ? "xml" : "json");
      const args = substituer(profile.tests.command.slice(1), rapport, []);
      try {
        const r = await runner.run(profile.tests.command[0]!, args, {
          cwd: opts.root,
          timeoutMs: opts.timeoutMs ?? deps.defaultTimeoutMs ?? 10 * 60_000,
          ...(opts.signal ? { signal: opts.signal } : {}),
          ...(opts.onOutput ? { onOutput: opts.onOutput } : {}),
        });
        const output = `${r.stdout}${r.stderr}`.slice(-20_000);
        if (r.timedOut) return { results: [], exitCode: r.exitCode, timedOut: true, output, durationMs: r.durationMs };
        const brut = await readFile(rapport, "utf8").catch(() => null);
        if (brut === null)
          throw new Error(`Rapport de tests absent (code ${r.exitCode}) : la commande déclarée écrit-elle bien dans {rapport} ?\n${output.slice(-2000)}`);
        return { results: lireTests(profile.tests.report, brut, opts.root), exitCode: r.exitCode, timedOut: false, output, durationMs: r.durationMs };
      } finally {
        await rm(rapport, { force: true });
      }
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

    ...(profile.mutation
      ? {
          async mutation(opts) {
            const c = profile.mutation!;
            const rapport = fichierTemporaire("json");
            try {
              const r = await runner.run(c.command[0]!, substituer(c.command.slice(1), rapport, []), {
                cwd: opts.root,
                timeoutMs: opts.timeoutMs ?? 60 * 60_000,
                ...(opts.signal ? { signal: opts.signal } : {}),
              });
              if (r.timedOut) throw new Error("L'outil de mutation a dépassé le délai");
              const brut = await readFile(rapport, "utf8").catch(() => r.stdout);
              return parseMuterReport(JSON.parse(brut), opts.root);
            } finally {
              await rm(rapport, { force: true });
            }
          },
        }
      : {}),
  };
}

function lireTests(reader: StackProfile["tests"]["report"], brut: string, root: string): TestResult[] {
  if (reader === "junit-xml")
    return parseXunit(brut).map((c) => ({
      id: `${c.classname}.${c.name}`,
      file: c.classname,
      status: c.status,
      // La porte RED distingue un rouge légitime — assertion, symbole manquant — d'une erreur
      // de syntaxe. Sans classification, elle laisserait passer la seconde.
      ...(c.status === "failed" ? { failureKind: classifyFailure(c.message ?? ""), ...(c.message ? { message: c.message } : {}) } : {}),
    }));
  if (reader === "vitest-json") return parseVitestReport(JSON.parse(brut), root);
  throw new Error(`Le format « ${reader} » ne décrit pas des résultats de tests.`);
}

function lireLint(reader: NonNullable<StackProfile["lint"]>["report"], brut: unknown, root: string): LintReport {
  if (reader === "eslint-json") return parseEslintReport(brut, root);
  if (reader === "swiftlint-json") return parseSwiftLintReport(brut, root);
  throw new Error(`Le format « ${reader} » ne décrit pas un rapport de linter.`);
}
