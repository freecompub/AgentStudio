import { coverageForChanges, EnvFailureError, matchesAny } from "@agent-studio/extension-api";
import type { ExtensionContext, TestResult } from "@agent-studio/extension-api";
import { buildBrief, ecrirePassation, fichierDePassation, lignePile } from "./brief.js";
import { SANS_GEL, sansGel } from "./deliver-machine.js";
import { checkCoverage, checkDependencies, checkFormat, checkLint, checkMutation, checkRedGreenSequence, concerns, defaultDependencyRules, lignesSousLeSeuil, mutantsSousLeSeuil, parseQualityBar, planScenarios, sansLignesExemptees, sansTestsObsoletes, type MutantExempte, type MutantSurvivant, type QualityBar } from "./deliver.js";
import { coreFilesMissing } from "@agent-studio/extension-api";
import { acOf, featureScenarios } from "./distill.js";
import { declaredIdentifiers } from "./text-analysis.js";
import type { SkraftEffect, SkraftState } from "./model.js";
import type { Ev } from "./reducer.js";
import type { DefectTarget } from "./review.js";
import { dossiersDesFeatures } from "./gherkin.js";

type Fx<K extends SkraftEffect["kind"]> = Extract<SkraftEffect, { kind: K }>;
interface Run {
  ctx: ExtensionContext;
  state: SkraftState;
  taskId: string;
  signal: AbortSignal;
}

/** Barre de qualité du projet (ADR 0049), et son ancien emplacement relu le temps de la transition. */
export const QUALITY = ".agent-studio/quality.yaml";
export const QUALITY_LEGACY = ".skraft/quality.json";
/** Fichier de projet (ADR 0071) : sa section `qualite` fait foi. */
export const PROJET = ".agent-studio/projet.yaml";
/** `passation.md` est écrit par le code avant chaque tour (07/11) : jamais compté comme une modification de l'agent. */
const horsPassation = <F extends { path: string }>(changes: F[], slug: string): F[] => changes.filter((f) => f.path !== fichierDePassation(slug));
const fail = (reason: string, rouges?: string[]): Ev => ({ type: "STEP_FAIL", reason, ...(rouges?.length ? { rouges } : {}) });

/**
 * Tests de DELIVER, sans ceux que l'humain a déclarés obsolètes (ADR 0066) : aucune porte ne les
 * juge plus jusqu'à la fin du cycle. Les preuves, elles, gardent l'exécution complète.
 */
async function lancerTests(ctx: ExtensionContext, state: SkraftState, opts: Parameters<ExtensionContext["stack"]["runTests"]>[0]) {
  return sansTestsObsoletes(await ctx.stack.runTests(opts), (state.testsObsoletes ?? []).map((x) => x.test));
}
const firstLine = (msg?: string) => (msg ?? "").split("\n").find((l) => l.trim())?.trim().slice(0, 300) ?? "";
const uniq = (xs: string[]) => [...new Set(xs)];

/**
 * Classement des fichiers selon la disposition de la stack : tests d'acceptance, tests unitaires,
 * production. Les globs de `layout` sont des **chemins** : ils classent des fichiers, jamais des
 * résultats de tests — voir `acceptanceResult`.
 */
function kinds(ctx: ExtensionContext) {
  const { acceptanceTests, unitTests } = ctx.stack.layout;
  const acceptance = (p: string) => matchesAny(acceptanceTests, p);
  const unit = (p: string) => !acceptance(p) && (matchesAny(unitTests, p) || ctx.stack.isTestFile(p));
  /**
   * Un RÉSULTAT est d'acceptance s'il porte la marque `ac-<n>` que DISTILL impose dans le nom du
   * test (ADR 0041). Un rapport JUnit rend `file` comme un nom de classe, que les globs de chemins
   * ne reconnaissent jamais : le 03/10, DELIVER a pris les tests rouges de DISTILL pour une suite
   * cassée et refusé de démarrer. Le chemin reste admis pour les lanceurs qui en rendent un.
   */
  const acceptanceResult = (r: TestResult) => acOf(r.id) !== null || acceptance(r.file);
  return { acceptance, acceptanceResult, unit, production: (p: string) => !acceptance(p) && !unit(p) };
}

/**
 * Nature d'un fichier cité par un défaut de revue (ADR 0046) : test, code de production, ou livrable
 * de la tâche. `null` quand le chemin ne relève d'aucun : la cible déclarée par la lentille reste.
 */
