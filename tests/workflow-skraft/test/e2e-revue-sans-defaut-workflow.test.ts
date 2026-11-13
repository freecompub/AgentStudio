/**
 * Revue sans défaut à corriger, hors DELIVER (ADR 0081). Run 4 de LEC-1 (11/11) : deux revues de
 * DISTILL « changements demandés », sans défaut bloquant ni majeur, ont fait rejouer la phase et
 * consommé ses essais jusqu'à deux escalades, alors que le producteur n'avait rien à corriger.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, git, put, shutdownHosts, simulatedAgents, until } from "./support/harness.js";

describe("skraft en workflow — revue sans défaut à corriger, hors DELIVER (ADR 0081)", () => {
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

  async function lancer(architecture: ScriptedBehavior) {
    const decidePrompts: string[] = [];
    const decide: ScriptedBehavior = async (t) => {
      decidePrompts.push(t.prompt);
      await put(root, ".skraft/us12-f15ade30/design/contracts.md", "`BolusCapped`\n");
      await t.callTool("report_phase", { summary: "décisions", files: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-architect-decide": decide, "skraft-lens-architecture": architecture });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const difficulty = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(difficulty.id, difficulty.options.find((o) => o.id.endsWith(":medium"))!.id);
    return { app, decidePrompts };
  }
  const design = () => git(root, "log", "--format=%s").split("\n").some((l) => l === "docs(skraft): design de us12-f15ade30");

  it("mineurs seulement : DESIGN approuvée et commitée, l'architecte n'est pas relancé", async () => {
    const { decidePrompts } = await lancer(async (t) =>
      void (await t.callTool("submit_lens_verdict", {
        lens: "architecture",
        verdict: "CHANGES_REQUESTED",
        defects: [{ severity: "minor", severityReason: "raison d’essai", description: "Un nom pourrait être plus précis.", file: ".skraft/us12-f15ade30/design/contracts.md", target: "deliverable" }],
      })));
    await until(async () => design(), 60_000);
    expect(decidePrompts).toHaveLength(1);
  }, 120_000);

  it("une lentille REJECTED sans défaut à corriger : escalade, l'architecte n'est pas relancé", async () => {
    const { app, decidePrompts } = await lancer(async (t) => void (await t.callTool("submit_lens_verdict", { lens: "architecture", verdict: "REJECTED", defects: [] })));
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Phase DESIGN")), 60_000);
    const escalade = (await app.interactions.pending()).find((p) => p.title.startsWith("Phase DESIGN"))!;
    expect(`${escalade.title}\n${escalade.detail ?? ""}`).toContain("Revue sans défaut à corriger");
    expect(decidePrompts).toHaveLength(1);
    expect(design()).toBe(false);
  }, 120_000);
});
