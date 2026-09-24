import { randomUUID } from "node:crypto";
import { EnvFailureError, WorkDefectError } from "@agent-studio/extension-api";
import type { AgentRunResult, EffectContext, ExtensionContext, TerminalOutput, TerminalToolName } from "@agent-studio/extension-api";
import { buildBrief } from "./brief.js";
import type { TddEffect, TddState } from "./model.js";
import type { Ev } from "./reducer.js";

const fail = (reason: string): Ev => ({ type: "VERIFY_FAIL", reason });

const DECISION_LABELS: Record<string, string> = {
  retry: "Relancer l'étape",
  skip: "Sauter ce comportement",
  abort: "Abandonner la tâche",
};

/**
 * Exécution des effets de la tâche `tdd-cycle`. Les portes (§8.3) sont exécutées par le code :
 * diff du dépôt, exécution des tests, empreinte des tests gelés. Jamais par un agent (D19, D20).
 */
export async function runTddEffect(effect: TddEffect, ctx: ExtensionContext, ec: EffectContext<TddState>): Promise<Ev | void> {
  const { state, signal, taskId } = ec;
  const stepId = state.steps[state.current]?.id;
  const tag = (phase: string) => ({ taskId, phase, ...(stepId ? { stepId } : {}) });
  switch (effect.kind) {
    case "runPlanner": {
      const prompt = `Fonctionnalité : ${effect.feature}${effect.feedback ? `\n\nTon plan précédent a été refusé : ${effect.feedback}` : ""}`;
      const output = expectOutput(await ctx.agents.run<"submit_plan">("tdd-planner", prompt, { signal, evidence: tag("PLANNING") }));
      return { type: "PLAN_SUBMITTED", steps: output.steps };
    }

    case "askPlanReview":
      await ctx.interactions.request({
        taskId,
        title: `Valider le plan TDD : ${state.feature}`,
        detail: effect.steps.map((s, i) => `${i + 1}. ${s.behavior}`).join("\n"),
        options: [
          { id: "approve", label: "Valider le plan" },
          { id: "reject", label: "Refuser et replanifier" },
        ],
      });
      return;

    case "askHuman":
      await ctx.interactions.request({
        taskId,
        title: `Cycle TDD bloqué : ${state.feature}`,
        detail: effect.reason,
        options: effect.options.map((id) => ({ id, label: DECISION_LABELS[id] ?? id })),
      });
      return;

    case "createCheckpoint": {
      const cp = await ctx.workspace.checkpoint(effect.label);
      const run = await ctx.stack.runTests({ signal, evidence: tag("BASELINE") });
      if (run.timedOut) throw new EnvFailureError("Les tests ont dépassé le délai avant même le début de l'étape.");
      const failing = run.results.filter((r) => r.status === "failed");
      if (failing.length)
        throw new EnvFailureError(`La suite de tests est déjà rouge avant l'étape : ${failing.map((r) => r.id).join(", ")}. Corrigez-la avant de relancer.`);
      return { type: "CHECKPOINT_CREATED", checkpointId: cp.id, baselineTests: run.results.map((r) => r.id) };
    }

    case "runPairAgent": {
      const runId = randomUUID();
      const brief = buildBrief(state, { phase: "CYCLE", ...(effect.feedback ? { feedback: effect.feedback } : {}) });
      const output = expectOutput(await ctx.agents.run<"report_phase">("tdd-pair", brief, {
        signal,
        evidence: tag(`CYCLE:${runId}`),
        freezeTestsAfterRed: true,
      }));
      return { type: "AGENT_DONE", summary: output.summary, files: output.files, runId };
    }

    case "verifyCycle":
      return verifyCycle(ctx, effect, taskId, signal);

    case "runTestAgent": {
      const brief = buildBrief(state, { phase: "RED", ...(effect.feedback ? { feedback: effect.feedback } : {}) });
      const output = expectOutput(await ctx.agents.run<"report_phase">("tdd-test", brief, { signal, evidence: tag("RED") }));
      return { type: "AGENT_DONE", summary: output.summary, files: output.files };
    }

    case "runDevAgent": {
      const phase = effect.mode === "green" ? "GREEN" : "REFACTOR";
      const brief = buildBrief(state, { phase, testIds: effect.testIds, ...(effect.feedback ? { feedback: effect.feedback } : {}) });
      const output = expectOutput(await ctx.agents.run<"report_phase">("tdd-dev", brief, { signal, evidence: tag(phase) }));
      return { type: "AGENT_DONE", summary: output.summary, files: output.files };
    }

    case "verifyRed":
      return verifyRed(ctx, effect, signal, tag("RED_VERIFY"));

    case "verifyGreen":
      return verifyGreen(ctx, effect, state, signal, tag(effect.mode === "green" ? "GREEN_VERIFY" : "REFACTOR_VERIFY"));

    case "rollback":
      await ctx.workspace.rollback(effect.to);
      return;
  }
}