export function defectTargetOf(ctx: ExtensionContext): (file: string) => DefectTarget | null {
  const k = kinds(ctx);
  return (file) => {
    if (k.acceptance(file) || k.unit(file)) return "test";
    if (matchesAny(ctx.stack.layout.sources, file)) return "code";
    if (file.startsWith(".skraft/") || file.startsWith("docs/")) return "deliverable";
    return null;
  };
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
  if (sansGel(state)) ctx.chat.post(SANS_GEL);
  if (!(await acceptanceFrozen(ctx, state))) throw new EnvFailureError("Les tests d'acceptance ont changé depuis DISTILL alors qu'ils sont gelés : restaurez-les avant de relancer.");
  const run = await lancerTests(ctx, state, { signal, evidence: { taskId, phase: "DELIVER_BASELINE" } });
  if (run.timedOut) throw new EnvFailureError("Les tests ont dépassé le délai avant le début de DELIVER.");
  const k = kinds(ctx);
  const broken = run.results.filter((r) => r.status === "failed" && !k.acceptanceResult(r));
  if (broken.length) throw new EnvFailureError(`La suite est rouge avant DELIVER : ${broken.map((r) => r.id).join(", ")}. Corrigez-la avant de relancer.`);
  const implPlan = (await readOr(ctx, `.skraft/${state.slug}/distill/impl-plan.md`)) ?? "";
  const scenarios = planScenarios({ implPlan, acceptanceTestIds: run.results.filter(k.acceptanceResult).map((r) => r.id), regressions: state.regressions });
  return { type: "DELIVER_PLANNED", scenarios, all: run.results.map((r) => r.id), passed: run.results.filter((r) => r.status === "passed").map((r) => r.id) };
}

const STEP_TEXT: Record<Fx<"runDeliverAgent">["step"], (d: { newTest: string | null; unit: string; sources: string }) => string> = {
  test: ({ unit }) =>
    `Pas en cours : écris UN nouveau test unitaire (dans ${unit}) pour le prochain petit comportement du scénario, vérifie avec run_tests qu'il échoue sur une assertion ou un symbole manquant, puis rends la main. N'écris aucun code de production.\n` +
    "Si ce comportement est déjà vérifié par le test d'acceptance du scénario et qu'un test unitaire ne ferait que le dupliquer, n'écris rien : rends la main en désignant ce test d'acceptance dans le champ `coveredBy` de report_phase. Le code vérifiera qu'il échoue pour une bonne raison, et le pas suivant le fera passer.",
  dev: ({ newTest, sources }) =>
    `Pas en cours : fais passer le test « ${newTest ?? "?"} » au vert avec le code minimal (dans ${sources}), vérifie avec run_tests, puis nettoie le code sans changer son comportement. Ne modifie aucun test.`,
  green: ({ newTest, sources }) => `Pas en cours : fais passer le test « ${newTest ?? "?"} » au vert avec le code minimal (dans ${sources}), vérifié avec run_tests. Ne modifie aucun test.`,
  refactor: () => "Pas en cours : nettoie le code de production sans changer son comportement ; la suite doit rester verte. Ne modifie aucun test.",
  "fix-test": ({ unit }) =>
    `Pas en cours : correction de revue, côté tests. Pour chaque défaut listé dans « Rejet précédent », ajoute le test demandé (dans ${unit}), ou conteste le défaut avec ta raison. ` +
    "Un test ajouté peut passer d'emblée s'il décrit un comportement que le code a déjà, ou échouer sur une assertion s'il révèle un défaut du code : le développeur le fera passer ensuite. " +
    "Ne modifie un test existant que pour renforcer celui qu'un défaut cite ; sinon, ajoute un test. N'écris aucun code de production. Vérifie avec run_tests.",
  fix: ({ sources }) =>
    `Pas en cours : corrige les défauts de revue listés dans « Rejet précédent », dans le code de production uniquement (${sources}) ; la suite doit rester verte. Ne modifie aucun test. ` +
    "Si un défaut ne doit pas être corrigé selon toi, conteste-le avec ta raison ; s'il est juste mais que sa correction n'est pas de ton ressort (un test à écrire, par exemple), déclare-le `outOfScope`. " +
    "Ne supprime jamais un comportement exigé par le contrat de conception pour faire taire une revue : le code le vérifie, et refuse ce tour.",
};

