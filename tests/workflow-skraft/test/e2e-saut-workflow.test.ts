/**
 * D18 (docs/12), contrôle : le workflow n'a pas ce défaut. Une phase sautée ne transmet ni son
 * motif de rejet ni ses défauts à la suivante (suivi par phase, `relance` vide après un saut).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, ROLE, shutdownHosts, simulatedAgents, until } from "./support/harness.js";
import { fin, lancerWorkflow } from "./support/fin.js";

describe("skraft en workflow — phase sautée (D18, contrôle)", () => {
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
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Phase RESEARCH")), 60_000);
    const q = (await app.interactions.pending()).find((p) => p.title.startsWith("Phase RESEARCH"))!;
    expect(q.title).toContain("Document de recherche absent");
    await app.interactions.respond(q.id, q.options.find((o) => o.id.endsWith("sauter"))!.id);
    await fin(app, id, 60_000);
    const decide = runtime.history.filter((h) => runtime.configs.get(h.id)!.role === ROLE("skraft-architect-decide")).map((h) => h.sent.join("\n"));
    expect(decide.length).toBeGreaterThan(0);
    expect(decide[0]).not.toContain("Document de recherche absent");
  }, 90_000);
});
