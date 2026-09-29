import { createHash, randomUUID } from "node:crypto";
import { EnvFailureError, WorkDefectError } from "@agent-studio/extension-api";
import type { AgentRunResult, EffectContext, ExtensionContext, TerminalOutput, TerminalToolName } from "@agent-studio/extension-api";
import { buildBrief } from "./brief.js";
import { computeIndicators, type Difficulty, type RepositoryShape } from "./difficulty.js";
import type { ArtifactRecord, Phase, SkraftEffect, SkraftState } from "./model.js";
import type { Ev } from "./reducer.js";
import { preselectFiles } from "./preselect.js";
import { checkResearch } from "./research.js";
import { parseAdr, setAdrStatus } from "./adr.js";
import { checkDesign } from "./design.js";
import { checkAcceptanceRed, checkValues } from "./distill.js";
import { checkGherkin } from "./gherkin.js";
import { matchesAny } from "@agent-studio/extension-api";
import { SUPERSESSIONS } from "./render-adr-tool.js";
import { latestArtifacts, lensBrief, reviewFacts, type LensFiles } from "./review-brief.js";
import { reviewReport } from "./review.js";
import type { LensName } from "./difficulty.js";
import { parseStory, slugOf } from "./story.js";
import { planDeliver, runDeliverAgent, scenarioGate, verifyUnitGreen, verifyUnitRed } from "./deliver-effects.js";

const LEVEL_LABELS: Record<Difficulty, string> = {
  simple: "Simple",
  medium: "Moyenne",
  "medium-hard": "Assez difficile",
  challenging: "Difficile",
};

const expectOutput = <N extends TerminalToolName>(r: AgentRunResult<N>): TerminalOutput<N> => {
  if (r.blocker) throw new WorkDefectError(`Blocage inattendu : ${r.blocker.question}`);
  return r.output;
};

/** Forme du dépôt pour les indicateurs de difficulté : modules = dossiers de `Sources/`, `src/` ou `packages/`. */
export function repositoryShape(files: string[]): RepositoryShape {
  const modules = new Map<string, Set<string>>();
  for (const f of files) {
    const m = /^(?:Sources|src|packages)\/([^/]+)\//.exec(f);
    if (!m) continue;
    const words = modules.get(m[1]!) ?? new Set<string>();
    const base = f.split("/").at(-1)!.replace(/\.[^.]+$/, "");
    for (const w of base.split(/(?=[A-Z])|[-_]/)) if (w.length > 3) words.add(w.toLowerCase());
    modules.set(m[1]!, words);
  }
  return { modules: [...modules.keys()], files, keywords: Object.fromEntries([...modules].map(([k, v]) => [k, [...v]])) };
}

async function sha256(ctx: ExtensionContext, path: string): Promise<string> {
  return createHash("sha256").update(await ctx.workspace.readFile(path)).digest("hex");
}

/**
 * Effets du pipeline skraft, exécutés uniquement via `ctx` (aucun accès direct au disque, à Git ni au
 * SDK). Les portes par phase (citations, cohérence, valeurs, RED d'acceptance, fin de scénario)
 * s'ajoutent aux jalons S2 à S5 ; en S1, la porte vérifie les livrables produits.
 */
