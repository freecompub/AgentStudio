/**
 * Disjoncteur des réessais (ADR 0073), jumeau du test de l'extension : un développeur qui ne modifie
 * jamais le code fait refuser chaque pas pour le même motif. Deux refus identiques de suite
 * suffisent pour escalader, au pas comme à la reprise du scénario, au lieu d'épuiser les budgets.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, shutdownHosts, simulatedAgents, until } from "./support/harness.js";
import { lancerWorkflow } from "./support/fin.js";

describe("skraft en workflow — disjoncteur des réessais (ADR 0073)", () => {
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

  it("même refus deux fois de suite : escalade sans épuiser le budget du pas ni celui du scénario", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-dev": async (t) => void (await t.callTool("report_phase", { summary: "rien", files: [] })),
    });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");

    await until(async () => (await app.interactions.pending()).some((p) => p.title === "Pipeline skraft bloqué (DELIVER)"), 90_000);
    const q = (await app.interactions.pending()).find((p) => p.title === "Pipeline skraft bloqué (DELIVER)")!;
    expect(q.detail).toMatch(/^Scénario ac-1 : Même refus deux fois de suite : Aucun fichier de production modifié/);
    expect(q.detail).not.toMatch(/Même refus deux fois de suite : Même refus/);

    const rejets = ((await app.trace.list(id)).filter((e) => e.kind === "rejet") as { porte: string }[]).map((r) => r.porte);
    // Deux refus par pas (dev, puis green après le passage en sessions séparées), deux reprises du scénario.
    expect(rejets.filter((p) => p.startsWith("scénario ac-1"))).toHaveLength(2);
    expect(rejets.filter((p) => p.startsWith("pas "))).toEqual(["pas dev (ac-1)", "pas dev (ac-1)", "pas green (ac-1)", "pas green (ac-1)"]);
  }, 150_000);
});
