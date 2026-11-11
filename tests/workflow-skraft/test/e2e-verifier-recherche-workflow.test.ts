/**
 * Le chercheur vérifie sa recherche avec l'outil que la porte des citations rejoue (ADR 0082). Run 6
 * de LEC-1 (11/11) : un gabarit cité comme un fichier, `docs/adr/00NN-titre.md`, a coûté un essai.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, git, put, rappelsVus, researchDoc, shutdownHosts, simulatedAgents, until } from "./support/harness.js";

describe("skraft en workflow — vérification de la recherche par le chercheur (ADR 0082)", () => {
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

  async function lancer(researcher: ScriptedBehavior) {
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-researcher": researcher });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const difficulty = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(difficulty.id, difficulty.options.find((o) => o.id.endsWith(":medium-hard"))!.id);
    return app;
  }
  const recherche = () => git(root, "log", "--format=%s").split("\n").some((l) => l === "docs(skraft): research de us-12");
  const DOC = ".skraft/us-12/research/research.md";

  it("le chercheur voit le motif de la porte pendant son tour, corrige, et la porte accepte du premier coup", async () => {
    const prompts: string[] = [];
    const reponses: string[] = [];
    await lancer(async (t) => {
      prompts.push(t.prompt);
      await put(root, DOC, researchDoc({ Découvertes: "Les ADR sont nommés `docs/adr/00NN-titre.md`." }));
      reponses.push(String(await t.callTool("verifier_recherche", {})));
      await put(root, DOC, researchDoc());
      reponses.push(String(await t.callTool("verifier_recherche", {})));
      await t.callTool("report_phase", { summary: "recherche", files: [DOC] });
    });
    await until(async () => recherche(), 60_000);
    expect(prompts).toHaveLength(1);
    expect(reponses[0]).toContain("`docs/adr/00NN-titre.md` : fichier inexistant dans le dépôt.");
    expect(reponses[1]).toContain("Aucun motif");
  }, 120_000);

  it("sans vérification, la sortie est refusée une fois, avec le nom de l'outil", async () => {
    rappelsVus.length = 0;
    await lancer(async (t) => {
      await put(root, DOC, researchDoc());
      await t.callTool("report_phase", { summary: "recherche", files: [DOC] });
    });
    await until(async () => recherche(), 60_000);
    expect(rappelsVus).toHaveLength(1);
    expect(rappelsVus[0]).toContain("`verifier_recherche`");
  }, 120_000);
});
