/**
 * D20 (docs/12), contrôle : le workflow n'a pas ce défaut. `w.rembobiner` fait toujours oublier
 * les agents qui ont travaillé depuis le checkpoint (ADR 0053) : après une escalade de scénario,
 * le testeur repart dans une session neuve.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvFailureError } from "@agent-studio/core";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, fakeStack, ROLE, shutdownHosts, simulatedAgents, unitTestWriter, until } from "./support/harness.js";
import { fin, lancerWorkflow } from "./support/fin.js";

describe("skraft en workflow — escalade de scénario et sessions (D20, contrôle)", () => {
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

  it("panne au pas rouge, relancer : le testeur repart dans une session neuve", async () => {
    let testeurAppele = false;
    let panne = false;
    const stack = fakeStack();
    const run = stack.runTests;
    stack.runTests = async (opts) => {
      // Premier lancement après le premier tour du testeur : la porte rouge du scénario.
      if (testeurAppele && !panne) {
        panne = true;
        throw new EnvFailureError("Copilot injoignable");
      }
      return run(opts);
    };
    const ecrire = unitTestWriter(root);
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-test": async (t) => {
        testeurAppele = true;
        await ecrire(t);
      },
    });
    const app = await assemble(root, runtime, tasksDir, { stack });
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await until(async () => (await app.interactions.pending()).some((p) => p.title === "Pipeline skraft bloqué (DELIVER)"), 60_000);
    const q = (await app.interactions.pending()).find((p) => p.title === "Pipeline skraft bloqué (DELIVER)")!;
    await app.interactions.respond(q.id, q.options.find((o) => o.id.endsWith("relancer"))!.id);
    await fin(app, id, 60_000);
    const sessions = runtime.history.filter((h) => runtime.configs.get(h.id)!.role === ROLE("skraft-test"));
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    // La session d'avant l'escalade n'a reçu qu'un tour : la reprise ne s'y est pas poursuivie.
    expect(sessions[0]!.sent).toHaveLength(1);
  }, 90_000);
});
