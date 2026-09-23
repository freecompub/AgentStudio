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
import { assemble, createProject, git, put, researchDoc, shutdownHosts, simulatedAgents, stateOf, until } from "./support/harness.js";

describe("skraft — critères de sortie de S2 (RESEARCH)", () => {
  let root: string;
  let tasksDir: string;
  beforeEach(async () => {
    root = await createProject();
    // Fichier de 55 lignes, comme dans la fixture de §13.2.
    await put(root, "Sources/Domain/BolusCalculator.swift", Array.from({ length: 55 }, (_, i) => `// ligne ${i + 1}`).join("\n") + "\n");
    git(root, "commit", "-qam", "calculateur");
    tasksDir = await mkdtemp(join(tmpdir(), "agent-studio-skraft-tasks-"));
  });
  afterEach(async () => {
    await shutdownHosts();
    await rm(root, { recursive: true, force: true });
    await rm(tasksDir, { recursive: true, force: true });
  });

  it("citation hors limites rejetée avec le motif exact, corrigée au réessai ; questions posées ; réponse transmise à DESIGN", async () => {
    const researchPrompts: string[] = [];
    let designBrief = "";
    const researcher: ScriptedBehavior = async (t) => {
      researchPrompts.push(t.prompt);
      const bad = researchPrompts.length === 1;
      await put(
        root,
        ".skraft/us-12/research/research.md",
        researchDoc({ Découvertes: bad ? "Le calcul vit dans `Sources/Domain/BolusCalculator.swift:40-72`." : "Le calcul vit dans `Sources/Domain/BolusCalculator.swift:40-55`." }),
      );
      await t.callTool("report_phase", { summary: "recherche écrite", files: [".skraft/us-12/research/research.md"] });
    };
    const model: ScriptedBehavior = async (t) => {
      designBrief = t.prompt;
      await put(root, ".skraft/us-12/design/event-model.md", "`BolusCapped`\n");
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

    // Présélection par le code dans le dossier de passation de RESEARCH.
    await until(async () => researchPrompts.length >= 1);
    expect(researchPrompts[0]).toContain("Fichiers utiles (présélection) :");
    expect(researchPrompts[0]).toContain("Sources/Domain/BolusCalculator.swift");

    // Porte citations : rejet précis, relance ciblée, puis questions posées à la fin de RESEARCH.
    await until(async () => (await app.interactions.pending()).filter((p) => p.title.startsWith("Question ouverte")).length === 2);
    expect(researchPrompts).toHaveLength(2);
    expect(researchPrompts[1]).toContain("Rejet précédent :");
    expect(researchPrompts[1]).toContain("`Sources/Domain/BolusCalculator.swift:40-72` : plage hors du fichier, qui compte 55 lignes.");
    const questions = (await app.interactions.pending()).filter((p) => p.title.startsWith("Question ouverte"));
    expect(questions.map((q) => q.detail)).toEqual(["Le plafond s'applique-t-il par prise ou par jour ?", "Le plafond est-il rappelé au patient ?"]);
    expect(questions[0]).toMatchObject({ freeText: true, requiredRoles: ["po", "developpeur", "architecte", "administrateur"] });
    expect(stateOf(await app.engine.status(id))).toMatchObject({ stage: "ROUTE", phasesCompleted: ["RESEARCH"] });

    // Un testeur ne peut pas trancher une question métier (§11) ; le PO répond, puis reporte l'autre.
    await expect(app.interactions.respond(questions[0]!.id, questions[0]!.options[0]!.id, "par prise", { role: "testeur" })).rejects.toThrow(/PO \/ BA/);
    await app.interactions.respond(questions[0]!.id, "answer:q1", "par prise", { role: "po" });
    await app.interactions.respond(questions[1]!.id, "defer:q2", undefined, { role: "po" });

    // DESIGN démarre, avec les réponses dans le dossier de passation.
    await until(async () => designBrief !== "");
    expect(designBrief).toContain("Réponses de l'utilisateur :");
    expect(designBrief).toContain("Le plafond s'applique-t-il par prise ou par jour ? → par prise");
    expect(designBrief).toContain("Le plafond est-il rappelé au patient ? → (question reportée par l'utilisateur)");

    await until(async () => stateOf(await app.engine.status(id))?.stage === "DONE", 60_000);
    expect(stateOf(await app.engine.status(id))!.artifacts.RESEARCH.map((a) => [a.path, a.attempt])).toEqual([[".skraft/us-12/research/research.md", 2]]);
  }, 120_000);

  it("recherche sans document : rejet explicite", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-researcher": async (t) => void (await t.callTool("report_phase", { summary: "rien", files: [] })),
    });
    const app = await assemble(root, runtime, tasksDir);
    await app.registry.command("skraft")!.handler("--auto stories/us-12.md");
    await until(async () => stateOf((await app.engine.list())[0] ?? null)?.stage === "ESCALATED", 60_000);
    const s = stateOf((await app.engine.list())[0]!)!;
    expect(s.lastRejection).toEqual({ gate: "citations", reasons: ["Document de recherche absent : .skraft/us-12/research/research.md"] });
  }, 60_000);
});
