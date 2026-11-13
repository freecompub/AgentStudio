import { createHash, randomUUID } from "node:crypto";
import { baselineProblems, bddNonDeclare, coverageForChanges, EnvFailureError, MANIFESTE, WorkDefectError } from "@agent-studio/extension-api";
import type { AgentRunResult, EffectContext, ExtensionContext, TerminalOutput, TerminalToolName } from "@agent-studio/extension-api";
import { buildBrief, ecrirePassation, ligneBdd, lignePile } from "./brief.js";
import { computeIndicators, type Difficulty, type RepositoryShape } from "./difficulty.js";
import type { ArtifactRecord, Phase, SkraftEffect, SkraftState } from "./model.js";
import type { DefectThread } from "./review-thread.js";
import type { Ev } from "./reducer.js";
import { preselectFiles } from "./preselect.js";
import { contenusCites, extraireInventaire, motifsDeLaRecherche } from "./research.js";
import { parseAdr, setAdrStatus } from "./adr.js";
import { checkDesign, matriceDeCoherence, matriceMarkdown, ligneNomsDuModele, MODEL_DOCS } from "./design.js";
import { checkAcceptanceRed, planDeTest, testsDeLaStory } from "./distill.js";
import { gherkinDuDisque } from "./gherkin.js";
import { fichiersDesScenarios, motifsDesScenarios, type DonneesDesScenarios } from "./verifier-scenarios.js";
import { matchesAny } from "@agent-studio/extension-api";
import { SUPERSESSIONS } from "./render-adr-tool.js";
import { artifactsDuRun, latestArtifacts, lensBrief, refuterBrief, reviewFacts, type LensFiles } from "./review-brief.js";
import { reviewReport } from "./review.js";
import type { LensName } from "./difficulty.js";
import { ligneValeursRetirees, parseStory, slugOf } from "./story.js";
import { contractSymbolsPresent, defectTargetOf, loadQualityBar, phaseEndMutation, planDeliver, runDeliverAgent, scenarioGate, verifyFixTests, verifyUnitGreen, verifyUnitRed } from "./deliver-effects.js";
import { checkCoverage, lignesSousLeSeuil, sansLignesExemptees, sansTestsObsoletes } from "./deliver.js";
import { appliquerRefutations, defautsARefuter, lensHistory, numberDefects, rangerHorsChangement, verifierOccurrences } from "./review-thread.js";
import type { LensDefect, LensVerdict } from "./review.js";

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
      // BDD non déclaré (08/11) : un composant muet qui en montre les signes partirait dans le mauvais mode.
      const tousLesFichiers = await ctx.workspace.listFiles();
      const racinesMuettes = ctx.stack.bddNonDecide ?? [];
      const manifestes = racinesMuettes.length
        ? await Promise.all(tousLesFichiers.filter((f) => MANIFESTE.test(f)).map(async (path) => ({ path, content: await ctx.workspace.readFile(path).catch(() => "") })))
        : [];
      const problems = [...baselineProblems(run), ...bddNonDeclare(racinesMuettes, tousLesFichiers, manifestes)];
      if (problems.length) {
        ctx.chat.post(`Lancement skraft bloqué avant tout appel d'agent :\n${problems.map((p) => `- ${p}`).join("\n")}`);
        return { type: "INIT_FAILED", reasons: problems };
      }
      const { bar, notes } = await loadQualityBar(ctx);
      const sources = (await ctx.workspace.listFiles()).filter((p) => matchesAny(ctx.stack.layout.sources, p));
      const warnings = run.coverage ? checkCoverage(run.coverage, sources, bar) : ["Couverture initiale non mesurée : la commande de test du projet n'en produit pas."];
      if (warnings.length || notes.length)
        ctx.chat.post(`Précontrôle skraft — avertissement non bloquant sur le code existant :\n${[...warnings, ...notes].map((p) => `- ${p}`).join("\n")}\nLes seuils de couverture de livraison portent uniquement sur les lignes ajoutées ou modifiées.`);
      const slug = slugOf(parsed.story.id, parsed.story.title);
      const qualityCheckpoint = (await ctx.workspace.checkpoint(`skraft ${slug} : qualité initiale`)).id;
      const branch = `skraft/${slug}`;
      const baseSha = await ctx.git.head();
      await ctx.git.branch(branch);
      // L'arborescence est créée ICI, une fois pour toutes (ADR 0037) : la trace du 29/09 montrait
      // le chercheur tenter deux `mkdir -p` avant d'écrire — réflexe juste sous shell, et sans
      // objet ici. Le code prépare, l'agent n'a plus à y penser.
      for (const d of dossiersDeLaStory(slug)) await ctx.workspace.ensureDir(d);
      const indicators = computeIndicators(parsed.story, repositoryShape(await ctx.workspace.listFiles()));
      return { type: "INITIALIZED", slug, story: parsed.story, baseSha, branch, indicators, qualityCheckpoint, testsAvant: run.results.map((r) => ({ id: r.id, status: r.status })) };
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
      // Gherkin déjà là au début de DISTILL (ADR 0074, run du 08/11) : celui des stories précédentes.
      if (effect.phase === "DISTILL") return { type: "PHASE_CHECKPOINTED", phase: effect.phase, checkpointId: cp.id, gherkinAvant: await gherkinDuDisque(ctx, state.slug) };
      return { type: "PHASE_CHECKPOINTED", phase: effect.phase, checkpointId: cp.id };
    }

    case "runSpecialist": {
      await ecrirePassation(ctx, state);
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
      if (effect.phase === "DESIGN" || effect.phase === "DISTILL") brief += `\n${lignePile(ctx.stack.id, ctx.stack.layout)}`;
      // L'architecte qui décide reçoit les noms du modèle, tels que la porte de cohérence les lira (08/11).
      if (effect.role === "skraft-architect-decide") {
        const docs: Record<string, string> = {};
        for (const d of MODEL_DOCS) {
          const md = await ctx.workspace.readFile(`.skraft/${state.slug}/design/${d}`).catch(() => null);
          if (md !== null) docs[d] = md;
        }
        const ligne = ligneNomsDuModele(state.slug, docs);
        if (ligne) brief += `\n${ligne}`;
      }
      // BDD (ADR 0074) : DISTILL écrit le `.feature` dans le projet, titres qui commencent par le critère.
      if (effect.phase === "DISTILL" && ctx.stack.bdd?.length) brief += `\n${ligneBdd(ctx.stack.bdd)}`;
      // Un ADR décidé ne se réécrit plus (D3 de docs/12) : la garde refuse l'écriture.
      const decides = state.adrs.filter((a) => a.status !== "Proposed").map((a) => a.path);
      // Le chercheur et l'agent d'acceptance vérifient leur travail avec la porte que le code rejouera (ADR 0082).
      const document = `.skraft/${state.slug}/research/research.md`;
      const verification =
        effect.role === "skraft-acceptance"
          ? { verification: { outil: "verifier_scenarios", fichiers: fichiersDesScenarios(state.slug, ctx.stack.bdd, ctx.stack.layout.acceptanceTests), donnees: donneesDesScenarios(ctx, state) } }
          : effect.role === "skraft-researcher"
            ? { verification: { outil: "verifier_recherche", fichiers: [document], donnees: { chemin: document } } }
            : {};
      // Le modèle est à son auteur : l'architecte qui décide le lit et signale ses défauts (11/11).
      const modele = effect.role === "skraft-architect-decide" ? ["event-model.md", "domain-model.md", "context-map.md"].map((f) => `.skraft/${state.slug}/design/${f}`) : [];
      const r = await ctx.agents.run<"report_phase">(effect.role, brief, { signal, readOnly: [...GELÉS, ...decides, ...modele], evidence: tag(effect.phase), ...verification });
      if (r.blocker) return { type: "BLOCKER_REPORTED", question: r.blocker.question, choices: r.blocker.choices };
      return {
        type: "AGENT_REPORTED",
        role: effect.role,
        summary: r.output.summary,
        files: r.output.files,
        ...(r.skillsLoaded ? { skills: r.skillsLoaded } : {}),
        ...(r.output.responses?.length ? { responses: r.output.responses } : {}),
        ...(r.verification ? { verifications: r.verification.appels } : {}),
        ...(r.output.modelDefects?.length ? { modelDefects: r.output.modelDefects } : {}),
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
      const round = state.reviews[effect.phase].length + 1;
      const existants = new Set(await ctx.workspace.listFiles());
      const existe = (p: string) => existants.has(p);
      // Hors du changement de la phase : notés, sans renvoyer le travail ; avant le réfutateur, pour
      // ne pas payer un appel sur une note.
      const cp = state.checkpoints[effect.phase];
      const changements = cp ? (await ctx.workspace.changedFiles(cp)).filter((f) => f.status !== "deleted" && pasUnRapport(f)) : [];
      const ranges = rangerHorsChangement(verifierOccurrences(numberDefects(raw, round, defectTargetOf(ctx)), existe), changements.map((f) => ({ path: f.path, ...(f.lines ? { lines: f.lines } : {}) })));
      signalerBloquantsHorsChangement(ctx, state, ranges);
      const verdicts = await refuter(ctx, state, effect.phase, ranges, files, allFacts, signal, existe);
      const reportPath = await writeReview(ctx, state.slug, effect.phase, round, effect.attempt, verdicts);
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
        // Valeur douteuse (ADR 0080) : la garder d'abord, c'est ce que retient un répondeur qui ne lit pas.
        ...(effect.valeur
          ? {
              title: `Valeur à tester (${state.story?.id ?? "skraft"}, critère ${effect.valeur.critere})`,
              detail: effect.text,
              options: [
                { id: `keep:${effect.id}`, label: "Oui : la garder dans la porte des valeurs" },
                { id: `drop:${effect.id}`, label: "Non : la retirer de la porte des valeurs" },
              ],
            }
          : {
              title: `Question ouverte (${state.story?.id ?? "skraft"})`,
              detail: effect.text,
              options: [
                { id: `answer:${effect.id}`, label: "Répondre" },
                { id: `defer:${effect.id}`, label: "Reporter" },
              ],
              freeText: true,
            }),
        requiredRoles: ["po", "developpeur", "architecte", "administrateur"],
      });
      // Demande créée : une panne sur une question suivante ne la fera pas reposer (D17 de docs/12).
      return { type: "QUESTION_ASKED", id: effect.id };

    case "askEscalation":
      await ctx.interactions.request({
        taskId,
        title: `Pipeline skraft bloqué (${state.escalation?.from === "ROUTE" ? "ROUTE" : (state.phase ?? state.stage)})`,
        detail: effect.reason,
        options: effect.options.map((id) => ({
          id,
          label: {
            retry: state.escalation?.from === "ROUTE" ? "Relancer : reposer les questions" : state.escalation?.from === "COMMIT" ? "Relancer le commit" : "Relancer la phase",
            skip: "Sauter la phase",
            continue: "Continuer sans commiter",
            abort: "Abandonner",
            // Selon la cause d'un scénario escaladé (ADR 0066).
            obsolete: "Déclarer ces tests obsolètes et continuer",
            exempt: "Exempter ces lignes et continuer",
          }[id],
        })),
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
      // Rapports de revue du run en cours réécrits depuis l'état (un rollback de réessai a pu les
      // effacer) ; ceux d'un run effacé par un rembobinage ne ressuscitent pas (D8 de docs/12).
      for (const [i, r] of state.reviews[effect.phase].entries())
        if (i >= (state.debutDesRevues?.[effect.phase] ?? 0)) await writeReview(ctx, state.slug, effect.phase, i + 1, r.attempt, r.lenses);
      // Dérogations de mutation commitées avec la livraison : elles restent dans l'historique du projet (ADR 0065).
      if (effect.phase === "DELIVER" && (state.derogations?.length || state.derogationsCouverture?.length || state.testsObsoletes?.length))
        await ctx.workspace.writeFile(`.skraft/${state.slug}/deliver/derogations.md`, rapportDeDerogations(state));
      // Écarts au plan de test commités avec la livraison (ADR 0067).
      if (effect.phase === "DELIVER" && state.ecartsAuPlan?.length) await ctx.workspace.writeFile(`.skraft/${state.slug}/deliver/ecarts-au-plan.md`, rapportDEcarts(state));
      return { type: "COMMITTED", sha: await ctx.git.commit(effect.message) };

    case "arbitrateMutants": {
      // L'arbitre de mutation juge chaque mutant contesté (ADR 0065) ; un silence le laisse à l'humain.
      let rulings: { defect: string; decision: "accepted" | "maintained"; reason?: string }[] = [];
      try {
        const r = await ctx.agents.run<"submit_lens_verdict">("skraft-mutation-arbiter", await briefArbitre(ctx, state, effect.threads), { signal });
        rulings = (r.output?.rulings ?? []).map((x) => ({ defect: x.defect, decision: x.decision, ...(x.reason ? { reason: x.reason } : {}) }));
      } catch (err) {
        if (!defautDeTravail(err)) throw err;
      }
      return { type: "MUTANTS_JUDGED", rulings };
    }

    case "askMutationArbitration": {
      const t = effect.thread;
      if (t.couverture) {
        const element = `${t.couverture.file}:${t.couverture.lines.join(", ")}`;
        await ctx.interactions.request({
          taskId,
          title: `Arbitrer un défaut de couverture (${t.id})`,
          detail: `Lignes non couvertes : ${element}\nContestation du testeur : « ${t.contestation ?? "?"} »\nJustifie ta décision en commentaire : elle est tracée et commitée.`,
          options: [
            { id: `derogation:${t.id}`, label: "Lignes inatteignables ou sans comportement : accorder la dérogation" },
            { id: `corriger:${t.id}`, label: "À tester : le testeur doit les couvrir" },
          ],
          freeText: true,
          requiredRoles: ["developpeur", "architecte", "administrateur"],
        });
        return;
      }
      const m = t.mutant!;
      await ctx.interactions.request({
        taskId,
        title: `Arbitrer un mutant (${t.id})`,
        detail:
          `Mutant survivant : ${m.file}:${m.line} (${m.operator})${m.replacement ? ` — code du mutant : ${m.replacement}` : ""}\n` +
          `Contestation du testeur : « ${t.contestation ?? "?"} »\n${effect.avis}\nJustifie ta décision en commentaire : elle est tracée et commitée.`,
        options: [
          { id: `derogation:${t.id}`, label: "Mutant équivalent : accorder la dérogation" },
          { id: `corriger:${t.id}`, label: "Non équivalent : le testeur doit le tuer" },
        ],
        freeText: true,
        requiredRoles: ["developpeur", "architecte", "administrateur"],
      });
      return;
    }

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
    const run = sansTestsObsoletes(await ctx.stack.runTests({ signal, evidence: { taskId, phase: "DELIVER_COVERAGE" } }), (state.testsObsoletes ?? []).map((x) => x.test));
    const problems = baselineProblems(run);
    if (problems.length) return { type: "GATE_FAIL", gate: "suite finale", reasons: problems };
    if (run.coverage) {
      // Lignes exemptées par l'humain : hors du calcul (arbitrage de la couverture contestée).
      const diff = coverageForChanges(run.coverage, sansLignesExemptees(sources, state.derogationsCouverture ?? []));
      const reasons = checkCoverage(diff.report, sources.map((f) => f.path), bar, true);
      if (reasons.length) return { type: "GATE_FAIL", gate: "couverture du diff", reasons, lignes: lignesSousLeSeuil(diff.report, sources.map((f) => f.path), bar) };
      coverageNotes.push(...diff.notes);
      coverageFacts.push(...diff.report.files.map((f) => `Couverture du diff (tâche) : ${f.file} à ${Math.round(f.score * 10) / 10} %, ${f.covered} ligne(s) sur ${f.total}.`));
    } else coverageNotes.push("Couverture non mesurée : la commande de test du projet n'en produit pas.");
  }
  // Mutation de fin de DELIVER (ADR 0049) : un mutant survivant est un test trop faible ; le
  // réducteur en fait des défauts adressés au testeur, sans relancer la phase.
  const m = await phaseEndMutation(ctx, state, signal);
  if (m.reasons.length) return { type: "GATE_FAIL", gate: "mutation", reasons: m.reasons, mutants: m.mutants };
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
export const GELÉS = [".skraft/quality.json", ".agent-studio/quality.yaml", ".agent-studio/projet.yaml"] as const;

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
  // Le même calcul que l'outil `verifier_recherche` du chercheur (ADR 0082).
  const { reasons, openQuestions } = motifsDeLaRecherche(md, await contenusCites(ctx, md));
  if (reasons.length) return { type: "GATE_FAIL", gate: "citations", reasons };
  const known = new Set(state.openQuestions.map((q) => q.text));
  return {
    type: "GATE_OK",
    artifacts: [{ path, sha256: createHash("sha256").update(md).digest("hex"), producedBy: "skraft-researcher", attempt }],
    openQuestions: openQuestions.filter((q) => !known.has(q)),
    recherche: extraireInventaire(md),
  };
}