/** Agent test ou dev d'un pas : dossier de passation construit par le code, tests gelés hors de son périmètre. */
export async function runDeliverAgent(e: Fx<"runDeliverAgent">, { ctx, state, taskId, signal }: Run): Promise<Ev> {
  await ecrirePassation(ctx, state);
  const d = state.deliver!;
  const sc = d.scenarios.find((x) => x.id === e.scenarioId)!;
  const criterion = state.story?.criteria.find((c) => c.n === sc.ac);
  // BDD (ADR 0074) : le Gherkin vit dans les dossiers `features` du projet.
  const dossiers = dossiersDesFeatures(state.slug, ctx.stack.bdd);
  const features = (await ctx.workspace.listFiles()).filter((f) => dossiers.some((d) => f.startsWith(`${d}/`)) && f.endsWith(".feature"));
  let gherkin = "";
  for (const f of features) gherkin ||= featureScenarios(await ctx.workspace.readFile(f)).get(sc.ac) ?? "";
  const { unitTests, sources } = ctx.stack.layout;
  const lines = [
    buildBrief(state, "DELIVER", e.feedback),
    lignePile(ctx.stack.id, ctx.stack.layout),
    `Scénario en cours : ${sc.id}${criterion ? ` (critère ${criterion.n} : ${criterion.text})` : ""}`,
    ...(gherkin ? ["Scénario :", gherkin.trim()] : []),
    `Test d'acceptance à faire passer : ${sc.acceptanceTestId}`,
    ...(d.unitTests.length ? ["Tests unitaires déjà écrits pour ce scénario :", ...d.unitTests.map((t) => `  - ${t}`)] : []),
    STEP_TEXT[e.step]({ newTest: d.newTest, unit: unitTests.join(", "), sources: sources.join(", ") }),
  ];
  const tester = e.step === "test" || e.step === "fix-test";
  const role = tester ? "skraft-test" : "skraft-dev";
  const readOnly = tester ? ["@stack:acceptanceTests"] : ["@stack:acceptanceTests", "@stack:unitTests"];
  const r = await ctx.agents.run<"report_phase">(role, lines.join("\n"), { signal, readOnly, evidence: { taskId, phase: "DELIVER", stepId: sc.id } });
  if (r.blocker) return { type: "BLOCKER_REPORTED", question: r.blocker.question, choices: r.blocker.choices };
  return {
    type: "AGENT_REPORTED",
    role,
    summary: r.output.summary,
    files: r.output.files,
    ...(r.skillsLoaded ? { skills: r.skillsLoaded } : {}),
    ...(e.step === "test" && r.output.coveredBy ? { coveredBy: r.output.coveredBy } : {}),
    ...(r.output.responses?.length ? { responses: r.output.responses } : {}),
    ...(r.output.planDeviations?.length ? { planDeviations: r.output.planDeviations } : {}),
  };
}

/** Porte RED d'un pas (SPEC.md §8.3) : un seul nouveau test unitaire, rouge pour une bonne raison, aucun test gelé touché. */
/**
 * Fichiers de tests existants dont une ligne a été retirée ou remplacée, hors `allowed` : un test
 * affaibli passe toujours, seule la forme du diff le trahit (D10 de docs/12).
 */
function testsRetouches(changed: { path: string; status: string; removed?: number }[], allowed: string[]): string[] {
  return changed.filter((f) => f.status !== "added" && (f.removed ?? 0) > 0 && !allowed.includes(f.path)).map((f) => f.path);
}

export async function verifyUnitRed(e: Fx<"verifyUnitRed">, { ctx, state, taskId, signal }: Run): Promise<Ev> {
  if (!(await acceptanceFrozen(ctx, state))) return fail("Les tests d'acceptance ont été modifiés : ils sont gelés depuis DISTILL. Le tour est annulé.");
  const k = kinds(ctx);
  const changed = horsPassation(await ctx.workspace.changedFiles(e.since), state.slug);
  if (e.coveredBy) return coveredByAcceptance(e, changed.length, { ctx, state, taskId, signal });
  if (changed.length === 0)
    return fail(
      "Aucun fichier modifié : écris un nouveau test unitaire, ou, si le test d'acceptance du scénario vérifie déjà le comportement, désigne-le dans `coveredBy`.",
    );
  const outside = changed.filter((f) => !k.unit(f.path));
  if (outside.length) return fail(`Seuls des tests unitaires peuvent être modifiés à ce pas. Fichiers hors tests unitaires : ${outside.map((f) => f.path).join(", ")}.`);
  const retouches = testsRetouches(changed, []);
  if (retouches.length)
    return fail(
      `À ce pas, un test unitaire existant ne peut recevoir que des ajouts : ${retouches.join(", ")}. Pour renforcer un test, ajoutes-en un plus strict ; ne modifie ni ne retire les tests existants.`,
    );

  const run = await lancerTests(ctx, state, { signal, evidence: { taskId, phase: "DELIVER_RED", stepId: e.scenarioId } });
  if (run.timedOut) return fail("Les tests ont dépassé le délai : le nouveau test boucle-t-il ?");
  const known = new Set(e.baseline.all);
  const fresh = run.results.filter((r) => !known.has(r.id) && !k.acceptanceResult(r));
  if (fresh.length === 0) return fail("Aucun nouveau test unitaire détecté.");
  if (fresh.length > 1) return fail(`Un seul nouveau test unitaire par pas ; trouvés : ${fresh.map((r) => r.id).join(", ")}.`);
  const t = fresh[0]!;
  if (t.status === "passed") return fail(`Le nouveau test « ${t.id} » passe déjà : le comportement existe ou le test est trop faible.`);
  if (t.status === "skipped") return fail(`Le nouveau test « ${t.id} » est ignoré.`);
  if (t.failureKind === "other_error") return fail(`Le nouveau test échoue pour une mauvaise raison (ni assertion, ni symbole manquant) : ${firstLine(t.message)}`);
  const regressions = run.results.filter((r) => e.baseline.passed.includes(r.id) && r.status === "failed");
  if (regressions.length) return fail(`Des tests qui passaient ne passent plus : ${regressions.map((r) => r.id).join(", ")}.`, regressions.map((r) => r.id));

  const unitTestsHash = await ctx.workspace.fingerprint(["@stack:unitTests"]);
  await ctx.git.commit(`test(${state.slug}): ${e.scenarioId}, ${t.id}`);
  const cp = await ctx.workspace.checkpoint(`skraft ${state.slug} : rouge ${e.scenarioId}`);
  return { type: "STEP_OK", checkpointId: cp.id, all: uniq([...e.baseline.all, t.id]), passed: e.baseline.passed, newTest: t.id, unitTestsHash };
}