export async function runSkraftEffect(effect: SkraftEffect, ctx: ExtensionContext, ec: EffectContext<SkraftState>): Promise<Ev | void> {
  const { state, taskId, signal } = ec;
  const tag = (phase: string) => ({ taskId, phase });

  switch (effect.kind) {
    case "init": {
      let raw: string;
      try {
        raw = await ctx.workspace.readFile(effect.storyPath);
      } catch {
        return { type: "INIT_FAILED", reasons: [`Story introuvable : ${effect.storyPath}`] };
      }
      const parsed = parseStory(raw);
      if (!parsed.ok) return { type: "INIT_FAILED", reasons: parsed.errors };
      const slug = slugOf(parsed.story.id);
      const branch = `skraft/${slug}`;
      const baseSha = await ctx.git.head();
      await ctx.git.branch(branch);
      // L'arborescence est créée ICI, une fois pour toutes (ADR 0037) : la trace du 29/09 montrait
      // le chercheur tenter deux `mkdir -p` avant d'écrire — réflexe juste sous shell, et sans
      // objet ici. Le code prépare, l'agent n'a plus à y penser.
      for (const d of dossiersDeLaStory(slug)) await ctx.workspace.ensureDir(d);
      const indicators = computeIndicators(parsed.story, repositoryShape(await ctx.workspace.listFiles()));
      return { type: "INITIALIZED", slug, story: parsed.story, baseSha, branch, indicators };
    }

    case "classify": {
      const prompt = [
        `Story : ${state.story?.id} — ${state.story?.title}`,
        `Indicateurs : ${JSON.stringify(effect.indicators)}`,
        `Niveau proposé par la grille : ${effect.proposed}`,
      ].join("\n");
      const out = expectOutput(await ctx.agents.run<"submit_difficulty">("skraft-classifier", prompt, { signal, evidence: tag("CLASSIFY") }));
      return { type: "DIFFICULTY_PROPOSED", level: out.level, justification: out.justification };
    }

    case "askDifficulty":
      await ctx.interactions.request({
        taskId,
        title: `Difficulté de ${state.story?.id ?? "la story"} : ${LEVEL_LABELS[effect.proposed]} ?`,
        detail: effect.justification,
        options: effect.options.map((l) => ({ id: l, label: l === effect.proposed ? `Confirmer : ${LEVEL_LABELS[l]}` : LEVEL_LABELS[l] })),
      });
      return;

    case "checkpointPhase": {
      const cp = await ctx.workspace.checkpoint(`skraft ${state.slug} : début de ${effect.phase}`);
      return { type: "PHASE_CHECKPOINTED", phase: effect.phase, checkpointId: cp.id };
    }

    case "runSpecialist": {
      let brief = buildBrief(state, effect.phase, effect.feedback);
      if (effect.phase === "RESEARCH" && state.story) {
        // Présélection par le code (§7.1) : placée dans le dossier de passation.
        const files = await ctx.workspace.listFiles();
        const selected = preselectFiles(state.story, files);
        if (selected.length) brief += `\nFichiers utiles (présélection) :\n${selected.map((f) => `  - ${f}`).join("\n")}`;
      }
      if (effect.phase === "DISTILL") brief += `\nTests d'acceptance à écrire dans : ${ctx.stack.layout.acceptanceTests.join(", ")}`;
      const r = await ctx.agents.run<"report_phase">(effect.role, brief, { signal, readOnly: [...GELÉS], evidence: tag(effect.phase) });
      if (r.blocker) return { type: "BLOCKER_REPORTED", question: r.blocker.question, choices: r.blocker.choices };
      return { type: "AGENT_REPORTED", role: effect.role, summary: r.output.summary, files: r.output.files, ...(r.skillsLoaded ? { skills: r.skillsLoaded } : {}) };
    }

    case "runGate":
      return runGate(ctx, state, effect.phase, effect.attempt, signal, taskId);

    case "runReview": {
      // Faits établis par le code et fichiers de la phase (§9.1, §9.2) ; une session neuve par lentille, en parallèle.
      const facts = reviewFacts(state, effect.phase, await ctx.evidence.list(taskId));
      const files = await phaseFiles(ctx, state, effect.phase);
      const verdicts = await Promise.all(
        effect.lenses.map(async (lens: LensName) =>
          expectOutput(
            await ctx.agents.run<"submit_lens_verdict">(`skraft-lens-${lens}`, lensBrief(lens, state, effect.phase, files, facts), { signal, evidence: tag("REVIEW") }),
          ),
        ),
      );
      const reportPath = await writeReview(ctx, state.slug, effect.phase, effect.attempt, verdicts);
      return { type: "LENSES_DONE", lenses: verdicts, reportPath };
    }

    case "askRatification":
      await ctx.interactions.request({
        taskId,
        title: `Ratifier ${effect.adr.id}`,
        detail: `Décision d'architecture proposée : ${effect.adr.path}`,
        options: [
          { id: `accept:${effect.adr.id}`, label: "Accepter" },
          { id: `reject:${effect.adr.id}`, label: "Rejeter" },
          { id: `amend:${effect.adr.id}`, label: "Demander un amendement" },
        ],
        requiredRoles: ["architecte"],
      });
      return;

    case "applyAdrStatuses":
      for (const a of effect.adrs) await ctx.workspace.writeFile(a.path, setAdrStatus(await ctx.workspace.readFile(a.path), a.status));
      return;

    case "askBlocker":
      await ctx.interactions.request({
        taskId,
        title: `Question de l'agent (${state.phase ?? "skraft"})`,
        detail: effect.question,
        options: (effect.choices.length ? effect.choices : ["Répondre"]).map((c) => ({ id: c, label: c })),
        requiredRoles: ["po", "developpeur", "architecte", "administrateur"],
      });
      return;

    case "askQuestion":
      await ctx.interactions.request({
        taskId,
        title: `Question ouverte (${state.story?.id ?? "skraft"})`,
        detail: effect.text,
        options: [
          { id: `answer:${effect.id}`, label: "Répondre" },
          { id: `defer:${effect.id}`, label: "Reporter" },
        ],
        freeText: true,
        requiredRoles: ["po", "developpeur", "architecte", "administrateur"],
      });
      return;

    case "askEscalation":
      await ctx.interactions.request({
        taskId,
        title: `Pipeline skraft bloqué (${state.phase ?? state.stage})`,
        detail: effect.reason,
        options: effect.options.map((id) => ({ id, label: { retry: "Relancer la phase", skip: "Sauter la phase", abort: "Abandonner" }[id] })),
        requiredRoles: ["developpeur", "architecte", "administrateur"],
      });
      return;

    case "rollback": {
      // Archiver AVANT (ADR 0038) : le rollback efface le livrable en même temps que le verdict qui
      // le condamne, et on ne peut plus examiner ce qu'un agent a produit au moment précis où on
      // voudrait le lire. La trace raconte ; elle n'atteste rien.
      const étiquette = `${state.phase ?? "?"} essai ${state.attempts}`;
      const àArchiver = await ctx.workspace.changedFiles(effect.to).catch(() => []);
      const livrables = await Promise.all(
        àArchiver
          .filter((f) => f.status !== "deleted")
          .map(async (f) => ({ path: f.path, content: await ctx.workspace.readFile(f.path).catch(() => "") })),
      );
      if (livrables.length) await ctx.trace.rejected(taskId, étiquette, livrables);
      await ctx.workspace.rollback(effect.to);
      // `git clean -fd` emporte les dossiers non suivis, et Git ne suit jamais un dossier vide :
      // l'arborescence créée à l'initialisation disparaît au PREMIER rejet, et l'essai suivant
      // retombe dans l'impasse qui a bloqué RESEARCH pendant trois runs. On la recrée donc ici.
      for (const d of dossiersDeLaStory(state.slug)) await ctx.workspace.ensureDir(d);
      return;
    }

    case "commitPhase":
      // Rapports de revue réécrits depuis l'état (un rollback de réessai a pu les effacer) : reproductibles.
      for (const r of state.reviews[effect.phase]) await writeReview(ctx, state.slug, effect.phase, r.attempt, r.lenses);
      return { type: "COMMITTED", sha: await ctx.git.commit(effect.message) };

    case "finalReport":
      ctx.chat.post(finalReport(state));
      return;

    case "planDeliver":
      return planDeliver({ ctx, state, taskId, signal });
    case "startScenario": {
      const cp = await ctx.workspace.checkpoint(`skraft ${state.slug} : scénario ${effect.scenarioId}`);
      return { type: "SCENARIO_STARTED", checkpointId: cp.id };
    }
    case "runDeliverAgent":
      return runDeliverAgent(effect, { ctx, state, taskId, signal });
    case "verifyUnitRed":
      return verifyUnitRed(effect, { ctx, state, taskId, signal });
    case "verifyUnitGreen":
      return verifyUnitGreen(effect, { ctx, state, taskId, signal });
    case "scenarioGate":
      return scenarioGate(effect, { ctx, state, taskId, signal });
  }
}

