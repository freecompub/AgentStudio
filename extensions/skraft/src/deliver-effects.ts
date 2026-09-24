import { EnvFailureError, matchesAny } from "@agent-studio/extension-api";
import type { ExtensionContext, TestResult } from "@agent-studio/extension-api";
import { buildBrief } from "./brief.js";
import { checkDependencies, checkLint, checkMutation, checkRedGreenSequence, concerns, parseQualityBar, planScenarios } from "./deliver.js";
import { featureScenarios } from "./distill.js";
import type { SkraftEffect, SkraftState } from "./model.js";
import type { Ev } from "./reducer.js";

type Fx<K extends SkraftEffect["kind"]> = Extract<SkraftEffect, { kind: K }>;
interface Run {
  ctx: ExtensionContext;
  state: SkraftState;
  taskId: string;
  signal: AbortSignal;
}

const QUALITY = ".skraft/quality.json";
const fail = (reason: string): Ev => ({ type: "STEP_FAIL", reason });
const firstLine = (msg?: string) => (msg ?? "").split("\n").find((l) => l.trim())?.trim().slice(0, 300) ?? "";
const uniq = (xs: string[]) => [...new Set(xs)];

/** Classement des fichiers selon la disposition de la stack : tests d'acceptance, tests unitaires, production. */
function kinds(ctx: ExtensionContext) {
  const { acceptanceTests, unitTests } = ctx.stack.layout;
  const acceptance = (p: string) => matchesAny(acceptanceTests, p);
  const unit = (p: string) => !acceptance(p) && (matchesAny(unitTests, p) || ctx.stack.isTestFile(p));
  return { acceptance, unit, production: (p: string) => !acceptance(p) && !unit(p) };
}

async function acceptanceFrozen(ctx: ExtensionContext, state: SkraftState): Promise<boolean> {
  const hash = state.deliver?.acceptanceHash || state.acceptanceHash;
  return !hash || (await ctx.workspace.fingerprint(["@stack:acceptanceTests"])) === hash;
}

async function readOr(ctx: ExtensionContext, path: string): Promise<string | null> {
  try {
    return await ctx.workspace.readFile(path);
  } catch {
    return null;
  }
}

/** Début de DELIVER : suite de référence (seuls les tests d'acceptance peuvent être rouges), puis plan des scénarios. */
export async function planDeliver({ ctx, state, taskId, signal }: Run): Promise<Ev> {
  if (!(await acceptanceFrozen(ctx, state))) throw new EnvFailureError("Les tests d'acceptance ont changé depuis DISTILL alors qu'ils sont gelés : restaurez-les avant de relancer.");
  const run = await ctx.stack.runTests({ signal, evidence: { taskId, phase: "DELIVER_BASELINE" } });
  if (run.timedOut) throw new EnvFailureError("Les tests ont dépassé le délai avant le début de DELIVER.");
  const k = kinds(ctx);
  const broken = run.results.filter((r) => r.status === "failed" && !k.acceptance(r.file));
  if (broken.length) throw new EnvFailureError(`La suite est rouge avant DELIVER : ${broken.map((r) => r.id).join(", ")}. Corrigez-la avant de relancer.`);
  const implPlan = (await readOr(ctx, `.skraft/${state.slug}/distill/impl-plan.md`)) ?? "";
  const scenarios = planScenarios({ implPlan, acceptanceTestIds: run.results.filter((r) => k.acceptance(r.file)).map((r) => r.id), regressions: state.regressions });
  return { type: "DELIVER_PLANNED", scenarios, all: run.results.map((r) => r.id), passed: run.results.filter((r) => r.status === "passed").map((r) => r.id) };
}

const STEP_TEXT: Record<Fx<"runDeliverAgent">["step"], (d: { newTest: string | null; unit: string; sources: string }) => string> = {
  test: ({ unit }) =>
    `Pas en cours : écris UN nouveau test unitaire (dans ${unit}) pour le prochain petit comportement du scénario, vérifie avec run_tests qu'il échoue sur une assertion ou un symbole manquant, puis rends la main. N'écris aucun code de production.`,
  dev: ({ newTest, sources }) =>
    `Pas en cours : fais passer le test « ${newTest ?? "?"} » au vert avec le code minimal (dans ${sources}), vérifie avec run_tests, puis nettoie le code sans changer son comportement. Ne modifie aucun test.`,
  green: ({ newTest, sources }) => `Pas en cours : fais passer le test « ${newTest ?? "?"} » au vert avec le code minimal (dans ${sources}), vérifié avec run_tests. Ne modifie aucun test.`,
  refactor: () => "Pas en cours : nettoie le code de production sans changer son comportement ; la suite doit rester verte. Ne modifie aucun test.",
  fix: ({ sources }) =>
    `Pas en cours : corrige les défauts de revue listés dans « Rejet précédent », dans le code de production uniquement (${sources}) ; la suite doit rester verte. Ne modifie aucun test.`,
};