/** Fichiers de production du projet, concaténés : de quoi chercher un nom du contrat. */
async function sourcesText(ctx: ExtensionContext): Promise<string> {
  const files = (await ctx.workspace.listFiles()).filter((f) => matchesAny(ctx.stack.layout.sources, f));
  const parts: string[] = [];
  for (const f of files) parts.push(await ctx.workspace.readFile(f));
  return parts.join("\n");
}

const present = (text: string, id: string) => new RegExp(`\\b${id}\\b`).test(text);

/**
 * Noms déclarés par le contrat ratifié (`design/contracts.md`, blocs de code) présents dans le code à cet
 * instant : la référence que la garde de correction compare ensuite (ADR 0047). Relevée au moment
 * de la revue, faute de pouvoir relire le code d'un état passé.
 */
export async function contractSymbolsPresent(ctx: ExtensionContext, slug: string): Promise<string[]> {
  let contract: string;
  try {
    contract = await ctx.workspace.readFile(`.skraft/${slug}/design/contracts.md`);
  } catch {
    return [];
  }
  const text = await sourcesText(ctx);
  return declaredIdentifiers(contract).filter((id) => present(text, id));
}

/**
 * Pas « test » sans test unitaire (ADR 0045) : le testeur déclare que le test d'acceptance du
 * scénario vérifie déjà le comportement. Le LLM propose, le code décide : rien ne doit avoir été
 * écrit, le test désigné doit être CELUI du scénario, et il doit échouer pour une bonne raison —
 * c'est lui qui tient lieu de rouge, et le pas de code devra le faire passer.
 */
async function coveredByAcceptance(e: Fx<"verifyUnitRed">, changed: number, { ctx, state, taskId, signal }: Run): Promise<Ev> {
  const sc = state.deliver!.scenarios.find((x) => x.id === e.scenarioId)!;
  if (changed > 0) return fail("Tu as déclaré le comportement couvert par l'acceptance : aucun fichier ne doit alors être modifié. Écris un test unitaire, ou ne déclare rien.");
  if (!concerns(sc.acceptanceTestId, e.coveredBy!))
    return fail(`« ${e.coveredBy} » n'est pas le test d'acceptance du scénario : seul ${sc.acceptanceTestId} peut tenir lieu de test rouge à ce pas.`);
  const run = await lancerTests(ctx, state, { signal, evidence: { taskId, phase: "DELIVER_RED", stepId: e.scenarioId } });
  if (run.timedOut) return fail("Les tests ont dépassé le délai.");
  const own = run.results.find((r) => concerns(r.id, sc.acceptanceTestId));
  if (!own) return fail(`Le test d'acceptance ${sc.acceptanceTestId} est introuvable dans les résultats.`);
  if (own.status === "passed") return fail(`Le test d'acceptance ${sc.acceptanceTestId} est déjà vert : il n'y a plus de comportement à faire passer.`);
  if (own.status !== "failed" || own.failureKind === "other_error")
    return fail(`Le test d'acceptance échoue pour une mauvaise raison (ni assertion, ni symbole manquant) : ${firstLine(own.message)}`);
  const regressions = run.results.filter((r) => e.baseline.passed.includes(r.id) && r.status === "failed");
  if (regressions.length) return fail(`Des tests qui passaient ne passent plus : ${regressions.map((r) => r.id).join(", ")}.`, regressions.map((r) => r.id));
  const unitTestsHash = await ctx.workspace.fingerprint(["@stack:unitTests"]);
  const cp = await ctx.workspace.checkpoint(`skraft ${state.slug} : couvert par l'acceptance ${e.scenarioId}`);
  return { type: "STEP_OK", checkpointId: cp.id, all: e.baseline.all, passed: e.baseline.passed, newTest: sc.acceptanceTestId, unitTestsHash, viaAcceptance: true };
}