const ADR_FILE = /^docs\/adr\/adr-\d{3,}-[^/]+\.md$/;
/** Tout fichier de `docs/adr/`, y compris hors convention : la porte doit voir les ADR du projet. */
const estFichierAdr = (p: string) => /^docs\/adr\/[^/]+\.md$/.test(p) && p !== SUPERSESSIONS;
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
  const modifiedExistingAdrs = changed.filter((f) => f.status !== "added" && estFichierAdr(f.path)).map((f) => f.path);
  const fichiers = await ctx.workspace.listFiles();
  const adrPaths = fichiers.filter(estFichierAdr);
  // Un ADR déjà décidé n'est plus « nouveau » : son statut n'est plus Proposed (D3 de docs/12).
  const decides = new Set(state.adrs.filter((a) => a.status !== "Proposed").map((a) => a.path));
  const adrs = await Promise.all(adrPaths.map(async (path) => ({ path, md: await ctx.workspace.readFile(path), isNew: added.has(path) && !decides.has(path) })));
  let supersessions = "";
  try {
    supersessions = await ctx.workspace.readFile(SUPERSESSIONS);
  } catch {
    supersessions = "";
  }
  // La porte ne lit plus les sources du projet : elle juge ce que la story produit (11/11).
  const input = { docs, adrs, supersessions, modifiedExistingAdrs };
  // La matrice de cohérence est écrite par le code, à chaque essai, même refusé : c'est lui qui la
  // juge (G10 de skraft-plugin, docs/15 §4.5), pas l'architecte qui se la décernerait.
  const matrice = `${dir}/consistency-matrix.md`;
  await ctx.workspace.writeFile(matrice, matriceMarkdown(matriceDeCoherence(input)));
  const reasons = checkDesign(input);
  if (reasons.length) return { type: "GATE_FAIL", gate: "cohérence", reasons };
  const artifacts: ArtifactRecord[] = [];
  for (const f of changed.filter((c) => c.status !== "deleted" && c.path !== matrice).filter(pasUnRapport))
    artifacts.push({ path: f.path, sha256: await sha256(ctx, f.path), producedBy: ADR_FILE.test(f.path) ? "render_adr" : "skraft-architect", attempt });
  artifacts.push({ path: matrice, sha256: await sha256(ctx, matrice), producedBy: "porte cohérence", attempt });
  return {
    type: "GATE_OK",
    artifacts,
    adrs: adrs.filter((a) => a.isNew).map((a) => ({ id: parseAdr(a.md).id, path: a.path, status: "Proposed" as const })),
  };
}