/** Porte minimale S1 : au moins un livrable produit dans la phase, empreintes enregistrées. */
async function runGate(ctx: ExtensionContext, state: SkraftState, phase: Phase, attempt: number, signal: AbortSignal, taskId: string): Promise<Ev> {
  if (phase === "RESEARCH") return researchGate(ctx, state, attempt);
  if (phase === "DESIGN") return designGate(ctx, state, attempt);
  if (phase === "DISTILL") return distillGate(ctx, state, attempt, signal, taskId);
  const cp = state.checkpoints[phase];
  if (!cp) throw new EnvFailureError(`Point de retour de la phase ${phase} introuvable`);
  const changed = (await ctx.workspace.changedFiles(cp)).filter((f) => f.status !== "deleted");
  if (changed.length === 0) return { type: "GATE_FAIL", gate: "livrables", reasons: [`Aucun livrable produit pendant la phase ${phase}.`] };
  const producedBy = phase;
  const artifacts: ArtifactRecord[] = [];
  for (const f of changed) artifacts.push({ path: f.path, sha256: await sha256(ctx, f.path), producedBy, attempt });
  return { type: "GATE_OK", artifacts };
}

/**
 * Fichiers qu'aucun agent n'écrit, quel que soit son périmètre.
 *
 * `.skraft/quality.json` porte la **barre de qualité** — seuils de couverture, score de mutation,
 * règles de dépendance — que la porte de livraison lit pour juger le travail. Le périmètre
 * d'écriture des rôles est `.skraft/**`, qui l'incluait : un agent pouvait abaisser le critère sur
 * lequel il allait être jugé, et la porte l'aurait validé en toute bonne foi. C'est le contraire du
 * principe du projet — le LLM propose, le code décide et vérifie.
 */