type Tag = { taskId: string; stepId?: string; phase: string };

/** Les rôles de tdd ne déclarent pas report_blocker : un blocage est un défaut de travail. */
function expectOutput<N extends TerminalToolName>(r: AgentRunResult<N>): TerminalOutput<N> {
  if (r.blocker) throw new WorkDefectError(`Blocage inattendu : ${r.blocker.question}`);
  return r.output;
}

async function verifyRed(ctx: ExtensionContext, e: Extract<TddEffect, { kind: "verifyRed" }>, signal: AbortSignal, tag: Tag): Promise<Ev> {
  const changed = await ctx.workspace.changedFiles(e.since);
  if (changed.length === 0) return fail("Aucun fichier modifié : écris un nouveau test.");
  const outside = changed.filter((f) => !ctx.stack.isTestFile(f.path));
  if (outside.length) return fail(`Seuls des fichiers de test peuvent être modifiés en phase rouge. Fichiers hors tests : ${outside.map((f) => f.path).join(", ")}.`);

  const run = await ctx.stack.runTests({ signal, evidence: tag });
  if (run.timedOut) return fail("Les tests ont dépassé le délai : le nouveau test boucle-t-il ?");

  const baseline = new Set(e.baseline);
  // Un test ajouté à un fichier existant qui ne charge plus (symbole manquant) apparaît sous le
  // nom du fichier seul : c'est bien le nouveau test rouge, et ses voisins sont revérifiés au vert.
  const fresh = run.results.filter((r) => !baseline.has(r.id));
  if (fresh.length === 0) return fail("Aucun nouveau test détecté.");
  if (fresh.length > 1) return fail(`Un seul nouveau test par étape ; trouvés : ${fresh.map((r) => r.id).join(", ")}.`);
  const t = fresh[0]!;
  if (t.status === "passed") return fail(`Le nouveau test « ${t.id} » passe déjà : le comportement existe ou le test est trop faible.`);
  if (t.status === "skipped") return fail(`Le nouveau test « ${t.id} » est ignoré (skip ou todo).`);
  if (t.failureKind === "other_error")
    return fail(`Le nouveau test échoue pour une mauvaise raison (ni assertion, ni symbole manquant) : ${firstLine(t.message)}`);

  const regressions = run.results.filter((r) => baseline.has(r.id) && r.status === "failed");
  if (regressions.length) return fail(`Des tests existants ne passent plus : ${regressions.map((r) => r.id).join(", ")}.`);

  const testsHash = await ctx.workspace.fingerprintTests();
  await ctx.git.commit(`test: ${e.step.behavior}`);
  const cp = await ctx.workspace.checkpoint(`Rouge : ${e.step.id}`);
  return { type: "VERIFY_OK", checkpointId: cp.id, newTestIds: [t.id], testsHash };
}

async function verifyGreen(
  ctx: ExtensionContext,
  e: Extract<TddEffect, { kind: "verifyGreen" }>,
  state: TddState,
  signal: AbortSignal,
  tag: Tag,
): Promise<Ev> {
  if ((await ctx.workspace.fingerprintTests()) !== e.testsHash)
    return fail("Les fichiers de test ont été modifiés : c'est interdit à l'agent dev. Les tests sont gelés ; modifie uniquement le code de production.");

  const changed = await ctx.workspace.changedFiles(e.since);
  if (e.mode === "green" && !changed.some((f) => !ctx.stack.isTestFile(f.path)))
    return fail("Aucun fichier de production modifié : écris le code qui fait passer le test.");

  const run = await ctx.stack.runTests({ signal, evidence: tag });
  if (run.timedOut) return fail("Les tests ont dépassé le délai : le code boucle-t-il ?");
  const failing = run.results.filter((r) => r.status === "failed");
  if (failing.length) return fail(`Tests en échec : ${failing.map((r) => `${r.id} (${firstLine(r.message)})`).join("; ")}.`);
  for (const id of state.newTestIds) {
    const own = run.results.filter((r) => r.id === id || r.file === id);
    if (own.length === 0) return fail(`Le test de l'étape est introuvable : ${id}.`);
    if (own.some((r) => r.status !== "passed")) return fail(`Le test de l'étape ne passe pas (ignoré ?) : ${id}.`);
  }

  await ctx.git.commit(e.message);
  const cp = await ctx.workspace.checkpoint(`${e.mode === "green" ? "Vert" : "Nettoyé"} : ${state.steps[state.current]?.id ?? ""}`);
  return { type: "VERIFY_OK", checkpointId: cp.id };
}