/**
 * Porte de la correction côté tests (ADR 0046). Un test réclamé par la revue sur du code existant
 * passe souvent d'emblée — sur US-2, `PalierApplicable` gérait déjà les quatre branches — : exiger
 * un rouge, comme au pas TDD, rendrait la correction impossible. Sont exigés : des tests unitaires
 * seulement, aucun test existant disparu ni cassé, et un rouge éventuel pour une bonne raison. Les
 * rouges deviennent les cibles du développeur. Ne rien écrire est permis : tout a pu être contesté.
 */
export async function verifyFixTests(e: Fx<"verifyFixTests">, { ctx, state, taskId, signal }: Run): Promise<Ev> {
  if (!(await acceptanceFrozen(ctx, state))) return fail("Les tests d'acceptance ont été modifiés : ils sont gelés depuis DISTILL. Le tour est annulé.");
  const k = kinds(ctx);
  const changed = horsPassation(await ctx.workspace.changedFiles(e.since), state.slug);
  const outside = changed.filter((f) => !k.unit(f.path));
  if (outside.length) return fail(`À ce pas, seuls des tests unitaires peuvent être ajoutés. Fichiers hors tests unitaires : ${outside.map((f) => f.path).join(", ")}.`);
  // Renforcer un test existant est permis, s'il est cité par un défaut adressé au testeur (D10 de docs/12).
  const retouches = testsRetouches(changed, e.editable ?? []);
  if (retouches.length)
    return fail(`Un test unitaire existant ne peut recevoir que des ajouts, sauf s'il est cité par un défaut ci-dessus : ${retouches.join(", ")}. Ajoute plutôt un test plus strict.`);
  const run = await lancerTests(ctx, state, { signal, evidence: { taskId, phase: "DELIVER_FIX_TEST", stepId: e.scenarioId } });
  if (run.timedOut) return fail("Les tests ont dépassé le délai : un test ajouté boucle-t-il ?");
  const ids = new Set(run.results.map((r) => r.id));
  const gone = e.baseline.all.filter((id) => !ids.has(id) && !run.results.some((r) => concerns(r.id, id)));
  if (gone.length) return fail(`Des tests existants ont disparu : ${gone.join(", ")}. Ajoute des tests, ne retire ni ne renomme les existants.`);
  const broken = run.results.filter((r) => e.baseline.passed.includes(r.id) && r.status === "failed");
  if (broken.length) return fail(`Des tests qui passaient ne passent plus : ${broken.map((r) => r.id).join(", ")}. Ne modifie pas les tests existants.`, broken.map((r) => r.id));
  const fresh = run.results.filter((r) => !e.baseline.all.includes(r.id) && !k.acceptanceResult(r));
  const skipped = fresh.filter((r) => r.status === "skipped");
  if (skipped.length) return fail(`Tests ajoutés ignorés (interdit) : ${skipped.map((r) => r.id).join(", ")}.`);
  const badRed = fresh.filter((r) => r.status === "failed" && r.failureKind === "other_error");
  if (badRed.length) return fail(`Un test ajouté échoue pour une mauvaise raison (ni assertion, ni symbole manquant) : ${badRed.map((r) => `${r.id} (${firstLine(r.message)})`).join("; ")}.`);
  if (changed.length) await ctx.git.commit(`test(${state.slug}): correction de revue`);
  const cp = await ctx.workspace.checkpoint(`skraft ${state.slug} : correction côté tests ${e.scenarioId}`);
  return {
    type: "STEP_OK",
    checkpointId: cp.id,
    all: uniq([...e.baseline.all, ...run.results.map((r) => r.id)]),
    passed: run.results.filter((r) => r.status === "passed").map((r) => r.id),
    unitTestsHash: await ctx.workspace.fingerprint(["@stack:unitTests"]),
    fixTargets: fresh.filter((r) => r.status === "failed").map((r) => r.id),
  };
}

