/**
 * Réponses humaines citables (décidé le 07/11), jumeau du test du workflow : le code écrit les
 * réponses de l'utilisateur dans `.skraft/<slug>/passation.md` et les commite. Une question posée par
 * l'agent pendant DELIVER ne fait pas refuser son pas : le fichier est écrit par le code, pas par lui.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, git, shutdownHosts, simulatedAgents, stateOf, unitTestWriter, until } from "./support/harness.js";

describe("skraft — réponses de l'utilisateur écrites dans passation.md", () => {
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

  it("question ouverte et question de l'agent en DELIVER : écrites, commitées, et le pas n'est pas refusé", async () => {
    const ecrire = unitTestWriter(root);
    let demande = false;
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-test": async (t) => {
        if (!demande) {
          demande = true;
          return void (await t.callTool("report_blocker", { question: "Le plafond s'applique-t-il aux bolus de correction ?", choices: ["oui", "non"] }));
        }
        await ecrire(t);
      },
    });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app, "par prise");
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    await app.interactions.respond((await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!.id, "medium-hard");
    const id = (await app.engine.list())[0]!.id;
    await until(async () => (await app.interactions.pending()).some((p) => p.title === "Question de l'agent (DELIVER)"), 60_000);
    const q = (await app.interactions.pending()).find((p) => p.title === "Question de l'agent (DELIVER)")!;
    await app.interactions.respond(q.id, "oui", undefined, { role: "developpeur" });
    await until(async () => ["DONE", "ESCALATED", "ABORTED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 60_000);

    expect(stateOf(await app.engine.status(id))!.escalation?.reason).toBeUndefined();
    expect(stateOf(await app.engine.status(id))!.stage).toBe("DONE");
    const passation = git(root, "show", "HEAD:.skraft/us12-f15ade30/passation.md");
    expect(passation).toMatch(/^# Réponses de l'utilisateur — US-12/);
    expect(passation).toMatch(/→ par prise$/m);
    expect(passation).toContain("- « Le plafond s'applique-t-il aux bolus de correction ? » → oui");
  }, 120_000);
});