/**
 * Porte du tour unique (D22) : la séquence rouge puis vert doit figurer dans les preuves de
 * `run_tests` de ce tour, les tests ne doivent plus avoir changé depuis le rouge, et une
 * exécution finale par le code doit être entièrement verte avec un seul nouveau test.
 */
async function verifyCycle(ctx: ExtensionContext, e: Extract<TddEffect, { kind: "verifyCycle" }>, taskId: string, signal: AbortSignal): Promise<Ev> {
  const changed = await ctx.workspace.changedFiles(e.since);
  const testFiles = changed.filter((f) => ctx.stack.isTestFile(f.path));
  const prodFiles = changed.filter((f) => !ctx.stack.isTestFile(f.path));
  if (testFiles.length === 0) return fail("Aucun test écrit pendant le tour.");
  if (prodFiles.length === 0) return fail("Aucun code de production écrit pendant le tour.");

  const baseline = new Set(e.baseline);
  const evidence = (await ctx.evidence.list(taskId)).filter((x) => x.source === "run_tests" && x.stepId === e.step.id && x.phase === `CYCLE:${e.runId ?? ""}`);
  const redIndex = evidence.findIndex((x) => x.failing.some((f) => !baseline.has(f.id) && (f.failureKind === "assertion" || f.failureKind === "missing_symbol")));
  if (redIndex === -1) return fail("Aucune exécution rouge du nouveau test dans les preuves : le test doit d'abord échouer via run_tests.");
  const red = evidence[redIndex]!;
  const greenAfter = evidence.slice(redIndex + 1).some((x) => !x.timedOut && x.counts.failed === 0 && x.counts.passed > 0);
  if (!greenAfter) return fail("Aucune exécution verte après le rouge dans les preuves : fais passer la suite via run_tests.");

  const testsHash = await ctx.workspace.fingerprintTests();
  if (testsHash !== red.testsHash) return fail("Les tests ont été modifiés après l'exécution rouge : ils devaient rester gelés.");

  const run = await ctx.stack.runTests({ signal, evidence: { taskId, stepId: e.step.id, phase: "CYCLE_VERIFY" } });
  if (run.timedOut) return fail("Les tests ont dépassé le délai lors de la vérification finale.");
  const failing = run.results.filter((r) => r.status === "failed");
  if (failing.length) return fail(`Tests en échec à la vérification finale : ${failing.map((r) => r.id).join(", ")}.`);
  const fresh = run.results.filter((r) => !baseline.has(r.id));
  if (fresh.length === 0) return fail("Aucun nouveau test dans la suite finale.");
  if (fresh.length > 1) return fail(`Un seul nouveau test par comportement ; trouvés : ${fresh.map((r) => r.id).join(", ")}.`);
  if (fresh[0]!.status !== "passed") return fail(`Le nouveau test ne passe pas (ignoré ?) : ${fresh[0]!.id}.`);

  await ctx.git.commit(`test: ${e.step.behavior}`, { paths: testFiles.map((f) => f.path) });
  await ctx.git.commit(`feat: ${e.step.behavior}`);
  const cp = await ctx.workspace.checkpoint(`Vert : ${e.step.id}`);
  return { type: "VERIFY_OK", checkpointId: cp.id, newTestIds: [fresh[0]!.id], testsHash };
}

function firstLine(msg?: string): string {
  return (msg ?? "").split("\n").find((l) => l.trim())?.trim().slice(0, 300) ?? "";
}