/** Porte GREEN ou REFACTOR : tests gelés intacts (sinon tour annulé), code de production seul, suite verte hors acceptance en attente. */
export async function verifyUnitGreen(e: Fx<"verifyUnitGreen">, { ctx, state, taskId, signal }: Run): Promise<Ev> {
  if (!(await acceptanceFrozen(ctx, state))) return fail("Les tests d'acceptance ont été modifiés : ils sont gelés depuis DISTILL. Le tour est annulé.");
  if (e.unitTestsHash && (await ctx.workspace.fingerprint(["@stack:unitTests"])) !== e.unitTestsHash)
    return fail("Les tests unitaires ont été modifiés pendant le pas de code : ils sont gelés depuis leur rouge. Le tour est annulé ; modifie uniquement le code de production.");
  const k = kinds(ctx);
  const changed = horsPassation(await ctx.workspace.changedFiles(e.since), state.slug);
  if (e.mode !== "refactor" && !e.nothingToChange && !changed.some((f) => k.production(f.path))) return fail("Aucun fichier de production modifié : écris le code qui fait passer le test.");
  // Garde du contrat ratifié (ADR 0047) : le 03/10, une « correction » de revue a supprimé ce que
  // le contrat de DESIGN exigeait, pour faire taire un défaut de couverture.
  if (e.contractSymbols?.length) {
    const text = await sourcesText(ctx);
    const gone = e.contractSymbols.filter((id) => !present(text, id));
    if (gone.length)
      return fail(
        `Cette correction retire du code des éléments du contrat ratifié (design/contracts.md) : ${gone.join(", ")}. ` +
          "Corrige sans retirer ce que le contrat exige ; si le défaut ne peut pas être corrigé autrement, conteste-le ou déclare-le hors de ton périmètre (`outOfScope`).",
      );
  }

  const phase = e.mode === "refactor" ? "DELIVER_REFACTOR" : "DELIVER_GREEN";
  const run = await lancerTests(ctx, state, { signal, evidence: { taskId, phase, stepId: e.scenarioId } });
  if (run.timedOut) return fail("Les tests ont dépassé le délai : le code boucle-t-il ?");
  const suite = suiteProblems(run.results, e.pending, k.acceptanceResult);
  if (suite.length) return fail(suite.join(" "), rougesDeLaSuite(run.results, e.pending));
  // Un nettoyage ne change pas le comportement : l'acceptance du scénario, verte, le reste (D16 de docs/12).
  const acceptanceTestId = state.deliver!.scenarios.find((x) => x.id === e.scenarioId)!.acceptanceTestId;
  if (e.mode === "refactor" && state.deliver?.acceptanceGreen && run.results.find((r) => r.id === acceptanceTestId)?.status !== "passed")
    return fail(`Le nettoyage a fait passer le test d'acceptance du scénario au rouge (${acceptanceTestId}) : un nettoyage ne change pas le comportement.`);
  if (e.newTest) {
    const own = run.results.filter((r) => concerns(r.id, e.newTest!) || r.file === e.newTest);
    if (own.length === 0) return fail(`Le test du pas est introuvable : ${e.newTest}.`);
    if (own.some((r) => r.status !== "passed")) return fail(`Le test du pas ne passe pas : ${e.newTest}.`);
  }
  // Correction : les tests rouges ajoutés côté tests doivent maintenant passer (ADR 0046).
  for (const t of e.targets ?? []) {
    const own = run.results.filter((r) => concerns(r.id, t));
    if (own.length === 0) return fail(`Le test ajouté par la correction est introuvable : ${t}.`);
    if (own.some((r) => r.status !== "passed")) return fail(`Le test ajouté par la correction ne passe pas : ${t}.`);
  }

  const kind = { dev: "feat", green: "feat", refactor: "refactor", fix: "fix" }[e.mode];
  await ctx.git.commit(`${kind}(${state.slug}): ${e.mode === "fix" ? "correction de revue" : e.scenarioId}`);
  const cp = await ctx.workspace.checkpoint(`skraft ${state.slug} : ${e.mode} ${e.scenarioId}`);
  return {
    type: "STEP_OK",
    checkpointId: cp.id,
    all: uniq([...(state.deliver?.baseline.all ?? []), ...run.results.map((r) => r.id)]),
    passed: run.results.filter((r) => r.status === "passed").map((r) => r.id),
    acceptanceGreen: run.results.some((r) => r.id === acceptanceTestId && r.status === "passed"),
  };
}

/** Tests en échec de la suite, hors acceptance des scénarios pas encore livrés : la cause d'un refus (ADR 0066). */
function rougesDeLaSuite(results: TestResult[], pending: string[]): string[] {
  return results.filter((r) => r.status === "failed" && !pending.some((p) => concerns(r.id, p))).map((r) => r.id);
}

/** Suite complète : verte, sauf les tests d'acceptance des scénarios pas encore livrés ; aucun test ignoré. */
function suiteProblems(results: TestResult[], pending: string[], isAcceptance: (r: TestResult) => boolean): string[] {
  const waiting = (r: TestResult) => pending.some((p) => concerns(r.id, p));
  const failing = results.filter((r) => r.status === "failed" && !waiting(r));
  const skipped = results.filter((r) => r.status === "skipped" && !(isAcceptance(r) && waiting(r)));
  const out: string[] = [];
  if (failing.length) out.push(`Tests en échec : ${failing.map((r) => `${r.id} (${firstLine(r.message)})`).join("; ")}.`);
  if (skipped.length) out.push(`Tests ignorés (interdit) : ${skipped.map((r) => r.id).join(", ")}.`);
  return out;
}

