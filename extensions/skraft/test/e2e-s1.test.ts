/**
 * Critères de sortie de S1 (SPEC-skraft §14) :
 *  - pipeline complet à vide avec agents simulés ;
 *  - saut de RESEARCH par règle ;
 *  - reprise après redémarrage à chaque stage.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptanceWriter, answerQuestions, assemble, createProject, fakeStack, git, type HangPoint, put, researchDoc, ROLE, shutdownHosts, simulatedAgents, stateOf, unitTestWriter, until } from "./support/harness.js";

type App = Awaited<ReturnType<typeof assemble>>;

/** Répond à la confirmation de difficulté en retenant le niveau proposé ; les questions ouvertes sont répondues au fil de l'eau. */
async function confirmDifficulty(app: App) {
  answerQuestions(app);
  await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
  const req = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
  await app.interactions.respond(req.id, req.options[0]!.id);
}

async function done(app: App, id: string) {
  await until(async () => ["DONE", "ABORTED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 60_000);
  await app.engine.idle(id);
}

async function taskId(app: App): Promise<string> {
  await until(async () => (await app.engine.list()).length > 0);
  return (await app.engine.list())[0]!.id;
}

describe("skraft — critères de sortie de S1", () => {
  let root: string;
  let tasksDir: string;
  beforeEach(async () => {
    root = await createProject();
    tasksDir = await mkdtemp(join(tmpdir(), "agent-studio-skraft-tasks-"));
  });
  afterEach(async () => {
    await shutdownHosts();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(tasksDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it.each(["failed", "skipped", "exit", "timeout"] as const)("précontrôle %s : bloque avant le classifieur, sans appel LLM", async (status) => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root);
    const stack = fakeStack();
    stack.runTests = async () => ({
      results: [{ id: "test existant", file: "tests/existing.test.ts", status: status === "failed" || status === "skipped" ? status : "passed" }],
      exitCode: status === "exit" ? 1 : 0, timedOut: status === "timeout", output: "", durationMs: 1,
    });
    const app = await assemble(root, runtime, tasksDir, { stack, isolated: true });
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    const id = await taskId(app);
    await until(async () => stateOf(await app.engine.status(id))?.stage === "ESCALATED");
    expect(runtime.history).toEqual([]);
    expect(app.posted.join("\n")).toContain("bloqué avant tout appel");
  });

  it("la dette de couverture initiale est notifiée mais ne bloque pas le classifieur", async () => {
    await put(root, ".skraft/quality.json", '{"coverage":{"core":90}}\n');
    const runtime = simulatedAgents(new ScriptedRuntime(), root);
    const stack = fakeStack();
    stack.runTests = async () => ({
      results: [], exitCode: 0, timedOut: false, output: "", durationMs: 1,
      coverage: { files: [{ file: "src/domain/bolus-calculator.ts", covered: 1, total: 2, score: 50 }] },
    });
    const app = await assemble(root, runtime, tasksDir, { stack, isolated: true });
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    expect(app.posted.join("\n")).toContain("avertissement non bloquant");
    expect(app.posted.join("\n")).toContain("50 % (minimum 90 %)");
    expect(runtime.history).toHaveLength(1);
  });

  it.each([true, false])("couverture du diff en isolation : ligne modifiée couverte=%s, dette historique inchangée", async (covered) => {
    const before = "export class BolusCalculator {}\n\n\n\n\n\n\n// propriété existante non couverte\n";
    await put(root, "src/domain/bolus-calculator.ts", before);
    await put(root, ".skraft/quality.json", '{"coverage":{"core":90},"mutation":{"active":false}}\n');
    const stack = fakeStack();
    const original = stack.runTests;
    stack.runTests = async (opts) => ({
      ...await original(opts),
      coverage: { files: [
        { file: "src/domain/bolus-calculator.ts", covered: covered ? 1 : 0, total: 2, score: covered ? 50 : 0, lines: [{ number: 1, covered }, { number: 8, covered: false }] },
        { file: "src/domain/bolus-cap.ts", covered: 1, total: 1, score: 100, lines: [{ number: 1, covered: true }] },
      ] },
    });
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-dev": async (t) => {
        await put(root, "src/domain/bolus-calculator.ts", before.replace("{}", "{ /* raccordement */ }"));
        await put(root, "src/domain/bolus-cap.ts", "export class BolusCap {}\n");
        await t.callTool("report_phase", { summary: "code", files: [] });
      },
    });
    const app = await assemble(root, runtime, tasksDir, { stack, isolated: true });
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    const id = await taskId(app);
    await confirmDifficulty(app);
    await until(async () => ["DONE", "ESCALATED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 60_000);
    const state = stateOf(await app.engine.status(id))!;
    expect(state.stage).toBe(covered ? "DONE" : "ESCALATED");
    if (covered) {
      expect(state.deliver?.facts?.join("\n")).toContain("Couverture du diff (tâche) : src/domain/bolus-calculator.ts à 100 %");
      expect(app.posted.join("\n")).toContain("avertissement non bloquant");
    } else {
      expect(state.escalation?.reason).toContain("Lignes non couvertes : 1.");
      expect(state.escalation?.reason).not.toContain("non couvertes : 8");
    }
  }, 90_000);

  // D5 (docs/12) : une source écrite en DISTILL n'est vue que par la porte de fin de DELIVER. Les
  // scénarios étant verts, rejouer la phase ne ferait travailler personne : le motif va au testeur.
  it("couverture du diff en fin de DELIVER sur une source de DISTILL : correction ciblée par le testeur, puis livré", async () => {
    await put(root, ".skraft/quality.json", '{"coverage":{"core":90},"mutation":{"active":false}}\n');
    const stack = fakeStack();
    const original = stack.runTests;
    // La ligne du squelette n'est couverte qu'une fois le second test unitaire écrit.
    stack.runTests = async (opts) => {
      const unit = await readFile(join(root, "tests/unit/bolus-cap.test.ts"), "utf8").catch(() => "");
      const covered = unit.includes("plafond 2");
      return {
        ...await original(opts),
        coverage: { files: [
          { file: "src/domain/bolus-stub.ts", covered: covered ? 1 : 0, total: 1, score: covered ? 100 : 0, lines: [{ number: 1, covered }] },
          { file: "src/domain/bolus-cap.ts", covered: 1, total: 1, score: 100, lines: [{ number: 1, covered: true }] },
        ] },
      };
    };
    const testPrompts: string[] = [];
    const writeTest = unitTestWriter(root);
    const accept = acceptanceWriter(root);
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-acceptance": async (t) => {
        await put(root, "src/domain/bolus-stub.ts", "export const plafond = (dose: number, max: number) => Math.min(dose, max);\n");
        await accept(t);
      },
      "skraft-test": async (t) => {
        testPrompts.push(t.prompt);
        await writeTest(t);
      },
    });
    const app = await assemble(root, runtime, tasksDir, { stack, isolated: true });
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    const id = await taskId(app);
    await confirmDifficulty(app);
    await until(async () => ["DONE", "ESCALATED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 60_000);
    expect(stateOf(await app.engine.status(id))!.stage).toBe("DONE");
    const correction = testPrompts.find((p) => p.includes("[couverture#"));
    expect(correction).toMatch(/\[couverture#\d+\.1, major, test\].*src\/domain\/bolus-stub\.ts.*Lignes non couvertes : 1\..*test qui exerce/s);
  }, 90_000);

  // D5 (docs/12) : revue de DELIVER sans défaut bloquant ni majeur, alors que tout est vert.
  it("revue de DELIVER à défauts mineurs seulement : le développeur les corrige, puis livré", async () => {
    let deliverReviews = 0;
    const devPrompts: string[] = [];
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-dev": async (t) => {
        devPrompts.push(t.prompt);
        // En correction, le développeur renomme : un pas de correction doit modifier le code.
        const corrige = t.prompt.includes("mineur1");
        await put(root, "src/domain/bolus-cap.ts", corrige ? "export class PlafondDeBolus {}\nexport { PlafondDeBolus as BolusCap };\n" : "export class BolusCap {}\n");
        await t.callTool("report_phase", { summary: "code", files: ["src/domain/bolus-cap.ts"] });
      },
      "skraft-lens-cold-reader": async (t) => {
        const premiere = t.prompt.includes("phase DELIVER") && deliverReviews++ === 0;
        await t.callTool("submit_lens_verdict", premiere
          ? { lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [{ severity: "minor", description: "nom vague : BolusCap", target: "code" }] }
          : { lens: "cold-reader", verdict: "APPROVED", defects: [] });
      },
    });
    const app = await assemble(root, runtime, tasksDir, { isolated: true });
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    const id = await taskId(app);
    await confirmDifficulty(app);
    await until(async () => ["DONE", "ESCALATED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 60_000);
    expect(stateOf(await app.engine.status(id))!.stage).toBe("DONE");
    expect(devPrompts.some((p) => p.includes("[cold-reader#1.mineur1, minor, code] nom vague : BolusCap"))).toBe(true);
  }, 90_000);

  it("revue de DELIVER « changements demandés » sans aucun défaut : escalade, personne à qui l'adresser", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-lens-cold-reader": async (t) => {
        await t.callTool("submit_lens_verdict", t.prompt.includes("phase DELIVER")
          ? { lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [] }
          : { lens: "cold-reader", verdict: "APPROVED", defects: [] });
      },
    });
    const app = await assemble(root, runtime, tasksDir, { isolated: true });
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    const id = await taskId(app);
    await confirmDifficulty(app);
    await until(async () => stateOf(await app.engine.status(id))?.stage === "ESCALATED", 60_000);
    const s = stateOf(await app.engine.status(id))!;
    expect(s.escalation?.reason).toContain("Revue sans défaut à corriger");
  }, 90_000);

  it("plan de test absent : rejet tracé sous sa propre porte, pas sous « valeurs » (D11)", async () => {
    let essais = 0;
    const accept = acceptanceWriter(root);
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-acceptance": async (t) => {
        await accept(t);
        if (essais++ === 0) await rm(join(root, ".skraft/us-12/distill/test-plan.md"));
      },
    });
    const app = await assemble(root, runtime, tasksDir, { isolated: true });
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    const id = await taskId(app);
    await confirmDifficulty(app);
    await until(async () => ["DONE", "ESCALATED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 60_000);
    expect(stateOf(await app.engine.status(id))!.stage).toBe("DONE");
    const rejets = (await app.trace.list(id)).filter((e) => e.kind === "rejet");
    expect(rejets).toContainEqual(expect.objectContaining({ porte: "plan de test", motifs: ["Plan de test absent : .skraft/us-12/distill/test-plan.md"] }));
  }, 90_000);

  it.each([false, true])("pipeline complet à vide (extension isolée : %s) : US-12 medium-hard, quatre phases, revues, commits sur skraft/us-12", async (isolated) => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root);
    const app = await assemble(root, runtime, tasksDir, { isolated });
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    const id = await taskId(app);
    await confirmDifficulty(app);
    await done(app, id);

    const s = stateOf(await app.engine.status(id))!;
    expect(s.stage).toBe("DONE");
    expect(s.difficulty).toMatchObject({ level: "medium-hard", confirmedBy: "user", indicators: { acceptanceCriteria: 3, modulesTouched: 2, openBusinessQuestions: 1 } });
    expect(s.phasesCompleted).toEqual(["RESEARCH", "DESIGN", "DISTILL", "DELIVER"]);
    expect(s.skipPhases).toEqual([]);
    expect(s.reviews.DESIGN.map((r) => r.verdict)).toEqual(["APPROVED"]);
    expect(s.artifacts.RESEARCH.map((a) => a.path)).toEqual([".skraft/us-12/research/research.md"]);

    expect(git(root, "branch", "--show-current")).toBe("skraft/us-12");
    expect(git(root, "log", "--format=%s", `${s.baseSha}..HEAD`).split("\n")).toEqual([
      "feat(us-12): livraison de la story",
      "feat(us-12): ac-1",
      "test(us-12): ac-1, tests/unit/bolus-cap.test.ts > plafond 1",
      "docs(skraft): distill de us-12",
      "docs(skraft): design de us-12",
      "docs(skraft): research de us-12",
    ]);
    // Rapports de revue générés par le code depuis les JSON des lentilles.
    const report = JSON.parse(await readFile(join(root, ".skraft/us-12/reviews/design-review-1.json"), "utf8"));
    // Trois lentilles en DESIGN : `quality-gates` est écartée d'une phase où rien n'est mesuré (ADR 0028).
    expect(report.map((l: { lens: string }) => l.lens)).toEqual(["cold-reader", "test-integrity", "architecture"]);
    const deliverReport = JSON.parse(await readFile(join(root, ".skraft/us-12/reviews/deliver-review-1.json"), "utf8"));
    // Elle siège en revanche en DELIVER, où le code a vraiment exécuté des tests.
    expect(deliverReport.map((l: { lens: string }) => l.lens)).toContain("quality-gates");
    // DELIVER : un scénario moteur, les deux autres déjà verts ; constats transmis aux lentilles.
    expect(s.deliver?.scenarios.map((x) => [x.id, x.status])).toEqual([["ac-1", "done"], ["ac-2", "done"], ["ac-3", "done"]]);
    // Ce que la porte n'a pas pu mesurer est dit, jamais supposé conforme.
    // La mutation tourne en fin de DELIVER (ADR 0049) : sa note arrive après celles des scénarios.
    expect(s.deliver?.notes).toEqual([
      "Couverture non mesurée : la commande de test du projet n'en produit pas.",
      "Qualité de forme non mesurée : le projet n'a pas de linter configuré pour cette stack.",
      "Règle de dépendance non vérifiée : la stack du projet ne sait pas analyser les imports.",
      "Mutation non mesurée : la stack du projet ne propose pas d'outil de mutation.",
    ]);
    expect(app.posted.at(-1)).toMatch(/Pipeline skraft terminé pour \*\*US-12\*\*/);
    // Usage par état (D37).
    expect((await app.usage.report(id)).map((r) => r.phase)).toEqual(expect.arrayContaining(["CLASSIFY", "RESEARCH", "DESIGN", "REVIEW", "DELIVER"]));
  }, 120_000);

  it("saut de RESEARCH par règle : une story simple commence par la conception", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root);
    const app = await assemble(root, runtime, tasksDir);
    await app.registry.command("skraft")!.handler("stories/us-7.md");
    const id = await taskId(app);
    await confirmDifficulty(app);
    await done(app, id);

    const s = stateOf(await app.engine.status(id))!;
    expect(s.difficulty?.level).toBe("simple");
    expect(s.skipPhases).toEqual(["RESEARCH"]);
    expect(s.phasesCompleted).toEqual(["DESIGN", "DISTILL", "DELIVER"]);
    expect(runtime.history.map((x) => runtime.configs.get(x.id)?.role)).not.toContain(ROLE("skraft-researcher"));
    // Niveau simple : deux lentilles seulement, budget de 2.
    expect(s.reviews.DESIGN[0]?.lenses.map((l) => l.lens)).toEqual(["cold-reader", "test-integrity"]);
    expect(s.budget.maxAttemptsPerPhase).toBe(2);
  }, 60_000);

  it("story invalide : escalade avec la raison, sans rien exécuter", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root);
    const app = await assemble(root, runtime, tasksDir);
    await app.registry.command("skraft")!.handler("stories/absente.md");
    const id = await taskId(app);
    await app.engine.idle(id);
    expect(stateOf(await app.engine.status(id))?.stage).toBe("ESCALATED");
    expect((await app.interactions.pending())[0]?.detail).toMatch(/Story introuvable/);
  });

  /** Point d'arrêt : comment « planter » le premier processus, et le stage attendu à ce moment. */
  const CRASHES: { name: string; stage: string; phase?: string; hang?: HangPoint; hungRole?: string; waitDifficulty?: boolean }[] = [
    { name: "INIT (lecture de la story)", stage: "INIT", hang: "readStory" },
    { name: "CLASSIFY", stage: "CLASSIFY", hungRole: "skraft-classifier" },
    { name: "CONFIRM_DIFFICULTY (en attente)", stage: "CONFIRM_DIFFICULTY", waitDifficulty: true },
    { name: "SPECIALIST RESEARCH", stage: "SPECIALIST", phase: "RESEARCH", hungRole: "skraft-researcher" },
    { name: "SPECIALIST DESIGN (décisions)", stage: "SPECIALIST", phase: "DESIGN", hungRole: "skraft-architect-decide" },
    { name: "ARTIFACT_GATE", stage: "ARTIFACT_GATE", phase: "DESIGN", hang: "changedFiles" },
    { name: "REVIEW", stage: "REVIEW", phase: "DESIGN", hungRole: "skraft-lens-architecture" },
    { name: "COMMIT", stage: "COMMIT", phase: "RESEARCH", hang: "commit" },
    { name: "SPECIALIST DELIVER", stage: "SPECIALIST", phase: "DELIVER", hungRole: "skraft-dev" },
  ];

  it.each(CRASHES)("reprise après redémarrage en $name", async (c) => {
    // Premier processus : s'arrête au point voulu (agent muet, opération qui ne rend pas la main, ou attente).
    const first = simulatedAgents(new ScriptedRuntime(), root, c.hungRole ? { [c.hungRole]: (t) => t.hang() } : {});
    const app1 = await assemble(root, first, tasksDir, c.hang ? { hang: c.hang } : {});
    await app1.registry.command("skraft")!.handler("stories/us-12.md");
    const id = await taskId(app1);
    if (c.stage !== "INIT" && c.stage !== "CLASSIFY" && !c.waitDifficulty) await confirmDifficulty(app1);
    await until(async () => {
      const r = await app1.engine.status(id);
      const s = stateOf(r);
      const settled = c.waitDifficulty ? r?.status === "waiting" : !!r?.inflight;
      // Agent muet : le processus n'est « planté » qu'une fois la session de ce rôle ouverte.
      const hung = c.hungRole ? first.history.some((h) => first.configs.get(h.id)?.role === ROLE(c.hungRole!)) : true;
      return s?.stage === c.stage && (c.phase ? s.phase === c.phase : true) && settled && hung;
    });

    // Redémarrage : nouveaux services sur le même dépôt et les mêmes stockages, agents sains.
    const second = simulatedAgents(new ScriptedRuntime(), root);
    const app2 = await assemble(root, second, tasksDir);
    answerQuestions(app2);
    await app2.engine.resumeAll();
    if (["INIT", "CLASSIFY", "CONFIRM_DIFFICULTY"].includes(c.stage)) await confirmDifficulty(app2);
    await done(app2, id);

    const s = stateOf(await app2.engine.status(id))!;
    expect(s.phasesCompleted).toEqual(["RESEARCH", "DESIGN", "DISTILL", "DELIVER"]);
    // Aucune phase commitée deux fois : l'effet interrompu a été rejoué depuis son checkpoint.
    const log = git(root, "log", "--format=%s", `${s.baseSha}..HEAD`).split("\n");
    expect(new Set(log).size).toBe(log.length);
    expect(log).toHaveLength(6);
  }, 120_000);

  it("blocage d'un agent : question persistée, réponse après redémarrage, relance avec la réponse", async () => {
    let asked = false;
    const first = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-researcher": async (t) => {
        asked = true;
        await t.callTool("report_blocker", { question: "Le plafond est-il par prise ou par jour ?", choices: ["par prise", "par jour"] });
      },
    });
    const app1 = await assemble(root, first, tasksDir);
    await app1.registry.command("skraft")!.handler("stories/us-12.md");
    const id = await taskId(app1);
    await confirmDifficulty(app1);
    await until(async () => stateOf(await app1.engine.status(id))?.stage === "BLOCKED");
    expect(asked).toBe(true);

    let briefAfterAnswer = "";
    const second = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-researcher": async (t) => {
        briefAfterAnswer = t.prompt;
        const { put } = await import("./support/harness.js");
        await put(root, ".skraft/us-12/research/research.md", researchDoc());
        await t.callTool("report_phase", { summary: "ok", files: [] });
      },
    });
    const app2 = await assemble(root, second, tasksDir);
    answerQuestions(app2);
    await app2.engine.resumeAll();
    const question = (await app2.interactions.pending()).find((p) => p.title.startsWith("Question de l'agent"));
    expect(question?.detail).toBe("Le plafond est-il par prise ou par jour ?");
    await app2.interactions.respond(question!.id, "par prise", undefined, { role: "po" });
    await done(app2, id);
    expect(briefAfterAnswer).toContain("Le plafond est-il par prise ou par jour ? → par prise");
    expect(stateOf(await app2.engine.status(id))?.stage).toBe("DONE");
  }, 120_000);
});
