/**
 * Critères de sortie de S2 (SPEC-skraft §14) sur le fil rouge US-12 :
 *  - la citation hors limites est rejetée par la porte citations ;
 *  - la question ouverte est posée, et sa réponse figure dans le dossier de passation de DESIGN.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, git, put, researchDoc, shutdownHosts, simulatedAgents, stateOf, until } from "./support/harness.js";

describe("skraft — critères de sortie de S2 (RESEARCH)", () => {
  let root: string;
  let tasksDir: string;
  beforeEach(async () => {
    root = await createProject();
    // Fichier de 55 lignes, comme dans la fixture de §13.2.
    await put(root, "src/domain/bolus-calculator.ts", ["export class BolusCalculator {}", ...Array.from({ length: 54 }, (_, i) => `// ligne ${i + 2}`)].join("\n") + "\n");
    git(root, "commit", "-qam", "calculateur");
    tasksDir = await mkdtemp(join(tmpdir(), "agent-studio-skraft-tasks-"));
  });
  afterEach(async () => {
    await shutdownHosts();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(tasksDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("citation hors limites rejetée avec le motif exact, corrigée au réessai ; questions posées ; réponse transmise à DESIGN", async () => {
    const researchPrompts: string[] = [];
    let designBrief = "";
    const researcher: ScriptedBehavior = async (t) => {
      researchPrompts.push(t.prompt);
      const bad = researchPrompts.length === 1;
      await put(
        root,
        ".skraft/us12-f15ade30/research/research.md",
        researchDoc({ Découvertes: bad ? "Le calcul vit dans `src/domain/bolus-calculator.ts:40-72`." : "Le calcul vit dans `src/domain/bolus-calculator.ts:40-55`." }),
      );
      await t.callTool("report_phase", { summary: "recherche écrite", files: [".skraft/us12-f15ade30/research/research.md"] });
    };
    const model: ScriptedBehavior = async (t) => {
      designBrief = t.prompt;
      await put(root, ".skraft/us12-f15ade30/design/event-model.md", "`BolusCapped`\n");
      await t.callTool("report_phase", { summary: "modèle", files: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-researcher": researcher, "skraft-architect-model": model });
    const app = await assemble(root, runtime, tasksDir);
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;

    // Difficulté confirmée : medium-hard, RESEARCH exécutée.
    await until(async () => (await app.interactions.pending()).length === 1);
    const [difficulty] = await app.interactions.pending();
    await app.interactions.respond(difficulty!.id, "medium-hard");

    // Décision du 08/11 : la question de la story est posée AVANT RESEARCH, pour que le chercheur
    // reçoive sa réponse au lieu de s'arrêter pour la poser.
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Question ouverte")));
    const [avant] = (await app.interactions.pending()).filter((p) => p.title.startsWith("Question ouverte"));
    expect(avant).toMatchObject({ detail: "Le plafond s'applique-t-il par prise ou par jour ?", freeText: true });
    expect(avant).not.toHaveProperty("requiredRoles"); // ADR 0087 : n'importe qui répond
    expect(stateOf(await app.engine.status(id))).toMatchObject({ stage: "ROUTE", phasesCompleted: [] });
    expect(researchPrompts).toHaveLength(0);
    // N'importe qui répond (ADR 0087).
    await app.interactions.respond(avant!.id, "answer:q1", "par prise");

    // Présélection par le code, et la réponse, dans le dossier de passation de RESEARCH.
    await until(async () => researchPrompts.length >= 1);
    expect(researchPrompts[0]).toContain("Fichiers utiles (présélection) :");
    expect(researchPrompts[0]).toContain("src/domain/bolus-calculator.ts");
    expect(researchPrompts[0]).toContain("Le plafond s'applique-t-il par prise ou par jour ? → par prise");

    // Porte citations : rejet précis, relance ciblée, puis la seule question de la recherche, posée à la fin de RESEARCH.
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Question ouverte")));
    expect(researchPrompts).toHaveLength(2);
    expect(researchPrompts[1]).toContain("Rejet précédent :");
    expect(researchPrompts[1]).toContain("`src/domain/bolus-calculator.ts:40-72` : plage hors du fichier, qui compte 55 lignes.");
    const questions = (await app.interactions.pending()).filter((p) => p.title.startsWith("Question ouverte"));
    expect(questions.map((q) => q.detail)).toEqual(["Le plafond est-il rappelé au patient ?"]);
    expect(stateOf(await app.engine.status(id))).toMatchObject({ stage: "ROUTE", phasesCompleted: ["RESEARCH"] });
    await app.interactions.respond(questions[0]!.id, "defer:q2");

    // DESIGN démarre, avec les réponses dans le dossier de passation.
    await until(async () => designBrief !== "");
    expect(designBrief).toContain("Réponses de l'utilisateur (écrites dans `.skraft/us12-f15ade30/passation.md`, à citer comme source) :");
    expect(designBrief).toContain("Le plafond s'applique-t-il par prise ou par jour ? → par prise");
    expect(designBrief).toContain("Le plafond est-il rappelé au patient ? → (question reportée par l'utilisateur)");
    // La recherche validée est transmise par le code, pas seulement son chemin (skraft-plugin v1.15.1).
    expect(designBrief).toContain("`BolusCalculator` → `src/domain/bolus-calculator.ts`");
    // Pile tirée de l'adaptateur, et architecture par défaut faute d'argument (docs/15 §5).
    expect(designBrief).toContain("Pile du projet : typescript ;");
    expect(designBrief).toContain("Architecture du projet : clean architecture par défaut, skill `architecture-patterns`.");

    await until(async () => stateOf(await app.engine.status(id))?.stage === "DONE", 60_000);
    expect(stateOf(await app.engine.status(id))!.artifacts.RESEARCH.map((a) => [a.path, a.attempt])).toEqual([[".skraft/us12-f15ade30/research/research.md", 2]]);
  }, 120_000);

  it("recherche sans document : rejet explicite", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-researcher": async (t) => void (await t.callTool("report_phase", { summary: "rien", files: [] })),
    });
    const app = await assemble(root, runtime, tasksDir);
    // La question de la story est posée avant RESEARCH (08/11) : le répondeur la tranche.
    answerQuestions(app);
    await app.registry.command("skraft")!.handler("--auto stories/us-12.md");
    await until(async () => stateOf((await app.engine.list())[0] ?? null)?.stage === "ESCALATED", 60_000);
    const s = stateOf((await app.engine.list())[0]!)!;
    // Le même refus deux fois de suite : le disjoncteur escalade au deuxième essai (ADR 0073).
    expect(s.lastRejection).toEqual({ gate: "citations", reasons: ["Même refus deux fois de suite : Document de recherche absent : .skraft/us12-f15ade30/research/research.md"] });
    expect(s.attempts).toBe(2);
  }, 60_000);

  // 08/11 : l'architecte qui décide reçoit la liste des noms que la porte de cohérence acceptera.
  it("DESIGN : l'architecte qui décide reçoit les noms du modèle écrit juste avant lui", async () => {
    let briefDecide = "";
    const decide: ScriptedBehavior = async (t) => {
      briefDecide = t.prompt;
      await put(root, ".skraft/us12-f15ade30/design/contracts.md", "`BolusCapped`\n");
      await t.callTool("report_phase", { summary: "contrats", files: [".skraft/us12-f15ade30/design/contracts.md"] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-architect-decide": decide });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft")!.handler("--auto stories/us-12.md");
    await until(async () => briefDecide !== "", 60_000);
    expect(briefDecide).toContain("Noms définis par le modèle (`.skraft/us12-f15ade30/design/event-model.md`, `.skraft/us12-f15ade30/design/domain-model.md`) : `BolusCapped`.");
  }, 90_000);
});