/**
 * Barre de qualité du projet (ADR 0049), avec ce qu'il faut en dire : lue à l'ancien emplacement, ou
 * un cœur déclaré qui ne correspond à aucun fichier — le seuil du reste s'appliquerait en silence.
 * Une barre invalide est une panne d'environnement : la juger à moitié serait attester à tort.
 */
export async function loadQualityBar(ctx: ExtensionContext): Promise<{ bar: QualityBar; notes: string[] }> {
  const q = parseQualityBar({ projet: await readOr(ctx, PROJET), yaml: await readOr(ctx, QUALITY), legacyJson: await readOr(ctx, QUALITY_LEGACY) });
  if ("error" in q) throw new EnvFailureError(q.error);
  const sources = (await ctx.workspace.listFiles()).filter((f) => matchesAny(ctx.stack.layout.sources, f));
  // Seules les couches déclarées : un projet sans couche « application », et qui n'a rien déclaré,
  // n'a rien de suspect.
  const vides = coreFilesMissing(q.bar, sources, q.declaredCore).map(
    (c) => `Barre de qualité : la couche « ${c} » du cœur ne correspond à aucun fichier du projet ; ses seuils ne s'appliquent à rien (${q.source}).`,
  );
  return { bar: q.bar, notes: [...q.warnings, ...vides] };
}

/** Mutation des fichiers de production donnés, jugée contre la barre : motifs de rejet, faits, notes. */
async function mutate(
  ctx: ExtensionContext,
  bar: QualityBar,
  sources: string[],
  label: string,
  signal?: AbortSignal,
  derogations: readonly MutantExempte[] = [],
): Promise<{ reasons: string[]; mutants: MutantSurvivant[]; facts: string[]; notes: string[] }> {
  const mutation = await ctx.stack.mutation({ ...(signal ? { signal } : {}) });
  if (!mutation) return { reasons: [], mutants: [], facts: [], notes: ["Mutation non mesurée : la stack du projet ne propose pas d'outil de mutation."] };
  const facts = mutation.files
    .filter((x) => sources.some((p) => p === x.file || p.endsWith(`/${x.file}`)))
    .map((f) => `Mutation (${label}) : ${f.file} à ${f.score} %, ${f.survived.length} mutant(s) survivant(s).`);
  return { reasons: checkMutation(mutation, sources, bar, derogations), mutants: mutantsSousLeSeuil(mutation, sources, bar, derogations), facts, notes: [] };
}

/**
 * Mutation de fin de DELIVER (ADR 0049, moment par défaut) : une seule exécution sur tous les
 * fichiers de production modifiés depuis le début de la phase. Un outil comme Stryker relance la
 * suite pour chaque mutant : par scénario, ce serait une exécution complète à chaque fois.
 */
export async function phaseEndMutation(
  ctx: ExtensionContext,
  state: SkraftState,
  signal?: AbortSignal,
): Promise<{ reasons: string[]; mutants: MutantSurvivant[]; facts: string[]; notes: string[] }> {
  const { bar, notes } = await loadQualityBar(ctx);
  if (!bar.mutation.active) return { reasons: [], mutants: [], facts: [], notes: [...notes, "Mutation désactivée par la barre de qualité du projet."] };
  if (bar.mutation.moment !== "phase-end") return { reasons: [], mutants: [], facts: [], notes };
  const cp = state.checkpoints.DELIVER;
  if (!cp) return { reasons: [], mutants: [], facts: [], notes };
  const k = kinds(ctx);
  const sources = (await ctx.workspace.changedFiles(cp))
    .filter((f) => f.status !== "deleted" && k.production(f.path) && matchesAny(ctx.stack.layout.sources, f.path))
    .map((f) => f.path);
  if (sources.length === 0) return { reasons: [], mutants: [], facts: [], notes };
  // Les mutants reconnus équivalents par arbitrage sortent du score (ADR 0065).
  const r = await mutate(ctx, bar, sources, "fin de DELIVER", signal, state.derogations ?? []);
  return { reasons: r.reasons, mutants: r.mutants, facts: r.facts, notes: [...notes, ...r.notes] };
}

