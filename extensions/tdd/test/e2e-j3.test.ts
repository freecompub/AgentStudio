/**
 * Critères de sortie de J3 (§14), sans LLM : vrai dépôt Git, vrai Vitest, agents scriptés.
 *  - preuves de rouge puis vert présentes pour chaque comportement (tour unique et mode strict) ;
 *  - une escalade survit à un redémarrage et reprend après réponse.
 * Et D22 : tour unique par défaut, gel des tests dans le tour, bascule en mode strict après un échec.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Evidence } from "@agent-studio/core";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TddState } from "../src/index.js";
import { assemble, CAP_SRC, CAP_TEST, createProject, devAgent, git, phaseOf, planner, put, ROLE, testAgent, until, HOST_MODES, shutdownHosts } from "./support/harness.js";

const STEPS = {
  s1: { behavior: "plafonne la dose", testFile: "tests/cap.test.ts", test: CAP_TEST, srcFile: "src/cap.ts", src: CAP_SRC },
  s2: {
    behavior: "explique le plafonnement",
    testFile: "tests/alert.test.ts",
    test: `import { it, expect } from "vitest";
import { alert } from "../src/alert";
it("explique le plafonnement", () => expect(alert(12.5, 10)).toBe("Dose plafonnée à 10 U"));
`,
    srcFile: "src/alert.ts",
    src: "export const alert = (dose: number, max: number): string | null => (dose > max ? `Dose plafonnée à ${max} U` : null);\n",
  },
} as const;
type StepId = keyof typeof STEPS;
const stepOf = (prompt: string): StepId => (/Étape en cours : (s\d)/.exec(prompt)?.[1] as StepId | undefined) ?? "s1";

/** Binôme du tour unique : test, run_tests (rouge), code, run_tests (vert), report_phase. */
function pairAgent(root: string, opts: { skipRed?: boolean; probeFreeze?: unknown[] } = {}): ScriptedBehavior {
  return async (t) => {
    const s = STEPS[stepOf(t.prompt)];
    await put(root, s.testFile, s.test);
    if (!opts.skipRed) await t.callTool("run_tests", {});
    if (opts.probeFreeze) opts.probeFreeze.push(await t.config.guard.check({ kind: "write", toolName: "edit", path: s.testFile }));
    await put(root, s.srcFile, s.src);
    await t.callTool("run_tests", {});
    await t.callTool("report_phase", { summary: `cycle ${s.behavior}`, files: [s.testFile, s.srcFile] });
  };
}

/** Rouge puis vert dans les preuves de l'étape, dans cet ordre. */
function redThenGreen(evidence: Evidence[], stepId: string): boolean {
  const own = evidence.filter((e) => e.stepId === stepId && e.phase !== "BASELINE");
  const red = own.findIndex((e) => e.counts.failed > 0);
  return red >= 0 && own.slice(red + 1).some((e) => e.counts.failed === 0 && e.counts.passed > 0 && !e.timedOut);
}

