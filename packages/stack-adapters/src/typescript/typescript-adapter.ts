import { randomBytes } from "node:crypto";
import { access, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeProcessRunner } from "../process/node-process-runner.js";
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

  return {
    id: "typescript",

    async detect(root) {
      try {
        const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
        return Boolean(pkg["devDependencies"]?.["vitest"] ?? pkg["dependencies"]?.["vitest"]);
      } catch {
        return false;
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