/** Porte valeurs puis porte RED d'acceptance (§7.3) ; à la sortie, gel des tests d'acceptance. */
/** Ce que la porte des scénarios sait, hors fichiers : les données de la vérification de l'agent (ADR 0082). */
function donneesDesScenarios(ctx: ExtensionContext, state: SkraftState): DonneesDesScenarios {
  return { slug: state.slug, bdd: ctx.stack.bdd ?? null, gherkinAvant: state.gherkinAvant ?? [], criteria: state.story?.criteria ?? [], globsAcceptance: ctx.stack.layout.acceptanceTests };
}

async function distillGate(ctx: ExtensionContext, state: SkraftState, attempt: number, signal: AbortSignal, taskId: string): Promise<Ev> {
  const dir = `.skraft/${state.slug}/distill`;
  const criteria = state.story?.criteria ?? [];
  // Portes de forme : le même calcul que l'outil `verifier_scenarios` de l'agent (ADR 0082).
  const motifs = fichiersDesScenarios(state.slug, ctx.stack.bdd, ctx.stack.layout.acceptanceTests);
  const fichiers: Record<string, string> = {};
  for (const path of (await ctx.workspace.listFiles()).filter((f) => matchesAny(motifs, f))) fichiers[path] = await ctx.workspace.readFile(path);
  const forme = motifsDesScenarios({ fichiers, ...donneesDesScenarios(ctx, state) });
  if (forme.motifs.length) return { type: "GATE_FAIL", gate: forme.porte, reasons: forme.motifs };
  const testPlan = fichiers[`${dir}/test-plan.md`]!;
  const run = await ctx.stack.runTests({ signal, evidence: { taskId, phase: "DISTILL_RED" } });
  if (run.timedOut) return { type: "GATE_FAIL", gate: "RED d'acceptance", reasons: ["Les tests ont dépassé le délai."] };
  // La suite entière est transmise : c'est la porte qui reconnaît ses tests, au marqueur `ac-<n>`
  // qu'elle exige (ADR 0041). Filtrer ici sur les globs de `layout.acceptanceTests` comparait un
  // chemin de fichier à un identifiant que le rapport n'exprime pas ainsi — `Tarification.Tests.
  // RemiseParPalierAcceptanceTests` pour JUnit — et ne rendait jamais rien.
  const red = checkAcceptanceRed({ criteria, testPlan, results: run.results, ...(state.testsAvant ? { avant: state.testsAvant } : {}) });
  if (red.reasons.length) return { type: "GATE_FAIL", gate: "RED d'acceptance", reasons: red.reasons };

  const changed = (await ctx.workspace.changedFiles(state.checkpoints.DISTILL!)).filter((f) => f.status !== "deleted");
  const artifacts: ArtifactRecord[] = [];
  for (const f of changed.filter(pasUnRapport)) artifacts.push({ path: f.path, sha256: await sha256(ctx, f.path), producedBy: "skraft-acceptance", attempt });
  // La matrice du plan de test est gardée : DELIVER y vérifie les écarts déclarés (ADR 0067).
  return { type: "GATE_OK", artifacts, acceptanceHash: await ctx.workspace.fingerprint(["@stack:acceptanceTests"]), regressions: red.regressions, testsDeLaStory: testsDeLaStory(run.results, state.testsAvant), planDeTest: planDeTest(testPlan) };
}

