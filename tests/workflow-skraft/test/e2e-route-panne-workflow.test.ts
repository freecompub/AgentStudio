/**
 * D17 (docs/12) : une panne pendant les questions ouvertes (ROUTE, hors de toute phase) ne termine
 * plus la tâche. L'humain relance : seules les questions dont la demande a échoué sont reposées.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvFailureError } from "@agent-studio/core";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, shutdownHosts, simulatedAgents, until } from "./support/harness.js";
import { fin, lancerWorkflow } from "./support/fin.js";

describe("skraft en workflow — panne pendant les questions ouvertes (D17)", () => {
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

  it("escalade relancer / abandonner ; relancer repose la seule question en échec, puis la tâche va au bout", async () => {
    const app = await assemble(root, simulatedAgents(new ScriptedRuntime(), root), tasksDir);
    const posees: string[] = [];
    let panne = false;
    const request = app.interactions.request.bind(app.interactions);
    app.interactions.request = async (req) => {
      if (req.title.startsWith("Question ouverte")) {
        if (!panne && req.detail?.includes("bloque-t-elle")) {
          panne = true;
          throw new EnvFailureError("magasin d'interactions indisponible");
        }
        posees.push(req.detail ?? "");
      }
      return request(req);
    };
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-15.md", "medium-hard");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.includes("bloqué (ROUTE)")), 60_000);
    const q = (await app.interactions.pending()).find((p) => p.title.includes("bloqué (ROUTE)"))!;
    expect(q.detail).toContain("magasin d'interactions indisponible");
    expect(q.options.map((o) => o.label)).toEqual(["Relancer : reposer les questions", "Abandonner"]);
    await app.interactions.respond(q.id, q.options[0]!.id);
    await fin(app, id, 60_000);
    // Chaque question n'est posée qu'une fois ; la troisième vient de la recherche (« Passage de relais »).
    expect(posees.sort()).toEqual(["L'alerte bloque-t-elle la validation ?", "Le délai minimal dépend-il de l'insuline utilisée ?", "Le plafond est-il rappelé au patient ?"]);
  }, 90_000);
});
