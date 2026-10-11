import { createHash, randomUUID } from "node:crypto";
import { baselineProblems, coverageForChanges, EnvFailureError, WorkDefectError } from "@agent-studio/extension-api";
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
import { artifactsDuRun, latestArtifacts, lensBrief, reviewFacts, type LensFiles } from "./review-brief.js";
import { reviewReport } from "./review.js";
import type { LensName } from "./difficulty.js";
import { parseStory, slugOf } from "./story.js";
import { contractSymbolsPresent, defectTargetOf, loadQualityBar, phaseEndMutation, planDeliver, runDeliverAgent, scenarioGate, verifyFixTests, verifyUnitGreen, verifyUnitRed } from "./deliver-effects.js";
import { checkCoverage } from "./deliver.js";
import { lensHistory, numberDefects } from "./review-thread.js";
import type { LensVerdict } from "./review.js";

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

/**
 * Défaut de travail d'un agent (délai, fin sans sortie…). Par le nom et non par `instanceof` : en
 * mode isolé, l'erreur est recréée par le runtime de l'hôte, dont la classe n'est pas celle du
 * paquet de l'extension.
 */
const defautDeTravail = (err: unknown) =>
  err instanceof WorkDefectError || ["WorkDefectError", "TurnTimeoutError", "TurnBudgetError", "TurnCostError", "TurnContextError"].includes((err as Error | undefined)?.name ?? "");

const normaliser = (q: string) => q.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Une lentille, menée jusqu'à son verdict (D4 de docs/12) :
 * - une question nouvelle remonte telle quelle : le réducteur la soumet à l'humain ;
 * - une question déjà tranchée, un silence ou un délai dépassé : la lentille est relancée **seule**,
 *   une fois, sans toucher au producteur ; au second échec, « revue impossible » (escalade sans essai).
 */