/** Notes hors du changement de toutes les revues du run, une fois chacune. */
function notesDuRun(state: SkraftState, extra: LensVerdict[] = []): { lens: string; note: LensDefect }[] {
  const vues = new Set<string>();
  const toutes: { lens: string; note: LensDefect }[] = [];
  for (const l of [...Object.values(state.reviews).flat().flatMap((r) => r.lenses), ...extra])
    for (const note of l.notes ?? []) {
      const cle = `${l.lens}|${note.file}:${note.line ?? ""}|${note.description}`;
      if (vues.has(cle)) continue;
      vues.add(cle);
      toutes.push({ lens: l.lens, note });
    }
  return toutes;
}

const ouNote = (n: LensDefect) => `${n.file}${n.line ? `:${n.line}` : ""}`;

/**
 * Un blocker hors du changement est signalé tout de suite, une seule fois : il n'est pas dû à la
 * story, mais il ne doit pas passer inaperçu ; sa correction attend la fin du cycle.
 */
function signalerBloquantsHorsChangement(ctx: ExtensionContext, state: SkraftState, lenses: LensVerdict[]): void {
  const deja = new Set(notesDuRun(state).map((x) => `${x.lens}|${ouNote(x.note)}|${x.note.description}`));
  for (const { lens, note } of notesDuRun(state, lenses)) {
    if (note.severity !== "blocker" || deja.has(`${lens}|${ouNote(note)}|${note.description}`)) continue;
    ctx.chat.post(`**Défaut bloquant hors du changement de la story** (lentille ${lens}) : \`${ouNote(note)}\` — ${note.description}\nIl n'est pas dû à cette story et ne renvoie pas le travail. Pour le corriger, fais-le après la fin du cycle skraft.`);
  }
}