export const GELÉS = [".skraft/quality.json"] as const;

/**
 * Dossiers où les agents et le code déposent les livrables d'une story (ADR 0037).
 *
 * Créés à l'initialisation. Les tenir ici, en un seul endroit, évite que la liste diverge de ce que
 * les portes attendent — `checkDesign` lit `design/`, la porte citations lit `research/`.
 */
export const dossiersDeLaStory = (slug: string): string[] => [
  `.skraft/${slug}/research`,
  `.skraft/${slug}/design`,
  `.skraft/${slug}/distill/features`,
  `.skraft/${slug}/reviews`,
];

/** Porte citations (§7.1) : document au gabarit, citations vérifiées sur le dépôt, questions ouvertes. */
async function researchGate(ctx: ExtensionContext, state: SkraftState, attempt: number): Promise<Ev> {
  const path = `.skraft/${state.slug}/research/research.md`;
  let md: string;
  try {
    md = await ctx.workspace.readFile(path);
  } catch {
    return { type: "GATE_FAIL", gate: "citations", reasons: [`Document de recherche absent : ${path}`] };
  }
  const files = new Set(await ctx.workspace.listFiles());
  const lines = new Map<string, number>();
  for (const cited of new Set([...md.matchAll(/[\w./-]+\.[A-Za-z][A-Za-z0-9]{0,9}/g)].map((m) => m[0]))) {
    if (files.has(cited)) lines.set(cited, (await ctx.workspace.readFile(cited)).replace(/\n$/, "").split("\n").length);
  }
  const { reasons, openQuestions } = checkResearch(md, { lineCount: (p) => lines.get(p) ?? null });
  if (reasons.length) return { type: "GATE_FAIL", gate: "citations", reasons };
  const known = new Set(state.openQuestions.map((q) => q.text));
  return {
    type: "GATE_OK",
    artifacts: [{ path, sha256: createHash("sha256").update(md).digest("hex"), producedBy: "skraft-researcher", attempt }],
    openQuestions: openQuestions.filter((q) => !known.has(q)),
  };
}