describe.each(HOST_MODES)("Extension tdd — critères de sortie de J3 (extension %s)", (mode) => {
  let root: string;
  let tasksDir: string;

  beforeEach(async () => {
    root = await createProject();
    tasksDir = await mkdtemp(join(tmpdir(), "agent-studio-tasks-"));
  });
  afterEach(async () => {
    await shutdownHosts();
    await rm(root, { recursive: true, force: true });
    await rm(tasksDir, { recursive: true, force: true });
  });

  async function launch(app: Awaited<ReturnType<typeof assemble>>, args: string) {
    await app.registry.command("tdd")!.handler(args);
    await until(async () => (await app.interactions.pending()).length === 1);
    const [review] = await app.interactions.pending();
    await app.interactions.respond(review!.id, "approve");
    const [task] = await app.engine.list();
    return task!.id;
  }

  it("tour unique par défaut : un seul tour par comportement, preuves rouge puis vert, commits test puis feat", async () => {
    const probes: unknown[] = [];
    const runtime = new ScriptedRuntime()
      .behave(ROLE("tdd-planner"), planner([{ id: "s1", behavior: STEPS.s1.behavior }, { id: "s2", behavior: STEPS.s2.behavior }]))
      .behave(ROLE("tdd-pair"), pairAgent(root, { probeFreeze: probes }));
    const app = await assemble(root, runtime, tasksDir, mode);
    const id = await launch(app, "Plafonner la dose proposée");
    await app.engine.idle(id);

    expect(phaseOf(await app.engine.status(id))).toBe("DONE");
    expect(runtime.history.map((s) => runtime.configs.get(s.id)?.role)).toEqual([ROLE("tdd-planner"), ROLE("tdd-pair"), ROLE("tdd-pair")]);

    const evidence = await app.evidence.list(id);
    for (const step of ["s1", "s2"]) expect(redThenGreen(evidence, step)).toBe(true);
    // Les preuves de l'agent viennent de run_tests : produites et enregistrées par le code.
    const s1Agent = evidence.filter((e) => e.stepId === "s1" && e.source === "run_tests");
    expect(s1Agent.map((e) => e.counts.failed > 0)).toEqual([true, false]);
    expect(s1Agent[0]?.failing[0]).toMatchObject({ id: "tests/cap.test.ts", failureKind: "missing_symbol" });
    expect(evidence.some((e) => e.stepId === "s1" && e.source === "gate" && e.phase === "CYCLE_VERIFY" && e.counts.failed === 0)).toBe(true);

    // Gel des tests dans le tour : après le rouge, écrire un test est refusé.
    expect(probes).toEqual([
      { decision: "deny", reason: expect.stringMatching(/gelés/) },
      { decision: "deny", reason: expect.stringMatching(/gelés/) },
    ]);
    expect(git(root, "log", "--format=%s")).toBe(
      [`feat: ${STEPS.s2.behavior}`, `test: ${STEPS.s2.behavior}`, `feat: ${STEPS.s1.behavior}`, `test: ${STEPS.s1.behavior}`, "init"].join("\n"),
    );
    expect(git(root, "show", "--name-only", "--format=", "HEAD~1")).toBe(STEPS.s2.testFile);
  }, 120_000);

  it("tour unique sans rouge dans les preuves : rejeté, l'étape bascule en mode strict et aboutit", async () => {
    const runtime = new ScriptedRuntime()
      .behave(ROLE("tdd-planner"), planner([{ id: "s1", behavior: STEPS.s1.behavior }]))
      .behave(ROLE("tdd-pair"), pairAgent(root, { skipRed: true }))
      .behave(ROLE("tdd-test"), testAgent(root))
      .behave(ROLE("tdd-dev"), devAgent(root));
    const app = await assemble(root, runtime, tasksDir, mode);
    const id = await launch(app, "Plafonner la dose proposée");
    await app.engine.idle(id);

    const rec = await app.engine.status(id);
    expect(phaseOf(rec)).toBe("DONE");
    expect((rec?.state as TddState).reports.map((r) => r.phase)).toEqual(["CYCLE", "RED", "GREEN", "REFACTOR"]);
    const evidence = await app.evidence.list(id);
    expect(redThenGreen(evidence, "s1")).toBe(true);
    expect(evidence.some((e) => e.phase === "RED_VERIFY" && e.counts.failed > 0)).toBe(true);
    expect(evidence.some((e) => e.phase === "GREEN_VERIFY" && e.counts.failed === 0)).toBe(true);
    expect(git(root, "log", "--format=%s", "-2")).toBe([`feat: ${STEPS.s1.behavior}`, `test: ${STEPS.s1.behavior}`].join("\n"));
  }, 120_000);

  it("une escalade survit à un redémarrage et reprend après réponse", async () => {
    // Premier lancement : l'agent test ne produit jamais de test, le budget s'épuise.
    const lazyTest: ScriptedBehavior = async (t) => void (await t.callTool("report_phase", { summary: "rien fait", files: [] }));
    const first = new ScriptedRuntime()
      .behave(ROLE("tdd-planner"), planner([{ id: "s1", behavior: STEPS.s1.behavior }]))
      .behave(ROLE("tdd-test"), lazyTest);
    const app1 = await assemble(root, first, tasksDir, mode);
    const id = await launch(app1, "--strict Plafonner la dose proposée");
    await app1.engine.idle(id);
    expect(phaseOf(await app1.engine.status(id))).toBe("ESCALATED");
    const [escalation] = await app1.interactions.pending();
    expect(escalation).toMatchObject({ taskId: id, title: expect.stringContaining("bloqué"), detail: "Aucun fichier modifié : écris un nouveau test." });
    expect(escalation?.options.map((o) => o.id)).toEqual(["retry", "skip", "abort"]);

    // Redémarrage : nouveaux services, mêmes stockages. La demande est toujours là.
    const second = new ScriptedRuntime().behave(ROLE("tdd-test"), testAgent(root)).behave(ROLE("tdd-dev"), devAgent(root));
    const app2 = await assemble(root, second, tasksDir, mode);
    await app2.engine.resumeAll();
    expect((await app2.engine.status(id))?.status).toBe("waiting");
    const [persisted] = await app2.interactions.pending();
    expect(persisted?.id).toBe(escalation?.id);

    // Réponse après redémarrage : la tâche repart et aboutit.
    await app2.interactions.respond(persisted!.id, "retry");
    await app2.engine.idle(id);
    expect(phaseOf(await app2.engine.status(id))).toBe("DONE");
    expect(await app2.interactions.pending()).toEqual([]);
    expect(redThenGreen(await app2.evidence.list(id), "s1")).toBe(true);
  }, 120_000);
});