/** Notes hors du changement, pour le bilan : les bloquants d'abord, à corriger après le cycle. */
function notesDuBilan(state: SkraftState): string[] {
  const ligne = (x: { lens: string; note: LensDefect }) => `- ${ouNote(x.note)} (${x.lens}, ${x.note.severity}) : ${x.note.description}`;
  const toutes = notesDuRun(state);
  const bloquants = toutes.filter((x) => x.note.severity === "blocker");
  const autres = toutes.filter((x) => x.note.severity !== "blocker");
  return [
    ...rappelDesTestsObsoletes(state.testsObsoletes ?? []),
    ...(bloquants.length ? ["**À corriger après le cycle** — défauts bloquants hors du changement de la story :", ...bloquants.map(ligne)] : []),
    ...(autres.length ? ["Remarques hors du changement de la story :", ...autres.map(ligne)] : []),
  ];
}

/** Tests déclarés obsolètes (ADR 0066) : à mettre à jour après le cycle, comme les défauts hors du changement. */
function rappelDesTestsObsoletes(tests: { test: string; scenario: string; raison: string }[]): string[] {
  if (!tests.length) return [];
  return ["**À corriger après le cycle** — tests existants déclarés obsolètes, sortis des portes :", ...tests.map((x) => `- mettre à jour ${x.test} : déclaré obsolète au scénario ${x.scenario}${x.raison ? ` (${x.raison})` : ""}.`)];
}