const ADR_FILE = /^docs\/adr\/adr-\d{3,}-[^/]+\.md$/;
const DESIGN_DOCS = ["event-model.md", "domain-model.md", "context-map.md", "contracts.md", "diagrams.md", "consistency-matrix.md"];

/** Porte cohérence (§7.2) : documents de conception et ADR de la phase, vérifiés par le code. */
async function designGate(ctx: ExtensionContext, state: SkraftState, attempt: number): Promise<Ev> {
  const cp = state.checkpoints.DESIGN;
  if (!cp) throw new EnvFailureError("Point de retour de la phase DESIGN introuvable");
  const dir = `.skraft/${state.slug}/design`;
  const docs: Record<string, string> = {};
  for (const d of DESIGN_DOCS) {
    try {
      docs[d] = await ctx.workspace.readFile(`${dir}/${d}`);
    } catch {
      // document absent : la porte le signale s'il est requis
    }
  }
  const changed = await ctx.workspace.changedFiles(cp);
  const added = new Set(changed.filter((f) => f.status === "added").map((f) => f.path));
  const modifiedExistingAdrs = changed.filter((f) => f.status !== "added" && ADR_FILE.test(f.path)).map((f) => f.path);
  const adrPaths = (await ctx.workspace.listFiles()).filter((p) => ADR_FILE.test(p));
  const adrs = await Promise.all(adrPaths.map(async (path) => ({ path, md: await ctx.workspace.readFile(path), isNew: added.has(path) })));
  let supersessions = "";
  try {
    supersessions = await ctx.workspace.readFile(SUPERSESSIONS);
  } catch {
    supersessions = "";
  }
  const reasons = checkDesign({ docs, adrs, supersessions, modifiedExistingAdrs });
  if (reasons.length) return { type: "GATE_FAIL", gate: "cohérence", reasons };
  const artifacts: ArtifactRecord[] = [];
  for (const f of changed.filter((c) => c.status !== "deleted"))
    artifacts.push({ path: f.path, sha256: await sha256(ctx, f.path), producedBy: ADR_FILE.test(f.path) ? "render_adr" : "skraft-architect", attempt });
  return {
    type: "GATE_OK",
    artifacts,
    adrs: adrs.filter((a) => a.isNew).map((a) => ({ id: parseAdr(a.md).id, path: a.path, status: "Proposed" as const })),
  };
}

/** Porte valeurs puis porte RED d'acceptance (§7.3) ; à la sortie, gel des tests d'acceptance. */
async function distillGate(ctx: ExtensionContext, state: SkraftState, attempt: number, signal: AbortSignal, taskId: string): Promise<Ev> {
  const dir = `.skraft/${state.slug}/distill`;
  const files = await ctx.workspace.listFiles();
  const read = async (paths: string[]) => Promise.all(paths.map(async (path) => ({ path, content: await ctx.workspace.readFile(path) })));
  const features = await read(files.filter((f) => f.startsWith(`${dir}/features/`) && f.endsWith(".feature")));
  const acceptanceGlobs = ctx.stack.layout.acceptanceTests;
  const acceptanceTests = await read(files.filter((f) => matchesAny(acceptanceGlobs, f)));
  const criteria = state.story?.criteria ?? [];

  // Porte `gherkin` AVANT la porte `valeurs` : un scénario couplé à un détail technique doit être
  // refusé même s'il contient les bonnes valeurs, et surtout avant le gel des tests d'acceptance —
  // passé ce point, plus personne ne peut le réécrire.
  const gherkinReasons = checkGherkin(features);
  if (gherkinReasons.length) return { type: "GATE_FAIL", gate: "gherkin", reasons: gherkinReasons };

  const valueReasons = checkValues({ criteria, features, acceptanceTests });
  if (valueReasons.length) return { type: "GATE_FAIL", gate: "valeurs", reasons: valueReasons };

  let testPlan = "";
  try {
    testPlan = await ctx.workspace.readFile(`${dir}/test-plan.md`);
  } catch {
    return { type: "GATE_FAIL", gate: "valeurs", reasons: [`Plan de test absent : ${dir}/test-plan.md`] };
  }
  const run = await ctx.stack.runTests({ signal, evidence: { taskId, phase: "DISTILL_RED" } });
  if (run.timedOut) return { type: "GATE_FAIL", gate: "RED d'acceptance", reasons: ["Les tests ont dépassé le délai."] };
  const results = run.results.filter((r) => matchesAny(acceptanceGlobs, r.file) || matchesAny(acceptanceGlobs, r.id));
  const red = checkAcceptanceRed({ criteria, testPlan, results });
  if (red.reasons.length) return { type: "GATE_FAIL", gate: "RED d'acceptance", reasons: red.reasons };

  const changed = (await ctx.workspace.changedFiles(state.checkpoints.DISTILL!)).filter((f) => f.status !== "deleted");
  const artifacts: ArtifactRecord[] = [];
  for (const f of changed) artifacts.push({ path: f.path, sha256: await sha256(ctx, f.path), producedBy: "skraft-acceptance", attempt });
  return { type: "GATE_OK", artifacts, acceptanceHash: await ctx.workspace.fingerprint(["@stack:acceptanceTests"]), regressions: red.regressions };
}

