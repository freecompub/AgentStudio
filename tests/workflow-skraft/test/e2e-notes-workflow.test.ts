/**
 * Défauts hors du changement rangés en notes (06/11), mené par le workflow en DESIGN : un défaut
 * bloquant sur un fichier que la phase n'a pas touché ne renvoie pas le travail ; l'humain est
 * prévenu tout de suite, et le bilan le rappelle « à corriger après le cycle ».
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, put, shutdownHosts, simulatedAgents, until } from "./support/harness.js";

describe("skraft en workflow — défauts hors du changement rangés en notes", () => {
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

  it("blocker sur un fichier non touché : pas de tour de plus, pas de réfutateur ; message tout de suite, note dans le rapport, rappel au bilan", async () => {
    const decidePrompts: string[] = [];
    const refuterPrompts: string[] = [];
    let lentille = 0;
    const decide: ScriptedBehavior = async (t) => {
      decidePrompts.push(t.prompt);
      await put(root, ".skraft/us-12/design/contracts.md", "`BolusCapped`\n");
      await t.callTool("report_phase", { summary: "décisions", files: [] });
    };
    const architecture: ScriptedBehavior = async (t) => {
      lentille++;
      await t.callTool("submit_lens_verdict", lentille === 1
        ? { lens: "architecture", verdict: "CHANGES_REQUESTED", defects: [{ severity: "blocker", severityReason: "Une règle de la story se contredit.", description: "La story fixe deux plafonds différents.", file: "stories/us-12.md", line: 1, target: "deliverable" }] }
        : { lens: "architecture", verdict: "APPROVED", defects: [] });
    };
    const refuter: ScriptedBehavior = async (t) => {
      refuterPrompts.push(t.prompt);
      await t.callTool("submit_lens_verdict", { lens: "finding-refuter", verdict: "APPROVED", defects: [], rulings: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-architect-decide": decide, "skraft-lens-architecture": architecture, "skraft-finding-refuter": refuter });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const difficulty = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(difficulty.id, difficulty.options.find((o) => o.id.endsWith(":medium"))!.id);
    await until(async () => (await app.engine.list())[0]?.status === "finished", 90_000);

    expect(decidePrompts).toHaveLength(1);
    expect(refuterPrompts).toEqual([]);
    expect(app.posted).toContainEqual(expect.stringMatching(/Défaut bloquant hors du changement de la story.*stories\/us-12\.md:1.*La story fixe deux plafonds différents\..*après la fin du cycle skraft/s));
    const md = await readFile(join(root, ".skraft/us-12/reviews/design-review-1.md"), "utf8");
    expect(md).toContain("- note (hors du changement) : `architecture#1.1` **blocker** La story fixe deux plafonds différents. (stories/us-12.md:1)");
    const bilan = app.posted.at(-1)!;
    expect(bilan).toContain("À corriger après le cycle");
    expect(bilan).toContain("- stories/us-12.md:1 (architecture, blocker) : La story fixe deux plafonds différents.");
  }, 120_000);
});
