/**
 * Défauts hors du changement rangés en notes (06/11), mené par l'extension en DELIVER : un défaut
 * bloquant sur un fichier que la phase n'a pas touché ne renvoie pas le travail ; l'humain est
 * prévenu tout de suite, et le bilan le rappelle « à corriger après le cycle ».
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, put, shutdownHosts, simulatedAgents, stateOf, until } from "./support/harness.js";

describe("skraft — défauts hors du changement rangés en notes", () => {
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

  it("blocker sur un fichier non touché : pas de correction, pas de réfutateur ; message tout de suite, note dans le rapport, rappel au bilan", async () => {
    const devPrompts: string[] = [];
    const refuterPrompts: string[] = [];
    let revues = 0;
    const architecture: ScriptedBehavior = async (t) => {
      const premiere = t.prompt.includes("phase DELIVER") && revues++ === 0;
      await t.callTool("submit_lens_verdict", premiere
        ? { lens: "architecture", verdict: "CHANGES_REQUESTED", defects: [{ severity: "blocker", severityReason: "Une règle de la story se contredit.", description: "La story fixe deux plafonds différents.", file: "stories/us-12.md", line: 1, target: "deliverable" }] }
        : { lens: "architecture", verdict: "APPROVED", defects: [] });
    };
    const refuter: ScriptedBehavior = async (t) => {
      refuterPrompts.push(t.prompt);
      await t.callTool("submit_lens_verdict", { lens: "finding-refuter", verdict: "APPROVED", defects: [], rulings: [] });
    };
    const dev: ScriptedBehavior = async (t) => {
      devPrompts.push(t.prompt);
      await put(root, "src/domain/bolus-cap.ts", "export class BolusCap {}\n");
      await t.callTool("report_phase", { summary: "code", files: ["src/domain/bolus-cap.ts"] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-lens-architecture": architecture, "skraft-finding-refuter": refuter, "skraft-dev": dev });
    const app = await assemble(root, runtime, tasksDir, { isolated: true });
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    answerQuestions(app);
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const req = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(req.id, req.options[0]!.id);
    const id = (await app.engine.list())[0]!.id;
    await until(async () => ["DONE", "ESCALATED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 60_000);

    expect(stateOf(await app.engine.status(id))!.stage).toBe("DONE");
    expect(refuterPrompts).toEqual([]);
    expect(devPrompts.some((p) => p.includes("architecture#1.1"))).toBe(false);
    expect(app.posted).toContainEqual(expect.stringMatching(/Défaut bloquant hors du changement de la story.*stories\/us-12\.md:1.*La story fixe deux plafonds différents\..*après la fin du cycle skraft/s));
    const dossier = join(root, ".skraft/us12-f15ade30/reviews");
    const fichier = (await readdir(dossier)).find((f) => f.startsWith("deliver-review-") && f.endsWith(".md"))!;
    expect(await readFile(join(dossier, fichier), "utf8")).toContain("- note (hors du changement) : `architecture#1.1` **blocker** La story fixe deux plafonds différents. (stories/us-12.md:1)");
    // Le bilan est publié par un effet, après la transition vers DONE : on l'attend (comme e2e-s1).
    await until(async () => app.posted.some((p) => p.startsWith("Pipeline skraft terminé")), 60_000);
    const bilan = app.posted.find((p) => p.startsWith("Pipeline skraft terminé"))!;
    expect(bilan).toContain("À corriger après le cycle");
    expect(bilan).toContain("- stories/us-12.md:1 (architecture, blocker) : La story fixe deux plafonds différents.");
  }, 90_000);
});