async function writeReview(ctx: ExtensionContext, slug: string, phase: Phase, attempt: number, lenses: TerminalOutput<"submit_lens_verdict">[]): Promise<string> {
  const base = `.skraft/${slug}/reviews/${phase.toLowerCase()}-review-${attempt}`;
  await ctx.workspace.writeFile(`${base}.json`, JSON.stringify(lenses, null, 2));
  await ctx.workspace.writeFile(`${base}.md`, reviewReport(phase, attempt, lenses));
  return `${base}.md`;
}

/** Fichiers de la phase, depuis son checkpoint : livrables, code, tests (rapports de revue exclus). */
async function phaseFiles(ctx: ExtensionContext, state: SkraftState, phase: Phase): Promise<LensFiles> {
  const cp = state.checkpoints[phase];
  const changed = cp ? (await ctx.workspace.changedFiles(cp)).filter((f) => f.status !== "deleted" && !f.path.includes("/reviews/")).map((f) => f.path) : [];
  const tests = changed.filter((p) => ctx.stack.isTestFile(p));
  const code = changed.filter((p) => !tests.includes(p) && matchesAny(ctx.stack.layout.sources, p));
  // Livrables du dernier essai seulement, et encore présents (un rollback a pu effacer ceux d'avant).
  const existing = new Set(await ctx.workspace.listFiles());
  const latest = latestArtifacts(state.artifacts[phase]).map((a) => a.path).filter((p) => existing.has(p));
  const artifacts = [...new Set([...latest, ...changed.filter((p) => !tests.includes(p) && !code.includes(p))])];
  return { artifacts, code, tests };
}

function finalReport(s: SkraftState): string {
  const executed = s.phasesCompleted.join(", ") || "aucune";
  const skipped = s.skipPhases.join(", ") || "aucune";
  const adrs = s.adrs.map((a) => `${a.id} (${a.status})`).join(", ") || "aucun";
  const retries = Object.values(s.reviews).flat().filter((r) => r.verdict !== "APPROVED").length;
  return [
    `Pipeline skraft terminé pour **${s.story?.id ?? s.slug}** (branche ${s.branch}).`,
    `Difficulté : ${s.difficulty?.level ?? "?"} (${s.difficulty?.confirmedBy === "user" ? "confirmée" : "automatique"}).`,
    `Phases exécutées : ${executed} ; sautées : ${skipped}.`,
    `ADR : ${adrs}. Revues demandant des changements : ${retries}.`,
    `Réessais par phase : ${Object.entries(s.retries ?? {}).map(([p, n]) => `${p} ${n}`).join(", ") || "aucun"}.`,
    `Identifiant de suivi : ${randomUUID().slice(0, 8)}.`,
  ].join("\n");
}
