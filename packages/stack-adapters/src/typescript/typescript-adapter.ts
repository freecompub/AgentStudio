import { randomBytes } from "node:crypto";
import { access, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeProcessRunner } from "../process/node-process-runner.js";
import { parseEslintReport } from "./eslint-report.js";
import type { ProcessRunner, StackAdapter } from "../protocols.js";
import { parseVitestReport } from "./vitest-report.js";

const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

export interface TypeScriptAdapterDeps {
  runner?: ProcessRunner;
  defaultTimeoutMs?: number;
}

/** Adaptateur TypeScript : Vitest en mode `run` (jamais watch), rapport JSON hors du projet. */
export function createTypeScriptAdapter(deps: TypeScriptAdapterDeps = {}): StackAdapter {
  const runner = deps.runner ?? createNodeProcessRunner();
  const vitestEntry = (root: string) => join(root, "node_modules", "vitest", "vitest.mjs");
  const exists = (p: string) => access(p).then(() => true, () => false);

  return {
    id: "typescript",
    layout: { acceptanceTests: ["tests/acceptance/**"], unitTests: ["tests/**", "src/**/*.test.ts"], sources: ["src/**"] },
    // Couches et bibliothèques que l'écosystème TypeScript tient pour de l'infrastructure ou de
    // l'interface : ce qu'un domaine ne devrait pas importer.
    infrastructureModules: ["Infrastructure", "Interface", "UI", "API", "react", "express", "next"],

    async detect(root) {
      try {
        const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
        return Boolean(pkg["devDependencies"]?.["vitest"] ?? pkg["dependencies"]?.["vitest"]);
      } catch {
        return false;
      }
    },

    /**
     * ESLint du projet, avec ses propres règles. Absent ou non configuré : rien n'est jugé,
     * et la porte le dira plutôt que de conclure.
     */
    async lint(opts) {
      const entry = join(opts.root, "node_modules", "eslint", "bin", "eslint.js");
      if (!(await exists(entry))) return { available: false, violations: [] };
      const r = await runner.run(
        process.execPath,
        [entry, "--format", "json", "--", ...(opts.files?.length ? opts.files : ["."])],
        {
          cwd: opts.root,
          // `process.execPath` est le binaire Electron dans l'application : sans cette variable,
          // il démarrerait une seconde fenêtre au lieu d'exécuter le script.
          env: { ELECTRON_RUN_AS_NODE: "1" },
          // Le lint est court : un délai franc évite de bloquer la porte sur un outil coincé.
          timeoutMs: opts.timeoutMs ?? 5 * 60_000,
          ...(opts.signal ? { signal: opts.signal } : {}),
        },
      );
      if (r.timedOut) return { available: false, violations: [] };
      try {
        return { ...parseEslintReport(JSON.parse(r.stdout), opts.root), tool: "eslint" };
      } catch {
        return { available: false, violations: [] };
      }
    },

    async runTests(opts) {
      const entry = vitestEntry(opts.root);
      try {
        await access(entry);
      } catch {
        throw new Error("Vitest n'est pas installé dans le projet (node_modules/vitest introuvable) : lancez l'installation des dépendances.");
      }
      const reportFile = join(tmpdir(), `agent-studio-vitest-${randomBytes(6).toString("hex")}.json`);
      try {
        const r = await runner.run(
          process.execPath,
          [entry, "run", "--reporter=json", `--outputFile=${reportFile}`, "--reporter=dot", "--no-color"],
          {
            cwd: opts.root,
            // Dans l'application, `process.execPath` est le binaire Electron : sans cette
            // variable, lancer les tests ouvrirait une seconde fenêtre. Invisible en test,
            // où Vitest fait tourner l'adaptateur sous Node.
            env: { ELECTRON_RUN_AS_NODE: "1" },
            timeoutMs: opts.timeoutMs ?? deps.defaultTimeoutMs ?? 10 * 60_000,
            ...(opts.signal ? { signal: opts.signal } : {}),
            ...(opts.onOutput ? { onOutput: opts.onOutput } : {}),
          },
        );
        const output = `${r.stdout}${r.stderr}`.slice(-20_000);
        let results: ReturnType<typeof parseVitestReport> = [];
        if (!r.timedOut) {
          try {
            results = parseVitestReport(JSON.parse(await readFile(reportFile, "utf8")), opts.root);
          } catch (err) {
            throw new Error(`Rapport de tests absent ou illisible (code ${r.exitCode}) :\n${output.slice(-2000)}`, { cause: err });
          }
        }
        return { results, exitCode: r.exitCode, timedOut: r.timedOut, output, durationMs: r.durationMs };
      } finally {
        await rm(reportFile, { force: true });
      }
    },

    isTestFile: (path) => TEST_FILE.test(path.replaceAll("\\", "/")),
    testFilePattern: TEST_FILE.source,
  };
}