/** Agent test ou dev d'un pas : dossier de passation construit par le code, tests gelés hors de son périmètre. */
export async function runDeliverAgent(e: Fx<"runDeliverAgent">, { ctx, state, taskId, signal }: Run): Promise<Ev> {
  const d = state.deliver!;
  const sc = d.scenarios.find((x) => x.id === e.scenarioId)!;
  const criterion = state.story?.criteria.find((c) => c.n === sc.ac);
  const features = (await ctx.workspace.listFiles()).filter((f) => f.startsWith(`.skraft/${state.slug}/distill/features/`) && f.endsWith(".feature"));
  let gherkin = "";
  for (const f of features) gherkin ||= featureScenarios(await ctx.workspace.readFile(f)).get(sc.ac) ?? "";
  const { unitTests, sources } = ctx.stack.layout;
  const lines = [
    buildBrief(state, "DELIVER", e.feedback),
    `Scénario en cours : ${sc.id}${criterion ? ` (critère ${criterion.n} : ${criterion.text})` : ""}`,
    ...(gherkin ? ["Scénario :", gherkin.trim()] : []),
    `Test d'acceptance à faire passer : ${sc.acceptanceTestId}`,
    ...(d.unitTests.length ? ["Tests unitaires déjà écrits pour ce scénario :", ...d.unitTests.map((t) => `  - ${t}`)] : []),
    STEP_TEXT[e.step]({ newTest: d.newTest, unit: unitTests.join(", "), sources: sources.join(", ") }),
  ];
  const role = e.step === "test" ? "skraft-test" : "skraft-dev";
  const readOnly = e.step === "test" ? ["@stack:acceptanceTests"] : ["@stack:acceptanceTests", "@stack:unitTests"];
  const r = await ctx.agents.run<"report_phase">(role, lines.join("\n"), { signal, readOnly, evidence: { taskId, phase: "DELIVER", stepId: sc.id } });
  if (r.blocker) return { type: "BLOCKER_REPORTED", question: r.blocker.question, choices: r.blocker.choices };
  return { type: "AGENT_REPORTED", role, summary: r.output.summary, files: r.output.files };
}

/** Porte RED d'un pas (SPEC.md §8.3) : un seul nouveau test unitaire, rouge pour une bonne raison, aucun test gelé touché. */
export async function verifyUnitRed(e: Fx<"verifyUnitRed">, { ctx, state, taskId, signal }: Run): Promise<Ev> {
  if (!(await acceptanceFrozen(ctx, state))) return fail("Les tests d'acceptance ont été modifiés : ils sont gelés depuis DISTILL. Le tour est annulé.");
  const k = kinds(ctx);
  const changed = await ctx.workspace.changedFiles(e.since);
  if (changed.length === 0) return fail("Aucun fichier modifié : écris un nouveau test unitaire.");
  const outside = changed.filter((f) => !k.unit(f.path));
  if (outside.length) return fail(`Seuls des tests unitaires peuvent être modifiés à ce pas. Fichiers hors tests unitaires : ${outside.map((f) => f.path).join(", ")}.`);

  const run = await ctx.stack.runTests({ signal, evidence: { taskId, phase: "DELIVER_RED", stepId: e.scenarioId } });
  if (run.timedOut) return fail("Les tests ont dépassé le délai : le nouveau test boucle-t-il ?");
  const known = new Set(e.baseline.all);
  const fresh = run.results.filter((r) => !known.has(r.id) && !k.acceptance(r.file));
  if (fresh.length === 0) return fail("Aucun nouveau test unitaire détecté.");
  if (fresh.length > 1) return fail(`Un seul nouveau test unitaire par pas ; trouvés : ${fresh.map((r) => r.id).join(", ")}.`);
  const t = fresh[0]!;
  if (t.status === "passed") return fail(`Le nouveau test « ${t.id} » passe déjà : le comportement existe ou le test est trop faible.`);
  if (t.status === "skipped") return fail(`Le nouveau test « ${t.id} » est ignoré.`);
  if (t.failureKind === "other_error") return fail(`Le nouveau test échoue pour une mauvaise raison (ni assertion, ni symbole manquant) : ${firstLine(t.message)}`);
  const regressions = run.results.filter((r) => e.baseline.passed.includes(r.id) && r.status === "failed");
  if (regressions.length) return fail(`Des tests qui passaient ne passent plus : ${regressions.map((r) => r.id).join(", ")}.`);

  const unitTestsHash = await ctx.workspace.fingerprint(["@stack:unitTests"]);
  await ctx.git.commit(`test(${state.slug}): ${e.scenarioId}, ${t.id}`);
  const cp = await ctx.workspace.checkpoint(`skraft ${state.slug} : rouge ${e.scenarioId}`);
  return { type: "STEP_OK", checkpointId: cp.id, all: uniq([...e.baseline.all, t.id]), passed: e.baseline.passed, newTest: t.id, unitTestsHash };
}