async function runLens(
  ctx: ExtensionContext,
  lens: LensName,
  brief: string,
  reponses: { question: string; answer: string }[],
  signal: AbortSignal,
  evidence: { taskId: string; phase: string },
): Promise<{ verdict: LensVerdict } | { lens: LensName; question: string; choices: string[] }> {
  let consigne = brief;
  for (let tentative = 1; ; tentative++) {
    let r: AgentRunResult<"submit_lens_verdict">;
    try {
      r = await ctx.agents.run<"submit_lens_verdict">(`skraft-lens-${lens}`, consigne, { signal, evidence });
    } catch (err) {
      if (!defautDeTravail(err)) throw err;
      if (tentative >= 2) throw new EnvFailureError(`revue impossible : ${lens}, ${(err as Error).message}`);
      continue;
    }
    if (!r.blocker) return { verdict: r.output };
    const deja = reponses.find((x) => normaliser(x.question) === normaliser(r.blocker!.question));
    if (!deja) return { lens, question: r.blocker.question, choices: r.blocker.choices };
    if (tentative >= 2) throw new EnvFailureError(`revue impossible : ${lens}, question déjà tranchée (« ${deja.question} » → ${deja.answer})`);
    consigne = `${brief}\n\nTa question « ${r.blocker.question} » a déjà une réponse de l'utilisateur : ${deja.answer}. Rends ton verdict avec submit_lens_verdict.`;
  }
}

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
      const run = await ctx.stack.runTests({ signal, evidence: tag("INIT_BASELINE") });
      const problems = baselineProblems(run);
      if (problems.length) {
        ctx.chat.post(`Lancement skraft bloqué avant tout appel d'agent :\n${problems.map((p) => `- ${p}`).join("\n")}`);
        return { type: "INIT_FAILED", reasons: problems };
      }
      const { bar, notes } = await loadQualityBar(ctx);
      const sources = (await ctx.workspace.listFiles()).filter((p) => matchesAny(ctx.stack.layout.sources, p));
      const warnings = run.coverage ? checkCoverage(run.coverage, sources, bar) : ["Couverture initiale non mesurée : la commande de test du projet n'en produit pas."];
      if (warnings.length || notes.length)
        ctx.chat.post(`Précontrôle skraft — avertissement non bloquant sur le code existant :\n${[...warnings, ...notes].map((p) => `- ${p}`).join("\n")}\nLes seuils de couverture de livraison portent uniquement sur les lignes ajoutées ou modifiées.`);
      const slug = slugOf(parsed.story.id);
      const qualityCheckpoint = (await ctx.workspace.checkpoint(`skraft ${slug} : qualité initiale`)).id;
      const branch = `skraft/${slug}`;
      const baseSha = await ctx.git.head();
      await ctx.git.branch(branch);
      // L'arborescence est créée ICI, une fois pour toutes (ADR 0037) : la trace du 29/09 montrait
      // le chercheur tenter deux `mkdir -p` avant d'écrire — réflexe juste sous shell, et sans
      // objet ici. Le code prépare, l'agent n'a plus à y penser.
      for (const d of dossiersDeLaStory(slug)) await ctx.workspace.ensureDir(d);
      const indicators = computeIndicators(parsed.story, repositoryShape(await ctx.workspace.listFiles()));
      return { type: "INITIALIZED", slug, story: parsed.story, baseSha, branch, indicators, qualityCheckpoint };
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
      // Seul l'emplacement est dynamique : il vient de la stack. La norme de nommage et de recopie
      // est statique et vit dans `agents/skraft-acceptance.agent.md` (ADR 0024, 0043).
      if (effect.phase === "DISTILL") brief += `\nTests d'acceptance à écrire dans : ${ctx.stack.layout.acceptanceTests.join(", ")}`;
      // Un ADR décidé ne se réécrit plus (D3 de docs/12) : la garde refuse l'écriture.
      const decides = state.adrs.filter((a) => a.status !== "Proposed").map((a) => a.path);
      const r = await ctx.agents.run<"report_phase">(effect.role, brief, { signal, readOnly: [...GELÉS, ...decides], evidence: tag(effect.phase) });
      if (r.blocker) return { type: "BLOCKER_REPORTED", question: r.blocker.question, choices: r.blocker.choices };
      return {
        type: "AGENT_REPORTED",
        role: effect.role,
        summary: r.output.summary,
        files: r.output.files,
        ...(r.skillsLoaded ? { skills: r.skillsLoaded } : {}),
        ...(r.output.responses?.length ? { responses: r.output.responses } : {}),
      };
    }

    case "runGate":
      return runGate(ctx, state, effect.phase, effect.attempt, signal, taskId);

    case "runReview": {
      // Faits établis par le code et fichiers de la phase (§9.1, §9.2) ; une session neuve par lentille, en parallèle.
      const facts = reviewFacts(state, effect.phase, await ctx.evidence.list(taskId));
      const files = await phaseFiles(ctx, state, effect.phase);
      // Chaque lentille revoit SES défauts précédents et la réponse de l'agent (ADR 0046).
      const threads = state.reviewThreads ?? [];
      // Réponses de l'utilisateur : une lentille ne doit pas reposer une question déjà tranchée (D4).
      const reponses = [
        ...state.openQuestions.filter((q) => q.answer !== undefined).map((q) => ({ question: q.text, answer: q.answer! })),
        ...state.answers,
      ];
      const allFacts = [...facts, ...reponses.map((r) => `Réponse de l'utilisateur : « ${r.question} » → ${r.answer}`)];
      const runs = await Promise.all(
        effect.lenses.map((lens: LensName) =>
          runLens(ctx, lens, lensBrief(lens, state, effect.phase, files, allFacts, lensHistory(threads, lens)), reponses, signal, tag("REVIEW")),
        ),
      );
      const question = runs.find((r) => "question" in r);
      if (question && "question" in question) return { type: "LENS_BLOCKED", lens: question.lens, question: question.question, choices: question.choices };
      const raw = runs.map((r) => ("verdict" in r ? r.verdict : null)).filter((v): v is LensVerdict => v !== null);
      // Identifiants et cibles effectives attribués par le code, d'après la nature du fichier cité.
      const verdicts = numberDefects(raw, state.reviews[effect.phase].length + 1, defectTargetOf(ctx));
      const reportPath = await writeReview(ctx, state.slug, effect.phase, effect.attempt, verdicts);
      // DELIVER : référence de la garde du contrat ratifié, relevée sur le code que la revue a jugé.
      const contractSymbols = effect.phase === "DELIVER" ? await contractSymbolsPresent(ctx, state.slug) : [];
      return { type: "LENSES_DONE", lenses: verdicts, reportPath, ...(contractSymbols.length ? { contractSymbols } : {}) };
    }

    case "askArbitration": {
      const t = effect.thread;
      await ctx.interactions.request({
        taskId,
        title: `Arbitrer un désaccord de revue (${t.id})`,
        detail:
          `Défaut ${t.severity} signalé par la lentille ${t.lens} : ${t.description}${t.file ? ` (${t.file}${t.line ? `:${t.line}` : ""})` : ""}\n` +
          `L'agent le conteste : « ${t.contestation ?? "?"} »\n` +
          `La lentille le maintient${t.ruling ? ` : « ${t.ruling} »` : ""}.`,
        options: [
          { id: `accept:${t.id}`, label: "Donner raison à l'agent : le défaut tombe" },
          { id: `maintain:${t.id}`, label: "Donner raison à la lentille : à corriger" },
        ],
        requiredRoles: ["developpeur", "architecte", "administrateur"],
      });
      return;
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
        title: effect.lens ? `Question de la revue (${state.phase ?? "skraft"}, ${effect.lens})` : `Question de l'agent (${state.phase ?? "skraft"})`,
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

    // Indissociable du rollback qui le précède (ADR 0050) : le dépôt et la mémoire des agents
    // doivent revenir au même point. Émis aussi quand une phase est sautée.
    case "forgetSessions":
      await ctx.agents.forget(taskId, effect.roles);
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
    case "verifyFixTests":
      return verifyFixTests(effect, { ctx, state, taskId, signal });
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
  for (const f of changed.filter(pasUnRapport)) artifacts.push({ path: f.path, sha256: await sha256(ctx, f.path), producedBy, attempt });
  if (phase !== "DELIVER") return { type: "GATE_OK", artifacts };
  const { bar } = await loadQualityBar(ctx);
  const sources = (await ctx.workspace.changedFiles(state.qualityCheckpoint ?? cp))
    .filter((f) => f.status !== "deleted" && matchesAny(ctx.stack.layout.sources, f.path) && !ctx.stack.isTestFile(f.path));
  const coverageFacts: string[] = [];
  const coverageNotes: string[] = state.qualityCheckpoint ? [] : ["Référence de qualité initiale absente (ancienne tâche) : couverture du diff limitée à DELIVER."];
  if (sources.length) {
    const run = await ctx.stack.runTests({ signal, evidence: { taskId, phase: "DELIVER_COVERAGE" } });
    const problems = baselineProblems(run);
    if (problems.length) return { type: "GATE_FAIL", gate: "suite finale", reasons: problems };
    if (run.coverage) {
      const diff = coverageForChanges(run.coverage, sources);
      const reasons = checkCoverage(diff.report, sources.map((f) => f.path), bar, true);
      if (reasons.length) return { type: "GATE_FAIL", gate: "couverture du diff", reasons };
      coverageNotes.push(...diff.notes);
      coverageFacts.push(...diff.report.files.map((f) => `Couverture du diff (tâche) : ${f.file} à ${Math.round(f.score * 10) / 10} %, ${f.covered} ligne(s) sur ${f.total}.`));
    } else coverageNotes.push("Couverture non mesurée : la commande de test du projet n'en produit pas.");
  }
  // Mutation de fin de DELIVER (ADR 0049) : un mutant survivant est un test trop faible ; le
  // réducteur en fait des défauts adressés au testeur, sans relancer la phase.
  const m = await phaseEndMutation(ctx, state, signal);
  if (m.reasons.length) return { type: "GATE_FAIL", gate: "mutation", reasons: m.reasons };
  return { type: "GATE_OK", artifacts, facts: [...coverageFacts, ...m.facts], notes: [...coverageNotes, ...m.notes] };
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
export const GELÉS = [".skraft/quality.json", ".agent-studio/quality.yaml"] as const;

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
/** Les rapports de revue sont écrits par le code à chaque revue : ce ne sont pas des livrables (D6 de docs/12). */
const pasUnRapport = (f: { path: string }) => !f.path.includes("/reviews/");
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
  // Un ADR déjà décidé n'est plus « nouveau » : son statut n'est plus Proposed (D3 de docs/12).
  const decides = new Set(state.adrs.filter((a) => a.status !== "Proposed").map((a) => a.path));
  const adrs = await Promise.all(adrPaths.map(async (path) => ({ path, md: await ctx.workspace.readFile(path), isNew: added.has(path) && !decides.has(path) })));
  let supersessions = "";
  try {
    supersessions = await ctx.workspace.readFile(SUPERSESSIONS);
  } catch {
    supersessions = "";
  }
  const reasons = checkDesign({ docs, adrs, supersessions, modifiedExistingAdrs });
  if (reasons.length) return { type: "GATE_FAIL", gate: "cohérence", reasons };
  const artifacts: ArtifactRecord[] = [];
  for (const f of changed.filter((c) => c.status !== "deleted").filter(pasUnRapport))
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
    return { type: "GATE_FAIL", gate: "plan de test", reasons: [`Plan de test absent : ${dir}/test-plan.md`] };
  }
  const run = await ctx.stack.runTests({ signal, evidence: { taskId, phase: "DISTILL_RED" } });
  if (run.timedOut) return { type: "GATE_FAIL", gate: "RED d'acceptance", reasons: ["Les tests ont dépassé le délai."] };
  // La suite entière est transmise : c'est la porte qui reconnaît ses tests, au marqueur `ac-<n>`
  // qu'elle exige (ADR 0041). Filtrer ici sur les globs de `layout.acceptanceTests` comparait un
  // chemin de fichier à un identifiant que le rapport n'exprime pas ainsi — `Tarification.Tests.
  // RemiseParPalierAcceptanceTests` pour JUnit — et ne rendait jamais rien.
  const red = checkAcceptanceRed({ criteria, testPlan, results: run.results });
  if (red.reasons.length) return { type: "GATE_FAIL", gate: "RED d'acceptance", reasons: red.reasons };

  const changed = (await ctx.workspace.changedFiles(state.checkpoints.DISTILL!)).filter((f) => f.status !== "deleted");
  const artifacts: ArtifactRecord[] = [];
  for (const f of changed.filter(pasUnRapport)) artifacts.push({ path: f.path, sha256: await sha256(ctx, f.path), producedBy: "skraft-acceptance", attempt });
  return { type: "GATE_OK", artifacts, acceptanceHash: await ctx.workspace.fingerprint(["@stack:acceptanceTests"]), regressions: red.regressions };
}

async function writeReview(ctx: ExtensionContext, slug: string, phase: Phase, attempt: number, lenses: LensVerdict[]): Promise<string> {
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
  const latest = latestArtifacts(artifactsDuRun(state, phase)).map((a) => a.path).filter((p) => existing.has(p));
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
