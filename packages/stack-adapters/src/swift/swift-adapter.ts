import { randomBytes } from "node:crypto";
import { access, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeProcessRunner } from "../process/node-process-runner.js";
import type { ProcessRunner, StackAdapter, TestResult } from "../protocols.js";
import { parseMuterReport } from "./muter-report.js";
import { analyzeSwiftImports } from "./swift-architecture.js";
import { classifySwiftBuildError, parseSwiftBuildErrors, parseXcTestFailures, parseXunit } from "./swift-report.js";

const TEST_FILE = /(^|\/)Tests\//;

export interface SwiftToolchain {
  /** Binaire `swift` ; défaut : `swift` du PATH. */
  swift?: string;
  /** Binaire `muter` ; défaut : `muter` du PATH. */
  muter?: string;
  /** Variables d'environnement propres à la chaîne (bibliothèques, options du compilateur…). */
  env?: Record<string, string>;
}

export interface SwiftAdapterDeps {
  runner?: ProcessRunner;
  toolchain?: SwiftToolchain;
  defaultTimeoutMs?: number;
}

/**
 * Adaptateur Swift (SwiftPM + XCTest) : `swift test` non interactif avec rapport JUnit, erreurs de
 * compilation lues comme « symbole manquant » ou « autre erreur », Muter pour la mutation,
 * analyse des imports pour la règle de dépendance (§9.7).
 */
export function createSwiftAdapter(deps: SwiftAdapterDeps = {}): StackAdapter {
  const runner = deps.runner ?? createNodeProcessRunner();
  const tc = deps.toolchain ?? {};
  const env = tc.env ?? {};

  return {
    id: "swift",
    testFilePattern: TEST_FILE.source,
    isTestFile: (p) => TEST_FILE.test(p.replaceAll("\\", "/")),

    async detect(root) {
      try {
        await access(join(root, "Package.swift"));
        return true;
      } catch {
        return false;
      }
    },

    async runTests(opts) {
      const report = join(tmpdir(), `agent-studio-xunit-${randomBytes(6).toString("hex")}.xml`);
      try {
        const r = await runner.run(tc.swift ?? "swift", ["test", "--parallel", "--xunit-output", report], {
          cwd: opts.root,
          env,
          timeoutMs: opts.timeoutMs ?? deps.defaultTimeoutMs ?? 20 * 60_000,
          ...(opts.signal ? { signal: opts.signal } : {}),
          ...(opts.onOutput ? { onOutput: opts.onOutput } : {}),
        });
        const output = `${r.stdout}\n${r.stderr}`;
        const tail = output.slice(-20_000);
        if (r.timedOut) return { results: [], exitCode: r.exitCode, timedOut: true, output: tail, durationMs: r.durationMs };

        let xml: string | null = null;
        try {
          xml = await readFile(report, "utf8");
        } catch {
          xml = null;
        }
        const results: TestResult[] = [];
        if (xml) {
          const failures = parseXcTestFailures(output, opts.root);
          for (const c of parseXunit(xml)) {
            const key = `${c.classname.split(".").at(-1)}.${c.name}`;
            const f = failures.get(key);
            const res: TestResult = { id: `${c.classname}/${c.name}`, file: f?.file ?? "", status: c.status };
            if (c.status === "failed") {
              res.failureKind = f?.failureKind ?? "other_error";
              res.message = f?.message ?? "échec sans message";
            }
            results.push(res);
          }
        } else {
          // Pas de rapport : la compilation a échoué. Une entrée par fichier en erreur.
          const byFile = new Map<string, string>();
          for (const e of parseSwiftBuildErrors(output, opts.root)) if (!byFile.has(e.file)) byFile.set(e.file, e.message);
          if (byFile.size === 0) throw new Error(`swift test a échoué sans rapport ni erreur de compilation lisible (code ${r.exitCode}) :\n${tail.slice(-2000)}`);
          for (const [file, message] of byFile)
            results.push({ id: file, file, status: "failed", failureKind: TEST_FILE.test(file) ? classifySwiftBuildError(message) : "other_error", message });
        }
        results.sort((a, b) => a.id.localeCompare(b.id)); // --parallel : ordre du rapport non déterministe
        return { results, exitCode: r.exitCode, timedOut: false, output: tail, durationMs: r.durationMs };
      } finally {
        await rm(report, { force: true });
      }
    },

    async mutation(opts) {
      const out = join(tmpdir(), `agent-studio-muter-${randomBytes(6).toString("hex")}.json`);
      try {
        // Options de Muter à vérifier sur la version installée (§15).
        const r = await runner.run(tc.muter ?? "muter", ["run", "--skip-coverage", "--format", "json", "--output", out], {
          cwd: opts.root,
          env,
          timeoutMs: opts.timeoutMs ?? 60 * 60_000,
          ...(opts.signal ? { signal: opts.signal } : {}),
        });
        if (r.timedOut) throw new Error("Muter a dépassé le délai");
        return parseMuterReport(JSON.parse(await readFile(out, "utf8")), opts.root);
      } finally {
        await rm(out, { force: true });
      }
    },

    architecture: (opts) => analyzeSwiftImports(opts.root, opts.rules),
  };
}