/** Porte GREEN ou REFACTOR : tests gelés intacts (sinon tour annulé), code de production seul, suite verte hors acceptance en attente. */
export async function verifyUnitGreen(e: Fx<"verifyUnitGreen">, { ctx, state, taskId, signal }: Run): Promise<Ev> {
  if (!(await acceptanceFrozen(ctx, state))) return fail("Les tests d'acceptance ont été modifiés : ils sont gelés depuis DISTILL. Le tour est annulé.");
  if (e.unitTestsHash && (await ctx.workspace.fingerprint(["@stack:unitTests"])) !== e.unitTestsHash)
    return fail("Les tests unitaires ont été modifiés pendant le pas de code : ils sont gelés depuis leur rouge. Le tour est annulé ; modifie uniquement le code de production.");
  const k = kinds(ctx);
  const changed = await ctx.workspace.changedFiles(e.since);
  if (e.mode !== "refactor" && !changed.some((f) => k.production(f.path))) return fail("Aucun fichier de production modifié : écris le code qui fait passer le test.");

  const phase = e.mode === "refactor" ? "DELIVER_REFACTOR" : "DELIVER_GREEN";
  const run = await ctx.stack.runTests({ signal, evidence: { taskId, phase, stepId: e.scenarioId } });
  if (run.timedOut) return fail("Les tests ont dépassé le délai : le code boucle-t-il ?");
  const suite = suiteProblems(run.results, e.pending, k.acceptance);
  if (suite.length) return fail(suite.join(" "));
  if (e.newTest) {
    const own = run.results.filter((r) => concerns(r.id, e.newTest!) || r.file === e.newTest);
    if (own.length === 0) return fail(`Le test du pas est introuvable : ${e.newTest}.`);
    if (own.some((r) => r.status !== "passed")) return fail(`Le test du pas ne passe pas : ${e.newTest}.`);
  }

  const kind = { dev: "feat", green: "feat", refactor: "refactor", fix: "fix" }[e.mode];
  await ctx.git.commit(`${kind}(${state.slug}): ${e.mode === "fix" ? "correction de revue" : e.scenarioId}`);
  const cp = await ctx.workspace.checkpoint(`skraft ${state.slug} : ${e.mode} ${e.scenarioId}`);
  const acceptanceTestId = state.deliver!.scenarios.find((x) => x.id === e.scenarioId)!.acceptanceTestId;
  return {
    type: "STEP_OK",
    checkpointId: cp.id,
    all: uniq([...(state.deliver?.baseline.all ?? []), ...run.results.map((r) => r.id)]),
    passed: run.results.filter((r) => r.status === "passed").map((r) => r.id),
    acceptanceGreen: run.results.some((r) => r.id === acceptanceTestId && r.status === "passed"),
  };
}

/** Suite complète : verte, sauf les tests d'acceptance des scénarios pas encore livrés ; aucun test ignoré. */
function suiteProblems(results: TestResult[], pending: string[], isAcceptance: (p: string) => boolean): string[] {
  const waiting = (r: TestResult) => pending.some((p) => concerns(r.id, p));
  const failing = results.filter((r) => r.status === "failed" && !waiting(r));
  const skipped = results.filter((r) => r.status === "skipped" && !(isAcceptance(r.file) && waiting(r)));
  const out: string[] = [];
  if (failing.length) out.push(`Tests en échec : ${failing.map((r) => `${r.id} (${firstLine(r.message)})`).join("; ")}.`);
  if (skipped.length) out.push(`Tests ignorés (interdit) : ${skipped.map((r) => r.id).join(", ")}.`);
  return out;
}

