/**
 * ADR rattachés à leur story (ADR 0055, point 7) : le code inscrit `Story : <slug>` ; un ADR d'une
 * autre story modifié par l'architecte est restauré, et le tour est rejeté avec le motif.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderAdr } from "../../../workflows/skraft/adr.mjs";
import { answerQuestions, assemble, createProject, git, put, shutdownHosts, simulatedAgents, until } from "./support/harness.js";
import { lancerWorkflow } from "./support/fin.js";

const AUTRE = `# ADR-001 — Arrondi des doses\n\n- Statut : Proposed\n- Date : 2026-09-01\n- Story : us-99\n\n## Contexte\n\nx\n\n## Décision\n\nx\n\n## Conséquences\n\nx\n\n## Alternatives\n\nx\n`;
const ADR = { title: "Plafond appliqué dans le domaine", status: "Proposed", context: "c", decision: "d", consequences: "q", alternatives: "a" };

describe("skraft en workflow — ADR rattachés à leur story", () => {
  let root: string;
  let tasksDir: string;
  beforeEach(async () => {
    root = await createProject();
    await put(root, "docs/adr/adr-001-arrondi-des-doses.md", AUTRE);
    git(root, "add", "-A");
    git(root, "commit", "-qm", "ADR d'une autre story");
    tasksDir = await mkdtemp(join(tmpdir(), "agent-studio-skraft-tasks-"));
  });
  afterEach(async () => {
    await shutdownHosts();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(tasksDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("l'ADR d'une autre story modifié est restauré, le tour rejeté ; le nouvel ADR est marqué par le code", async () => {
    const prompts: string[] = [];
    const decide: ScriptedBehavior = async (t) => {
      prompts.push(t.prompt);
      await put(root, ".skraft/us-12/design/contracts.md", "`BolusCapped`\n");
      // Premier essai : l'architecte « corrige » l'ADR d'une autre story.
      if (prompts.length === 1) await put(root, "docs/adr/adr-001-arrondi-des-doses.md", AUTRE.replace("Arrondi des doses", "Arrondi supprimé"));
      await put(root, "docs/adr/adr-002-plafond-applique-dans-le-domaine.md", renderAdr(2, ADR, "2026-10-10"));
      await t.callTool("report_phase", { summary: "décisions", files: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-architect-decide": decide });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await lancerWorkflow(app, "stories/us-12.md", "medium");

    await until(async () => prompts.length >= 2, 60_000);
    expect(prompts[1]).toContain("docs/adr/adr-001-arrondi-des-doses.md : cet ADR appartient à une autre story ou est déjà décidé");
    expect(await readFile(join(root, "docs/adr/adr-001-arrondi-des-doses.md"), "utf8")).toBe(AUTRE);
    // Seul l'ADR de cette story est soumis à ratification ; le code l'a marqué, même réécrit au tour 2.
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Ratifier")), 60_000);
    expect((await app.interactions.pending()).filter((p) => p.title.startsWith("Ratifier")).map((p) => p.title)).toEqual(["Ratifier ADR-002"]);
    expect(await readFile(join(root, "docs/adr/adr-002-plafond-applique-dans-le-domaine.md"), "utf8")).toContain("- Story : us-12");
  }, 120_000);
});