/**
 * Réfutateur (ADR 0069) : un appel par lentille qui a des défauts blocker ou major, en parallèle, avec
 * les entrées de cette lentille. Le code décide de ce qui tombe (`appliquerRefutations`). Un
 * réfutateur muet ou interrompu ne réfute rien : les défauts restent, comme dans le doute.
 */
async function refuter(ctx: ExtensionContext, state: SkraftState, phase: Phase, verdicts: LensVerdict[], files: LensFiles, facts: string[], signal: AbortSignal, existe: (path: string) => boolean): Promise<LensVerdict[]> {
  const lots = defautsARefuter(verdicts);
  if (!lots.length) return verdicts;
  const reponses = await Promise.all(
    lots.map(async (x) => {
      try {
        const r = await ctx.agents.run<"submit_lens_verdict">("skraft-finding-refuter", refuterBrief(x.lens as LensName, state, phase, files, facts, x.defects), { signal });
        return { lens: x.lens, rulings: r.output?.rulings ?? [] };
      } catch (err) {
        if (signal.aborted) throw err;
        return { lens: x.lens, rulings: [] };
      }
    }),
  );
  return reponses.reduce((acc, r) => appliquerRefutations(acc, r.rulings, existe, r.lens), verdicts);
}

/**
 * Rapports d'une revue, nommés par son rang dans la phase (`reviews` ne fait que grandir) : un
 * amendement, qui ne consomme pas d'essai, n'écrase plus la revue précédente (D8 de docs/12).
 */
