/**
 * La porte des valeurs avertit sans bloquer (ADR 0090, remplace l'ADR 0080) : plus de question sur les
 * nombres d'un critère avant RESEARCH ; une valeur absente du scénario ou du test d'acceptance est un
 * avertissement donné à l'utilisateur et à la revue de DISTILL, plus un refus.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { US12 } from "./story.test.js";
import { acceptanceWriter, answerQuestions, assemble, createProject, git, put, researchDoc, shutdownHosts, simulatedAgents, stateOf, until } from "./support/harness.js";

const SLUG = "us12-f15ade30";
type App = Awaited<ReturnType<typeof assemble>>;
async function lancer(app: App): Promise<string> {
  await app.registry.command("skraft")!.handler("stories/us-12.md");
  await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
  await app.interactions.respond((await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!.id, "medium-hard");
  return (await app.engine.list())[0]!.id;
}

describe("skraft — la porte des valeurs avertit sans bloquer (ADR 0090)", () => {
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

  it("un nombre seul dans un critère : aucune question avant RESEARCH, le chercheur est appelé", async () => {
    await put(root, "stories/us-12.md", US12.replace("3. Aucun plafond configuré", "3. Après 3 refus, aucun plafond configuré"));
    git(root, "commit", "-qam", "story avec un nombre seul");
    const researchPrompts: string[] = [];
    const researcher: ScriptedBehavior = async (t) => {
      researchPrompts.push(t.prompt);
      await put(root, `.skraft/${SLUG}/research/research.md`, researchDoc());
      await t.callTool("report_phase", { summary: "recherche écrite", files: [`.skraft/${SLUG}/research/research.md`] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-researcher": researcher });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await lancer(app);
    await until(async () => researchPrompts.length >= 1, 60_000);
    expect((await app.interactions.pending()).filter((p) => p.title.startsWith("Valeur à tester"))).toEqual([]);
  }, 120_000);

  it("valeur absente du scénario et du test : DISTILL passe ; l'utilisateur est averti ; la revue le reçoit dans ses faits", async () => {
    const ecrire = acceptanceWriter(root);
    // Comme un agent qui écrirait la valeur sous une autre forme : « 12 U » au lieu de « 12,5 U ».
    const acceptance: ScriptedBehavior = async (t) => {
      await ecrire(t);
      for (const rel of [`.skraft/${SLUG}/distill/features/plafond.feature`, "tests/acceptance/story.acceptance.test.ts"])
        await put(root, rel, (await readFile(join(root, rel), "utf8")).replace("12,5 U", "12 U"));
    };
    const lentille: string[] = [];
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-acceptance": acceptance,
      "skraft-lens-test-integrity": async (t) => {
        if (t.prompt.includes("phase DISTILL")) lentille.push(t.prompt);
        await t.callTool("submit_lens_verdict", { lens: "test-integrity", verdict: "APPROVED", defects: [] });
      },
    });
    const app = await assemble(root, runtime, tasksDir, { isolated: true });
    answerQuestions(app);
    const id = await lancer(app);
    await until(async () => ["DONE", "ESCALATED", "ABORTED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 90_000);
    expect(stateOf(await app.engine.status(id))!.stage).toBe("DONE");
    const scenario = "La valeur « 12,5 U » du critère 2 n'apparaît pas dans le scénario @ac-2";
    const test = "La valeur « 12,5 U » du critère 2 n'apparaît pas dans le test d'acceptance du critère 2";
    expect(app.posted.some((m) => m.includes("Porte des valeurs") && m.includes(scenario) && m.includes(test))).toBe(true);
    expect(lentille.at(-1)).toContain(scenario);
  }, 150_000);
});
