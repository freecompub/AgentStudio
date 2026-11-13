/**
 * Restes de D1 (docs/12) : le gel des tests d'acceptance n'est annoncé qu'une fois définitif, et
 * une phase DISTILL sautée est signalée au début de DELIVER au lieu de passer en silence.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptanceWriter, answerQuestions, assemble, createProject, shutdownHosts, simulatedAgents, until } from "./support/harness.js";
import { fin, lancerWorkflow } from "./support/fin.js";

describe("skraft en workflow — annonce du gel des tests d'acceptance (D1)", () => {
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

  it("revue de DISTILL : l'empreinte est prise, le gel n'est pas encore annoncé comme définitif", async () => {
    const prompts: string[] = [];
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-lens-test-integrity": async (t) => {
        if (t.prompt.includes("phase DISTILL")) prompts.push(t.prompt);
        await t.callTool("submit_lens_verdict", { lens: "test-integrity", verdict: "APPROVED", defects: [] });
      },
    });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await fin(app, id, 60_000);
    expect(prompts[0]).toContain("le gel devient définitif au commit de DISTILL");
    expect(prompts[0]).not.toContain("Tests d'acceptance gelés");
  }, 90_000);

  it("DISTILL sautée : DELIVER prévient que les tests d'acceptance ne sont pas gelés", async () => {
    const accept = acceptanceWriter(root);
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      // Le plan de test manque toujours : la porte échoue jusqu'à l'escalade.
      "skraft-acceptance": async (t) => {
        await accept(t);
        await rm(join(root, ".skraft/us12-f15ade30/distill/test-plan.md"));
      },
    });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Phase DISTILL")), 60_000);
    const q = (await app.interactions.pending()).find((p) => p.title.startsWith("Phase DISTILL"))!;
    await app.interactions.respond(q.id, q.options.find((o) => o.id.endsWith("sauter"))!.id, undefined, { role: "architecte" });
    await until(async () => app.posted.some((p) => p.includes("DISTILL a été sautée")), 60_000);
    expect(app.posted.find((p) => p.includes("DISTILL a été sautée"))).toContain("les tests d'acceptance ne sont pas gelés");
  }, 90_000);
});