/** Porte de fin de scénario (§7.4) : acceptance verte, suite verte, séquence des preuves, mutation, dépendances, calisthenics. */
export async function scenarioGate(e: Fx<"scenarioGate">, { ctx, state, taskId, signal }: Run): Promise<Ev> {
  const { bar, notes: barNotes } = await loadQualityBar(ctx);
  const reasons: string[] = [];
  const notes: string[] = [...barNotes];
  const facts: string[] = [];
  if (!(await acceptanceFrozen(ctx, state))) reasons.push("Les tests d'acceptance ont été modifiés : ils sont gelés depuis DISTILL.");

  const k = kinds(ctx);
  const sc = state.deliver!.scenarios.find((x) => x.id === e.scenarioId)!;
  const run = await lancerTests(ctx, state, { signal, evidence: { taskId, phase: "DELIVER_SCENARIO", stepId: e.scenarioId } });
  if (run.timedOut) return { type: "SCENARIO_FAIL", reasons: ["Les tests ont dépassé le délai à la fin du scénario."] };
  const own = run.results.find((r) => r.id === sc.acceptanceTestId);
  if (own?.status !== "passed") reasons.push(`Le test d'acceptance du scénario n'est pas vert : ${sc.acceptanceTestId}.`);
  reasons.push(...suiteProblems(run.results, e.pending, k.acceptanceResult));
  // Cause du refus, si refus il y a (ADR 0066) : tests rouges de la suite, lignes non couvertes.
  const rouges = rougesDeLaSuite(run.results, e.pending);
  const lignes: { file: string; lines: number[] }[] = [];

  const evidence = (await ctx.evidence.list(taskId)).filter((x) => x.stepId === e.scenarioId);
  reasons.push(...checkRedGreenSequence(evidence, e.unitTests));

  const changed = (await ctx.workspace.changedFiles(e.since)).filter((f) => f.status !== "deleted" && k.production(f.path));
  const sources = changed.map((f) => f.path).filter((p) => matchesAny(ctx.stack.layout.sources, p));
  if (sources.length) {
    // Mutation par scénario seulement si la barre le demande (ADR 0049) ; par défaut, une seule
    // exécution en fin de DELIVER (`phaseEndMutation`). Désactivée : on le dit aux lentilles.
    if (!bar.mutation.active) notes.push("Mutation désactivée par la barre de qualité du projet.");
    else if (bar.mutation.moment === "scenario") {
      const m = await mutate(ctx, bar, sources, e.scenarioId, signal, state.derogations ?? []);
      reasons.push(...m.reasons);
      facts.push(...m.facts);
      notes.push(...m.notes);
    }

    // Couverture : plancher de la mutation, produite par la même exécution de la suite. Sans
    // rapport, on le DIT — c'est ce que la lentille `quality-gates` croyait acquis alors qu'aucun
    // fait n'était jamais produit.
    if (run.coverage) {
      // Lignes exemptées par l'humain (ADR 0065, et à l'escalade d'un scénario, ADR 0066) : hors du calcul.
      const diff = coverageForChanges(run.coverage, sansLignesExemptees(changed.filter((f) => sources.includes(f.path)), state.derogationsCouverture ?? []));
      notes.push(...diff.notes);
      const couverture = checkCoverage(diff.report, sources, bar, true);
      reasons.push(...couverture);
      if (couverture.length) lignes.push(...lignesSousLeSeuil(diff.report, sources, bar));
      for (const f of diff.report.files)
        facts.push(`Couverture du diff (${e.scenarioId}) : ${f.file} à ${Math.round(f.score * 10) / 10} %, ${f.covered} ligne(s) sur ${f.total}.`);
    } else notes.push("Couverture non mesurée : la commande de test du projet n'en produit pas.");
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
    // Format (ADR 0071) : la commande de la pile, à côté du lint ; un écart revient au développeur.
    const format = checkFormat(await ctx.stack.format({ files: sources, ...(signal ? { signal } : {}) }), e.scenarioId);
    reasons.push(...format.motifs);
    facts.push(...format.faits);
    notes.push(...format.notes);
  }
  // Les règles du projet l'emportent ; à défaut, celles que la stack déduit de son écosystème.
  const regles = bar.dependencyRules.length ? bar.dependencyRules : defaultDependencyRules(ctx.stack.infrastructureModules);
  if (regles.length === 0) {
    notes.push("Règle de dépendance non vérifiée : aucune règle déclarée, et la stack du projet n'en propose pas.");
  } else {
    const architecture = await ctx.stack.architecture(regles);
    if (architecture) {
      const found = checkDependencies(architecture);
      reasons.push(...found);
      if (!found.length) facts.push(`Règle de dépendance respectée : ${regles.map((r) => `${r.module} n'importe ni ${r.forbidden.join(", ni ")}`).join(" ; ")}.`);
    } else notes.push("Règle de dépendance non vérifiée : la stack du projet ne sait pas analyser les imports.");
  }

  if (reasons.length) return { type: "SCENARIO_FAIL", reasons, ...(rouges.length ? { rouges } : {}), ...(lignes.length ? { lignes } : {}) };
  return { type: "SCENARIO_OK", notes, facts };
}
