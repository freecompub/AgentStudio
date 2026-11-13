/**
 * Jumeau de `extensions/skraft/test/e2e-valeurs-douteuses.test.ts` pour `/skraft-workflow` (ADR 0080) :
 * un nombre seul d'un critère est soumis à l'humain avant RESEARCH ; retiré, la porte des valeurs ne
 * l'exige plus, et la réponse est transmise aux agents.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, git, put, shutdownHosts, simulatedAgents, until } from "./support/harness.js";

describe("skraft en workflow — valeurs douteuses soumises à l'humain (ADR 0080)", () => {
  let root: string;
  let tasksDir: string;
  beforeEach(async () => {
    root = await createProject();
    const story = await readFile(join(root, "stories/us-12.md"), "utf8");
    await put(root, "stories/us-12.md", story.replace("3. Aucun plafond configuré", "3. Après 3 refus, aucun plafond configuré"));
    git(root, "commit", "-qam", "story avec un nombre seul");
    tasksDir = await mkdtemp(join(tmpdir(), "agent-studio-skraft-tasks-"));
  });
  afterEach(async () => {
    await shutdownHosts();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(tasksDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("posée avant RESEARCH, sans texte libre ; retirée, la réponse va au chercheur et dans la passation", async () => {
    const researchPrompts: string[] = [];
    const researcher: ScriptedBehavior = async (t) => {
      researchPrompts.push(t.prompt);
      await t.callTool("report_blocker", { question: "stop", choices: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-researcher": researcher });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const difficulty = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(difficulty.id, difficulty.options.find((o) => o.id.endsWith(":medium-hard"))!.id);

    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Valeur à tester")), 60_000);
    const valeur = (await app.interactions.pending()).find((p) => p.title.startsWith("Valeur à tester"))!;
    expect(valeur.title).toBe("Valeur à tester (US-12, critère 3)");
    expect(valeur.detail).toContain("Le critère 3 cite « 3 »");
    expect(valeur.options.map((o) => o.label)).toEqual(["Oui : la garder dans la porte des valeurs", "Non : la retirer de la porte des valeurs"]);
    expect(valeur.freeText).toBeFalsy();
    expect(researchPrompts).toHaveLength(0);
    await app.interactions.respond(valeur.id, valeur.options[1]!.id, undefined, { role: "po" });

    await until(async () => researchPrompts.length >= 1, 60_000);
    const reponse = "→ Non : « 3 » n'est pas une valeur à tester ; la porte des valeurs ne l'exige pas.";
    expect(researchPrompts[0]).toContain(reponse);
    expect(await readFile(join(root, ".skraft/us12-f15ade30/passation.md"), "utf8")).toContain("n'est pas une valeur à tester");
  }, 120_000);
});
