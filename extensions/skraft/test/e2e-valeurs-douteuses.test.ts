/**
 * Valeurs douteuses de la porte des valeurs (ADR 0080) : un nombre seul d'un critère est soumis à
 * l'humain avant RESEARCH. Retiré, il sort du critère que la porte vérifie ; la réponse est
 * transmise aux agents comme les autres réponses de l'utilisateur.
 *
 * Run 4 de LEC-1 (11/11) : « (ADR 0069) » dans un critère faisait exiger « 0069 » dans le scénario.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { US12 } from "./story.test.js";
import { assemble, createProject, git, put, researchDoc, shutdownHosts, simulatedAgents, stateOf, until } from "./support/harness.js";

describe("skraft — valeurs douteuses soumises à l'humain (ADR 0080)", () => {
  let root: string;
  let tasksDir: string;
  beforeEach(async () => {
    root = await createProject();
    await put(root, "stories/us-12.md", US12.replace("3. Aucun plafond configuré", "3. Après 3 refus, aucun plafond configuré"));
    git(root, "commit", "-qam", "story avec un nombre seul");
    tasksDir = await mkdtemp(join(tmpdir(), "agent-studio-skraft-tasks-"));
  });
  afterEach(async () => {
    await shutdownHosts();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(tasksDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("posée avant RESEARCH, sans texte libre ; retirée, elle sort du critère et la réponse va au chercheur", async () => {
    const researchPrompts: string[] = [];
    const researcher: ScriptedBehavior = async (t) => {
      researchPrompts.push(t.prompt);
      await put(root, ".skraft/us-12/research/research.md", researchDoc());
      await t.callTool("report_phase", { summary: "recherche écrite", files: [".skraft/us-12/research/research.md"] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-researcher": researcher });
    const app = await assemble(root, runtime, tasksDir);
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;
    await until(async () => (await app.interactions.pending()).length === 1);
    const [difficulty] = await app.interactions.pending();
    await app.interactions.respond(difficulty!.id, "medium-hard");

    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Valeur à tester")));
    const valeur = (await app.interactions.pending()).find((p) => p.title.startsWith("Valeur à tester"))!;
    expect(valeur.title).toBe("Valeur à tester (US-12, critère 3)");
    expect(valeur.detail).toContain("Le critère 3 cite « 3 »");
    expect(valeur.options.map((o) => o.id)).toEqual(["keep:v1", "drop:v1"]);
    expect(valeur.freeText).toBeFalsy();
    expect(researchPrompts).toHaveLength(0);

    const question = (await app.interactions.pending()).find((p) => p.title.startsWith("Question ouverte"))!;
    await app.interactions.respond(question.id, "answer:q1", "par prise", { role: "po" });
    await app.interactions.respond(valeur.id, "drop:v1", undefined, { role: "po" });

    await until(async () => researchPrompts.length >= 1);
    expect(stateOf(await app.engine.status(id))?.story?.criteria[2]?.literals).toEqual([]);
    expect(researchPrompts[0]).toContain("→ Non : « 3 » n'est pas une valeur à tester ; la porte des valeurs ne l'exige pas.");
  }, 120_000);
});