/** Porte de fin de scénario (§7.4) : acceptance verte, suite verte, séquence des preuves, mutation, dépendances, calisthenics. */
export async function scenarioGate(e: Fx<"scenarioGate">, { ctx, state, taskId, signal }: Run): Promise<Ev> {
  const quality = parseQualityBar(await readOr(ctx, QUALITY));
  if ("error" in quality) throw new EnvFailureError(quality.error);
  const bar = quality.bar;
  const reasons: string[] = [];
  const notes: string[] = [];
  const facts: string[] = [];
  if (!(await acceptanceFrozen(ctx, state))) reasons.push("Les tests d'acceptance ont été modifiés : ils sont gelés depuis DISTILL.");

  const k = kinds(ctx);
  const sc = state.deliver!.scenarios.find((x) => x.id === e.scenarioId)!;
  const run = await ctx.stack.runTests({ signal, evidence: { taskId, phase: "DELIVER_SCENARIO", stepId: e.scenarioId } });
  if (run.timedOut) return { type: "SCENARIO_FAIL", reasons: ["Les tests ont dépassé le délai à la fin du scénario."] };
  const own = run.results.find((r) => r.id === sc.acceptanceTestId);
  if (own?.status !== "passed") reasons.push(`Le test d'acceptance du scénario n'est pas vert : ${sc.acceptanceTestId}.`);
  reasons.push(...suiteProblems(run.results, e.pending, k.acceptance));

  const evidence = (await ctx.evidence.list(taskId)).filter((x) => x.stepId === e.scenarioId);
  reasons.push(...checkRedGreenSequence(evidence, e.unitTests));

  const changed = (await ctx.workspace.changedFiles(e.since)).filter((f) => f.status !== "deleted" && k.production(f.path));
  const sources = changed.map((f) => f.path).filter((p) => matchesAny(ctx.stack.layout.sources, p));
  if (sources.length) {
    const mutation = await ctx.stack.mutation({ signal });
    if (mutation) {
      reasons.push(...checkMutation(mutation, sources, bar));
      for (const f of mutation.files.filter((x) => sources.some((p) => p === x.file || p.endsWith(`/${x.file}`))))
        facts.push(`Mutation (${e.scenarioId}) : ${f.file} à ${f.score} %, ${f.survived.length} mutant(s) survivant(s).`);
    } else notes.push("Mutation non mesurée : la stack du projet ne propose pas d'outil de mutation.");
    // Qualité de forme : le linter du projet, avec ses propres règles. Sans linter, on le dit
    // au lieu de produire un fait — une porte qui n'a rien mesuré n'atteste de rien.
    const lint = await ctx.stack.lint({ files: sources, ...(signal ? { signal } : {}) });
    if (!lint?.available) {
      notes.push("Qualité de forme non mesurée : le projet n'a pas de linter configuré pour cette stack.");
    } else {
      const motifs = checkLint(lint);
      reasons.push(...motifs);
      // Un fichier que le linter a ignoré n'a pas été jugé : n'attester que de ce qu'il a lu.
      const examines = lint.analyzed ?? sources;
      const omis = sources.filter((p) => !examines.includes(p));
      if (motifs.length === 0 && examines.length > 0)
        facts.push(`Lint (${e.scenarioId}) : ${lint.tool ?? "linter du projet"} sans erreur sur ${examines.join(", ")}.`);
      if (omis.length > 0) notes.push(`Qualité de forme non mesurée sur ${omis.join(", ")} : le linter du projet ne les examine pas.`);
    }
  }
  const architecture = await ctx.stack.architecture(bar.dependencyRules);
  if (architecture) {
    const found = checkDependencies(architecture);
    reasons.push(...found);
    if (!found.length) facts.push(`Règle de dépendance respectée : ${bar.dependencyRules.map((r) => `${r.module} n'importe ni ${r.forbidden.join(", ni ")}`).join(" ; ")}.`);
  } else notes.push("Règle de dépendance non vérifiée : la stack du projet ne sait pas analyser les imports.");

  if (reasons.length) return { type: "SCENARIO_FAIL", reasons };
  return { type: "SCENARIO_OK", notes, facts };
}
