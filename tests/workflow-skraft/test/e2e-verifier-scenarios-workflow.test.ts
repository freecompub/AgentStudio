/**
 * L'agent d'acceptance vérifie ses scénarios avec l'outil que la porte rejoue (ADR 0082) : il voit
 * le motif pendant son tour, corrige, et rend un travail que la porte accepte du premier coup. Sans
 * vérification, sa sortie est refusée une fois, avec un rappel.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptanceWriter, answerQuestions, assemble, createProject, git, put, rappelsVus, shutdownHosts, simulatedAgents, until } from "./support/harness.js";

describe("skraft en workflow — vérification des scénarios par l'agent (ADR 0082)", () => {
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

  async function lancer(acceptance: ScriptedBehavior) {
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-acceptance": acceptance });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const difficulty = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(difficulty.id, difficulty.options.find((o) => o.id.endsWith(":medium"))!.id);
    return app;
  }
  const distill = () => git(root, "log", "--format=%s").split("\n").some((l) => l === "docs(skraft): distill de us-12");

  it("l'agent voit le motif de la porte pendant son tour, corrige, et la porte accepte du premier coup", async () => {
    const prompts: string[] = [];
    const reponses: string[] = [];
    const ecrire = acceptanceWriter(root);
    await lancer(async (t) => {
      prompts.push(t.prompt);
      // Il écrit d'abord tout, comme l'agent par défaut, sans rendre la main.
      await ecrire({ ...t, callTool: async (n, a) => (n === "report_phase" ? undefined : t.callTool(n, a)) });
      const feature = ".skraft/us-12/distill/features/plafond.feature";
      const { readFile } = await import("node:fs/promises");
      const juste = await readFile(join(root, feature), "utf8");
      await put(root, feature, juste.replace("12,5 U", "douze unités"));
      reponses.push(String(await t.callTool("verifier_scenarios", {})));
      await put(root, feature, juste);
      reponses.push(String(await t.callTool("verifier_scenarios", {})));
      await t.callTool("report_phase", { summary: "scénarios", files: [] });
    });
    await until(async () => distill(), 60_000);
    expect(prompts).toHaveLength(1);
    expect(reponses[0]).toContain("La valeur « 12,5 U » du critère 2 n'apparaît pas dans le scénario @ac-2");
    expect(reponses[1]).toContain("Aucun motif");
  }, 120_000);

  it("sans vérification, la sortie est refusée une fois, avec le nom de l'outil", async () => {
    rappelsVus.length = 0;
    const ecrire = acceptanceWriter(root);
    await lancer(async (t) => {
      await ecrire({ ...t, callTool: async (n, a) => (n === "report_phase" || n === "verifier_scenarios" ? undefined : t.callTool(n, a)) });
      // Le banc simule un agent qui ignore le rappel : il rappelle report_phase, accepté cette fois.
      await t.callTool("report_phase", { summary: "scénarios", files: [] });
    });
    await until(async () => distill(), 60_000);
    expect(rappelsVus).toHaveLength(1);
    expect(rappelsVus[0]).toContain("`verifier_scenarios`");
  }, 120_000);
});
