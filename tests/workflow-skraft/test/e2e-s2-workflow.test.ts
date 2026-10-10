// Repris de extensions/skraft-workflow/test/e2e-s2-workflow.test.ts (2026-10-10) : teste le workflow en dossier (ADR 0055).
/**
 * Jumeau de `extensions/skraft/test/e2e-s2.test.ts` pour `/skraft-workflow` (ADR 0052, `docs/09`
 * §14 étape 4), dans une extension indépendante de skraft : même
 * scénario US-12, mêmes vérifications sur ce que voient les agents et les humains. Seuls changent
 * la commande, les identifiants d'options et ce qui suit RESEARCH (le workflow s'arrête avant
 * DESIGN et publie le dossier de passation que DESIGN recevrait).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, fakeSwiftStack, git, put, researchDoc, shutdownHosts, simulatedAgents, until } from "./support/harness.js";

describe("skraft en workflow — critères de S2 (RESEARCH), script isolé", () => {
  let root: string;
  let tasksDir: string;
  beforeEach(async () => {
    root = await createProject();
    await put(root, "Sources/Domain/BolusCalculator.swift", Array.from({ length: 55 }, (_, i) => `// ligne ${i + 1}`).join("\n") + "\n");
    git(root, "commit", "-qam", "calculateur");
    tasksDir = await mkdtemp(join(tmpdir(), "agent-studio-skraft-tasks-"));
  });
  afterEach(async () => {
    await shutdownHosts();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(tasksDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it.each(["failed", "skipped", "exit", "timeout"] as const)("précontrôle %s : bloque avant le classifieur, sans appel LLM", async (status) => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root);
    const stack = fakeSwiftStack();
    stack.runTests = async () => ({
      results: [{ id: "test existant", file: "Tests/Existing.swift", status: status === "failed" || status === "skipped" ? status : "passed" }],
      exitCode: status === "exit" ? 1 : 0, timedOut: status === "timeout", output: "", durationMs: 1,
    });
    const app = await assemble(root, runtime, tasksDir, { stack });
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => app.posted.some((p) => p.includes("bloqué avant tout appel")));
    expect(runtime.history).toEqual([]);
    expect((await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté"))).toBe(false);
  });

  it("la dette de couverture initiale est notifiée mais ne bloque pas le classifieur", async () => {
    await put(root, ".skraft/quality.json", '{"coverage":{"core":90}}\n');
    const runtime = simulatedAgents(new ScriptedRuntime(), root);
    const stack = fakeSwiftStack();
    stack.runTests = async () => ({
      results: [], exitCode: 0, timedOut: false, output: "", durationMs: 1,
      coverage: { files: [{ file: "Sources/Domain/BolusCalculator.swift", covered: 1, total: 2, score: 50 }] },
    });
    const app = await assemble(root, runtime, tasksDir, { stack });
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    expect(app.posted.join("\n")).toContain("avertissement non bloquant");
    expect(app.posted.join("\n")).toContain("50 % (minimum 90 %)");
    expect(runtime.history).toHaveLength(1);
  });

  it.each([true, false])("couverture du diff en isolation : ligne modifiée couverte=%s, dette historique inchangée", async (covered) => {
    const before = "public struct BolusCalculator {}\n\n\n\n\n\n\n// propriété existante non couverte\n";
    await put(root, "Sources/Domain/BolusCalculator.swift", before);
    await put(root, ".skraft/quality.json", '{"coverage":{"core":90},"mutation":{"active":false}}\n');
    const stack = fakeSwiftStack();
    const original = stack.runTests;
    stack.runTests = async (opts) => ({
      ...await original(opts),
      coverage: { files: [
        { file: "Sources/Domain/BolusCalculator.swift", covered: covered ? 1 : 0, total: 2, score: covered ? 50 : 0, lines: [{ number: 1, covered }, { number: 8, covered: false }] },
        { file: "Sources/Domain/BolusCap.swift", covered: 1, total: 1, score: 100, lines: [{ number: 1, covered: true }] },
      ] },
    });
    let deliverReview = "";
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-dev": async (t) => {
        await put(root, "Sources/Domain/BolusCalculator.swift", before.replace("{}", "{ /* raccordement */ }"));
        await put(root, "Sources/Domain/BolusCap.swift", "public struct BolusCap {}\n");
        await t.callTool("report_phase", { summary: "code", files: [] });
      },
      "skraft-lens-test-integrity": async (t) => {
        if (t.prompt.includes("phase DELIVER")) deliverReview = t.prompt;
        await t.callTool("submit_lens_verdict", { lens: "test-integrity", verdict: "APPROVED", defects: [] });
      },
    });
    const app = await assemble(root, runtime, tasksDir, { stack });
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const q = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(q.id, q.options.find((o) => o.id.endsWith(":medium-hard"))!.id);
    if (covered) {
      await until(async () => app.posted.some((p) => p.includes("Pipeline skraft terminé")), 60_000);
      expect(deliverReview).toContain("Couverture du diff (tâche) : Sources/Domain/BolusCalculator.swift à 100 %");
      expect(app.posted.join("\n")).toContain("avertissement non bloquant");
    } else {
      await until(async () => (await app.interactions.pending()).some((p) => p.detail?.includes("Lignes non couvertes : 1.")), 60_000);
      expect((await app.interactions.pending()).map((p) => p.detail).join("\n")).not.toContain("non couvertes : 8");
    }
  }, 90_000);

  it("citation hors limites rejetée avec le motif exact, corrigée au réessai ; questions posées ; réponses dans le dossier de DESIGN", async () => {
    const researchPrompts: string[] = [];
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
    let designBrief = "";
    const model: ScriptedBehavior = async (t) => {
      designBrief = t.prompt;
      await put(root, ".skraft/us-12/design/event-model.md", "`BolusCapped`\n");
      await t.callTool("report_phase", { summary: "modèle", files: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-researcher": researcher, "skraft-architect-model": model });
    const app = await assemble(root, runtime, tasksDir);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;

    // Difficulté confirmée : medium-hard, RESEARCH exécutée.
    await until(async () => (await app.interactions.pending()).length === 1);
    const [difficulty] = await app.interactions.pending();
    expect(difficulty!.title).toMatch(/^Difficulté de US-12 : /);
    await app.interactions.respond(difficulty!.id, difficulty!.options.find((o) => o.id.endsWith(":medium-hard"))!.id);

    // Présélection par le code dans le dossier de passation de RESEARCH.
    await until(async () => researchPrompts.length >= 1);
    expect(researchPrompts[0]).toContain("Fichiers utiles (présélection) :");
    expect(researchPrompts[0]).toContain("Sources/Domain/BolusCalculator.swift");

    // Porte citations : rejet précis, relance ciblée, puis questions posées à la fin de RESEARCH.
    await until(async () => (await app.interactions.pending()).filter((p) => p.title.startsWith("Question ouverte")).length === 2);
    expect(researchPrompts).toHaveLength(2);
    expect(researchPrompts[1]).toContain("Rejet précédent :");
    expect(researchPrompts[1]).toContain("`Sources/Domain/BolusCalculator.swift:40-72` : plage hors du fichier, qui compte 55 lignes.");
    // Le rejeu est tracé avec sa porte et son motif exact (docs/10 §4.3).
    const rejets = (await app.trace.list(id)).filter((e) => e.kind === "rejet");
    expect(rejets).toEqual([expect.objectContaining({ porte: "citations", motifs: ["`Sources/Domain/BolusCalculator.swift:40-72` : plage hors du fichier, qui compte 55 lignes."] })]);
    const questions = (await app.interactions.pending()).filter((p) => p.title.startsWith("Question ouverte"));
    expect(questions.map((q) => q.detail)).toEqual(["Le plafond s'applique-t-il par prise ou par jour ?", "Le plafond est-il rappelé au patient ?"]);
    expect(questions[0]).toMatchObject({ freeText: true, requiredRoles: ["po", "developpeur", "architecte", "administrateur"] });
    // Comme l'extension (stade ROUTE) : les questions ouvertes sont une étape à part (docs/10 §3).
    expect((await app.engine.status(id))!.phase).toBe("ROUTE");
    // RESEARCH est commitée avant les questions, avec le message du réducteur.
    expect(git(root, "log", "--format=%s", "-1")).toBe("docs(skraft): research de us-12");

    // Un testeur ne peut pas trancher une question métier (§11) ; le PO répond, puis reporte l'autre.
    const option = (q: (typeof questions)[number], action: string) => q.options.find((o) => o.id.endsWith(`:${action}`))!.id;
    await expect(app.interactions.respond(questions[0]!.id, option(questions[0]!, "answer"), "par prise", { role: "testeur" })).rejects.toThrow(/PO \/ BA/);
    await app.interactions.respond(questions[0]!.id, option(questions[0]!, "answer"), "par prise", { role: "po" });
    await app.interactions.respond(questions[1]!.id, option(questions[1]!, "defer"), undefined, { role: "po" });

    // DESIGN reçoit les réponses et la phase RESEARCH dans son dossier de passation.
    await until(async () => designBrief !== "");
    expect(designBrief).toContain("Réponses de l'utilisateur :");
    expect(designBrief).toContain("Le plafond s'applique-t-il par prise ou par jour ? → par prise");
    expect(designBrief).toContain("Le plafond est-il rappelé au patient ? → (question reportée par l'utilisateur)");
    expect(designBrief).toContain("RESEARCH : .skraft/us-12/research/research.md");
    await until(async () => (await app.engine.status(id))?.status === "finished", 60_000);
    expect(app.posted.at(-1)).toContain("Phases exécutées : RESEARCH, DESIGN, DISTILL, DELIVER");
  }, 120_000);

  it("recherche sans document : rejet explicite, escalade après le budget", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-researcher": async (t) => void (await t.callTool("report_phase", { summary: "rien", files: [] })),
    });
    const app = await assemble(root, runtime, tasksDir);
    await app.registry.command("skraft-workflow")!.handler("--auto stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Phase RESEARCH")), 60_000);
    const [escalade] = await app.interactions.pending();
    expect(escalade!.title).toBe("Phase RESEARCH : Document de recherche absent : .skraft/us-12/research/research.md");
    expect(escalade!.requiredRoles).toEqual(["developpeur", "architecte", "administrateur"]);
  }, 60_000);
});
