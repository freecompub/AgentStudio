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
import { assemble, createProject, git, put, researchDoc, shutdownHosts, simulatedAgents, until } from "./support/harness.js";

describe.each([
  { mode: "dans le processus principal", isolated: false },
  { mode: "en processus isolé", isolated: true },
])("skraft en workflow — critères de S2 (RESEARCH), $mode", ({ isolated }) => {
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
    const app = await assemble(root, runtime, tasksDir, { isolated });
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
    const questions = (await app.interactions.pending()).filter((p) => p.title.startsWith("Question ouverte"));
    expect(questions.map((q) => q.detail)).toEqual(["Le plafond s'applique-t-il par prise ou par jour ?", "Le plafond est-il rappelé au patient ?"]);
    expect(questions[0]).toMatchObject({ freeText: true, requiredRoles: ["po", "developpeur", "architecte", "administrateur"] });
    expect((await app.engine.status(id))!.phase).toBe("RESEARCH");
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
    const app = await assemble(root, runtime, tasksDir, { isolated });
    await app.registry.command("skraft-workflow")!.handler("--auto stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Phase RESEARCH")), 60_000);
    const [escalade] = await app.interactions.pending();
    expect(escalade!.title).toBe("Phase RESEARCH : Document de recherche absent : .skraft/us-12/research/research.md");
    expect(escalade!.requiredRoles).toEqual(["developpeur", "architecte", "administrateur"]);
  }, 60_000);
});