async function writeReview(ctx: ExtensionContext, slug: string, phase: Phase, round: number, attempt: number, lenses: LensVerdict[]): Promise<string> {
  const base = `.skraft/${slug}/reviews/${phase.toLowerCase()}-review-${round}`;
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

/** Dossier de l'arbitre : chaque mutant contesté, la contestation, et le code des fichiers mutés. */
async function briefArbitre(ctx: ExtensionContext, state: SkraftState, threads: DefectThread[]): Promise<string> {
  const codes: string[] = [];
  for (const f of [...new Set(threads.map((t) => t.mutant!.file))]) codes.push(`Fichier ${f} :`, "```", await ctx.workspace.readFile(f), "```");
  return [
    `Story : ${state.story?.id ?? state.slug} — ${state.story?.title ?? ""}`,
    "Mutants survivants contestés par le testeur :",
    ...threads.map((t) => {
      const m = t.mutant!;
      return `  - [${t.id}] ${m.file}:${m.line} (${m.operator})${m.replacement ? ` — code du mutant : ${m.replacement}` : ""} ; contestation : « ${t.contestation ?? "?"} »`;
    }),
    ...codes,
  ].join("\n");
}

/** Fichier des dérogations, commité avec DELIVER (ADR 0065). */
/** Écarts au plan de test déclarés en DELIVER, vérifiés par le code et jugés par la revue (ADR 0067). */
function rapportDEcarts(s: SkraftState): string {
  const cellule = (x: string) => x.replace(/\|/g, "\\|");
  return [
    `# Écarts au plan de test — ${s.story?.id ?? s.slug}`,
    "",
    "Tests écrits à une autre couche, ou avec une autre doublure, que la matrice de `distill/test-plan.md`. Chaque écart a été déclaré par l'agent avec la règle qui l'impose, vérifié par le code contre la matrice, puis soumis à la revue.",
    "",
    "| Scénario | Critère | Déclaré par | Prévu | Réel | Règle |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(s.ecartsAuPlan ?? []).map((x) => `| ${x.scenario} | ${x.criterion} | ${x.par} | ${cellule(x.planned)} | ${cellule(x.actual)} | ${cellule(x.rule)} |`),
    "",
  ].join("\n");
}

function rapportDeDerogations(s: SkraftState): string {
  const cellule = (x: string) => x.replace(/\|/g, "\\|");
  const mutants = s.derogations ?? [];
  const lignes = s.derogationsCouverture ?? [];
  const obsoletes = s.testsObsoletes ?? [];
  return [
    `# Dérogations — ${s.story?.id ?? s.slug}`,
    "",
    ...(mutants.length
      ? [
          "## Mutation",
          "",
          "Mutants survivants reconnus équivalents après arbitrage, exemptés de la porte de mutation (ADR 0065).",
          "",
          "| Mutant | Décidé par | Raison | Contestation du testeur |",
          "| --- | --- | --- | --- |",
          ...mutants.map((x) => `| ${x.file}:${x.line} (${x.operator}) | ${x.par} | ${cellule(x.raison)} | ${cellule(x.contestation)} |`),
          "",
        ]
      : []),
    ...(lignes.length
      ? [
          "## Couverture du diff",
          "",
          "Lignes exemptées par l'humain, après contestation du testeur.",
          "",
          "| Ligne | Décidé par | Raison | Contestation du testeur |",
          "| --- | --- | --- | --- |",
          ...lignes.map((x) => `| ${x.file}:${x.line} | humain | ${cellule(x.raison)} | ${cellule(x.contestation)} |`),
          "",
        ]
      : []),
    ...(obsoletes.length
      ? [
          "## Tests existants déclarés obsolètes",
          "",
          "Tests qui passaient avant DELIVER, que la story fait échouer, sortis des portes par l'humain (ADR 0066). À mettre à jour après le cycle.",
          "",
          "| Test | Scénario | Raison |",
          "| --- | --- | --- |",
          ...obsoletes.map((x) => `| ${cellule(x.test)} | ${x.scenario} | ${cellule(x.raison)} |`),
          "",
        ]
      : []),
  ].join("\n");
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
    ...[ligneValeursRetirees(s.openQuestions)].filter((l): l is string => l !== null),
    ...(s.verifications?.length ? [`Vérifications par les agents (ADR 0082) : ${s.verifications.map((v) => `${v.phase ?? "?"} ${v.role} ${v.appels} appel(s)`).join(" ; ")}.`] : []),
    ...(s.nonCommitees?.length ? [`Phases non commitées : ${s.nonCommitees.join(", ")} (commit impossible ; leurs fichiers sont inclus dans le commit suivant, ou restent à commiter).`] : []),
    ...(s.derogationsCouverture?.length
      ? [`Lignes exemptées de la couverture du diff : ${s.derogationsCouverture.length} (détail dans .skraft/${s.slug}/deliver/derogations.md).`]
      : []),
    ...(s.derogations?.length
      ? [
          `Dérogations de mutation : ${s.derogations.length} (détail dans .skraft/${s.slug}/deliver/derogations.md).`,
          ...s.derogations.map((x) => `- ${x.file}:${x.line} (${x.operator}), par ${x.par} : ${x.raison}`),
        ]
      : []),
    ...(s.ecartsAuPlan?.length
      ? [
          `Écarts au plan de test : ${s.ecartsAuPlan.length} (détail dans .skraft/${s.slug}/deliver/ecarts-au-plan.md).`,
          ...s.ecartsAuPlan.map((x) => `- ${x.criterion} (${x.par}) : ${x.planned} → ${x.actual} — ${x.rule}`),
        ]
      : []),
    ...notesDuBilan(s),
    `Identifiant de suivi : ${randomUUID().slice(0, 8)}.`,
  ].join("\n");
}
