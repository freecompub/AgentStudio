/**
 * D18 (docs/12) : une phase sautée ne transmet ni son motif de rejet ni ses défauts à la suivante.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, ROLE, shutdownHosts, simulatedAgents, stateOf, until } from "./support/harness.js";

describe("skraft — phase sautée (D18)", () => {
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

  it("RESEARCH sautée : le décideur de DESIGN ne reçoit pas le motif de RESEARCH", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      // Aucun document de recherche : la porte citations échoue jusqu'à l'escalade.
      "skraft-researcher": async (t) => void (await t.callTool("report_phase", { summary: "rien", files: [] })),
    });
    const app = await assemble(root, runtime, tasksDir, { isolated: true });
    answerQuestions(app);
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    await app.interactions.respond((await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!.id, "medium-hard");
    const id = (await app.engine.list())[0]!.id;
    await until(async () => (await app.interactions.pending()).some((p) => p.title === "Pipeline skraft bloqué (RESEARCH)"), 60_000);
    const q = (await app.interactions.pending()).find((p) => p.title === "Pipeline skraft bloqué (RESEARCH)")!;
    expect(q.detail).toContain("Document de recherche absent");
    await app.interactions.respond(q.id, "skip");
    await until(async () => ["DONE", "ESCALATED", "ABORTED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 60_000);
    expect(stateOf(await app.engine.status(id))!.stage).toBe("DONE");
    const decide = runtime.history.filter((h) => runtime.configs.get(h.id)!.role === ROLE("skraft-architect-decide")).map((h) => h.sent.join("\n"));
    expect(decide.length).toBeGreaterThan(0);
    expect(decide[0]).not.toContain("Document de recherche absent");
  }, 90_000);
});
