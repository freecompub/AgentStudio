// Repris de extensions/skraft-workflow/test/e2e-revue-workflow.test.ts (2026-10-10) : teste le workflow en dossier (ADR 0055).
/**
 * Dialogue de revue en DESIGN (ADR 0046), mené par le workflow : défaut contesté, maintenu,
 * contesté de nouveau, soumis à l'humain, maintenu par lui, puis corrigé — essai accordé alors que
 * le budget de la phase est épuisé (`docs/09` §13, écart 9).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, put, shutdownHosts, simulatedAgents, until } from "./support/harness.js";

const DEFAUT = "architecture#1.1";

describe("skraft en workflow — dialogue de revue en DESIGN", () => {
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

  it("contesté deux fois, maintenu deux fois : l'humain tranche, et la correction a lieu malgré le budget épuisé", async () => {
    const decidePrompts: string[] = [];
    const lensPrompts: string[] = [];
    const decide: ScriptedBehavior = async (t) => {
      decidePrompts.push(t.prompt);
      await put(root, ".skraft/us12-f15ade30/design/contracts.md", "`BolusCapped`\n");
      const n = decidePrompts.length;
      const responses =
        n === 2 || n === 3 ? [{ defect: DEFAUT, status: "contested", reason: "L'agrégat est nommé dans domain-model.md." }] : n === 4 ? [{ defect: DEFAUT, status: "fixed" }] : [];
      await t.callTool("report_phase", { summary: "décisions", files: [], ...(responses.length ? { responses } : {}) });
    };
    const architecture: ScriptedBehavior = async (t) => {
      lensPrompts.push(t.prompt);
      const n = lensPrompts.length;
      if (n === 1)
        return void (await t.callTool("submit_lens_verdict", {
          lens: "architecture",
          verdict: "CHANGES_REQUESTED",
          defects: [{ severity: "major", severityReason: "raison d’essai", description: "contracts.md ne nomme pas l'agrégat.", file: ".skraft/us12-f15ade30/design/contracts.md", target: "deliverable" }],
        }));
      if (n === 2 || n === 3)
        return void (await t.callTool("submit_lens_verdict", {
          lens: "architecture",
          verdict: "CHANGES_REQUESTED",
          defects: [],
          rulings: [{ defect: DEFAUT, decision: "maintained", reason: "Un contrat doit se lire seul." }],
        }));
      await t.callTool("submit_lens_verdict", { lens: "architecture", verdict: "APPROVED", defects: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-architect-decide": decide, "skraft-lens-architecture": architecture });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const difficulty = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(difficulty.id, difficulty.options.find((o) => o.id.endsWith(":medium"))!.id);
    const id = (await app.engine.list())[0]!.id;

    // Essai 2 : le défaut, numéroté par le code, et ce qu'on attend de l'agent.
    await until(async () => decidePrompts.length >= 2);
    expect(decidePrompts[1]).toContain(`[${DEFAUT}, major, deliverable] contracts.md ne nomme pas l'agrégat. (.skraft/us12-f15ade30/design/contracts.md)`);
    expect(decidePrompts[1]).toContain("Réponds à chaque défaut ci-dessus dans le champ `responses`");

    // Essai 3 : la lentille a revu la contestation, et l'a maintenue.
    await until(async () => decidePrompts.length >= 3);
    expect(lensPrompts[1]).toContain("L'agrégat est nommé dans domain-model.md.");
    expect(decidePrompts[2]).toContain("maintenu par la lentille après ta contestation (Un contrat doit se lire seul.) : à corriger.");

    // Contesté encore, maintenu encore : l'humain tranche (budget de 3 essais déjà consommé).
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Arbitrer")), 60_000);
    const arbitrage = (await app.interactions.pending()).find((p) => p.title.startsWith("Arbitrer"))!;
    expect(arbitrage.title).toBe(`Arbitrer un désaccord de revue (${DEFAUT})`);
    expect(arbitrage.requiredRoles).toEqual(["developpeur", "architecte", "administrateur"]);
    await app.interactions.respond(arbitrage.id, arbitrage.options.find((o) => o.id.endsWith(":maintain"))!.id, undefined, { role: "architecte" });

    // Essai 4, accordé : la correction, sans recours ; puis la revue approuve et la phase se termine.
    await until(async () => decidePrompts.length >= 4);
    expect(decidePrompts[3]).toContain("tranché par l'humain en faveur de la lentille : à corriger, sans recours.");
    await until(async () => (await app.engine.status(id))?.status === "finished", 60_000);
    expect(app.posted.at(-1)).toContain("Pipeline skraft terminé pour **US-12**");
  }, 120_000);
});
