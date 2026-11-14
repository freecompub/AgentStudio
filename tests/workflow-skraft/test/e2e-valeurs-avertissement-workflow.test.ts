/**
 * Jumeau de `extensions/skraft/test/e2e-valeurs-avertissement.test.ts` pour `/skraft-workflow` (ADR 0090) :
 * plus de question sur les nombres d'un critère avant RESEARCH ; une valeur absente du scénario ou du
 * test d'acceptance n'est plus un refus, mais un avertissement donné à l'utilisateur et à la revue.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptanceWriter, answerQuestions, assemble, createProject, git, put, shutdownHosts, simulatedAgents, until } from "./support/harness.js";
import { fin, lancerWorkflow } from "./support/fin.js";

const SLUG = "us12-f15ade30";

describe("skraft en workflow — la porte des valeurs avertit sans bloquer (ADR 0090)", () => {
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
    const story = await readFile(join(root, "stories/us-12.md"), "utf8");
    await put(root, "stories/us-12.md", story.replace("3. Aucun plafond configuré", "3. Après 3 refus, aucun plafond configuré"));
    git(root, "commit", "-qam", "story avec un nombre seul");
    const researchPrompts: string[] = [];
    const researcher: ScriptedBehavior = async (t) => {
      researchPrompts.push(t.prompt);
      await t.callTool("report_blocker", { question: "stop", choices: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-researcher": researcher });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await until(async () => researchPrompts.length >= 1, 60_000);
    expect((await app.interactions.pending()).filter((p) => p.title.startsWith("Valeur à tester"))).toEqual([]);
    expect(researchPrompts[0]).not.toContain("valeur à tester");
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
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    const bilan = await fin(app, id, 120_000);
    expect(bilan.phases).toContain("DISTILL");
    const scenario = "La valeur « 12,5 U » du critère 2 n'apparaît pas dans le scénario @ac-2";
    const test = "La valeur « 12,5 U » du critère 2 n'apparaît pas dans le test d'acceptance du critère 2";
    expect(app.posted.some((m) => m.includes("Porte des valeurs") && m.includes(scenario) && m.includes(test))).toBe(true);
    expect(lentille.at(-1)).toContain(scenario);
  }, 180_000);
});
