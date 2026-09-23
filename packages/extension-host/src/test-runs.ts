import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Clock, Evidence, EvidenceStore, IdGenerator, ToolCallGuard, ToolSpec } from "@agent-studio/core";
import type { EvidenceTag } from "@agent-studio/extension-api";
import { fingerprintFiles, type StackAdapter, type TestRun } from "@agent-studio/stack-adapters";
import type { Workspace } from "@agent-studio/workspace";

export interface TestRunServiceDeps {
  workspace: Workspace;
  stack: StackAdapter;
  evidence: EvidenceStore;
  clock: Clock;
  ids: IdGenerator;
}

export interface TestRunRequest {
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
  tag?: EvidenceTag;
  source: Evidence["source"];
}

/** Exécution des tests par le cœur, avec enregistrement de la preuve (D20). */
export function createTestRunService(deps: TestRunServiceDeps) {
  return {
    async run(req: TestRunRequest): Promise<TestRun> {
      const run = await deps.stack.runTests({
        root: deps.workspace.root,
        ...(req.signal ? { signal: req.signal } : {}),
        ...(req.onOutput ? { onOutput: req.onOutput } : {}),
      });
      if (req.tag) {
        const failing = run.results.filter((r) => r.status === "failed");
        await deps.evidence.append({
          id: deps.ids.next(),
          taskId: req.tag.taskId,
          ...(req.tag.stepId ? { stepId: req.tag.stepId } : {}),
          ...(req.tag.phase ? { phase: req.tag.phase } : {}),
          source: req.source,
          at: deps.clock.now().toISOString(),
          exitCode: run.exitCode,
          timedOut: run.timedOut,
          durationMs: run.durationMs,
          counts: {
            passed: run.results.filter((r) => r.status === "passed").length,
            failed: failing.length,
            skipped: run.results.filter((r) => r.status === "skipped").length,
          },
          testIds: run.results.map((r) => r.id),
          failing: failing.slice(0, 50).map((r) => ({
            id: r.id,
            ...(r.failureKind ? { failureKind: r.failureKind } : {}),
            ...(r.message ? { message: r.message.slice(0, 500) } : {}),
          })),
          testsHash: await fingerprintFiles(deps.workspace.files, (p) => deps.stack.isTestFile(p)),
          head: await deps.workspace.repo.head(),
        });
      }
      return run;
    },
  };
}

export type TestRunService = ReturnType<typeof createTestRunService>;

/** Résumé lisible par l'agent : il ne voit que ce que le code a mesuré. */
export function summarizeRun(run: TestRun): string {
  if (run.timedOut) return "Les tests ont dépassé le délai et ont été interrompus.";
  const count = (s: string) => run.results.filter((r) => r.status === s).length;
  const lines = [`Résultat : ${count("passed")} réussi(s), ${count("failed")} en échec, ${count("skipped")} ignoré(s).`];
  const failing = run.results.filter((r) => r.status === "failed").slice(0, 20);
  if (failing.length) {
    lines.push("Échecs :");
    for (const f of failing) lines.push(`- ${f.id} [${f.failureKind ?? "?"}] ${(f.message ?? "").split("\n").find((l) => l.trim())?.slice(0, 300) ?? ""}`);
  }
  return lines.join("\n");
}

/**
 * Outil `run_tests` (§6.5) : handler = notre code. Chaque ligne de sortie réarme le watchdog ;
 * chaque exécution est une preuve. `onRun` permet d'activer le gel des tests après un rouge.
 */
export function runTestsTool(service: TestRunService, opts: { beat: () => void; signal?: AbortSignal; tag?: EvidenceTag; onRun?: (run: TestRun) => void }): ToolSpec {
  return {
    name: "run_tests",
    description: "Lance la suite de tests du projet et renvoie le résultat mesuré par l'application. C'est la seule façon d'exécuter les tests.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async handler() {
      const run = await service.run({
        source: "run_tests",
        onOutput: () => opts.beat(),
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.tag ? { tag: opts.tag } : {}),
      });
      opts.onRun?.(run);
      return summarizeRun(run);
    },
  };
}

/** Garde de gel : une fois gelés, les fichiers de test ne peuvent plus être écrits (D21, D22). */
export function testFreezeGuard(root: string, isTestFile: (p: string) => boolean, frozen: () => boolean): ToolCallGuard {
  const base = resolve(root);
  return {
    async check(req) {
      if (req.kind !== "write" || !req.path || !frozen()) return { decision: "allow" };
      const rel = relative(base, resolve(base, req.path));
      if (rel.startsWith("..") || isAbsolute(rel)) return { decision: "allow" }; // hors projet : l'autre garde refuse
      return isTestFile(rel.split(sep).join("/"))
        ? { decision: "deny", reason: "Les tests sont gelés depuis ton exécution rouge : ne modifie plus aucun test, écris le code de production." }
        : { decision: "allow" };
    },
  };
}
