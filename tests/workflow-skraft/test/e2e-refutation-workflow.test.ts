/**
 * Réfutateur des défauts de revue (ADR 0069), mené par le workflow en DESIGN : un défaut réfuté
 * par une citation d'un fichier qui existe ne coûte aucun tour au producteur et reste dans le
 * rapport ; une réfutation sans citation ne vaut rien, et le défaut part au producteur.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, put, shutdownHosts, simulatedAgents, until } from "./support/harness.js";

const DEFAUT = "architecture#1.1";

describe("skraft en workflow — réfutateur des défauts de revue (ADR 0069)", () => {
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

  async function run(raison: string) {
    const decidePrompts: string[] = [];
    const refuterPrompts: string[] = [];
    let lentille = 0;
    const decide: ScriptedBehavior = async (t) => {
      decidePrompts.push(t.prompt);
      await put(root, ".skraft/us12-f15ade30/design/contracts.md", "`BolusCapped`\n");
      await t.callTool("report_phase", { summary: "décisions", files: [] });
    };
    const architecture: ScriptedBehavior = async (t) => {
      lentille++;
      if (lentille === 1)
        return void (await t.callTool("submit_lens_verdict", {
          lens: "architecture",
          verdict: "CHANGES_REQUESTED",
          defects: [{ severity: "major", severityReason: "Un contrat doit se lire seul.", occurrences: [".skraft/us12-f15ade30/design/event-model.md:1", "absent/inexistant.md:3"], description: "contracts.md ne nomme pas l'agrégat.", file: ".skraft/us12-f15ade30/design/contracts.md", target: "deliverable" }],
        }));
      await t.callTool("submit_lens_verdict", { lens: "architecture", verdict: "APPROVED", defects: [] });
    };
    const refuter: ScriptedBehavior = async (t) => {
      refuterPrompts.push(t.prompt);
      await t.callTool("submit_lens_verdict", { lens: "finding-refuter", verdict: "APPROVED", defects: [], rulings: [{ defect: DEFAUT, decision: "accepted", reason: raison }] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-architect-decide": decide, "skraft-lens-architecture": architecture, "skraft-finding-refuter": refuter });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const difficulty = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(difficulty.id, difficulty.options.find((o) => o.id.endsWith(":medium"))!.id);
    return { app, decidePrompts, refuterPrompts };
  }

  it("défaut réfuté par une citation d'un fichier qui existe : aucun tour de plus pour l'architecte, la phase passe, le rapport garde la réfutation", async () => {
    const raison = "L'agrégat est nommé en `.skraft/us12-f15ade30/design/contracts.md:1` (BolusCapped).";
    const { app, decidePrompts, refuterPrompts } = await run(raison);
    await until(async () => (await app.engine.list())[0]?.phase === "DISTILL", 60_000);
    expect(refuterPrompts).toHaveLength(1);
    // Le réfutateur reçoit le défaut, numéroté par le code, et les entrées de la lentille.
    expect(refuterPrompts[0]).toContain(`[${DEFAUT}]`);
    expect(refuterPrompts[0]).toContain("contracts.md ne nomme pas l'agrégat.");
    expect(refuterPrompts[0]).toContain(".skraft/us12-f15ade30/design/contracts.md");
    expect(decidePrompts).toHaveLength(1);
    const rapport = JSON.parse(await readFile(join(root, ".skraft/us12-f15ade30/reviews/design-review-1.json"), "utf8")) as { lens: string; verdict: string; refuted?: { id: string; refutation: string }[] }[];
    expect(rapport.find((l) => l.lens === "architecture")).toMatchObject({ verdict: "APPROVED", refuted: [{ id: DEFAUT, refutation: raison }] });
    const md = await readFile(join(root, ".skraft/us12-f15ade30/reviews/design-review-1.md"), "utf8");
    expect(md).toContain(`- réfuté : \`${DEFAUT}\` **major** contracts.md ne nomme pas l'agrégat. — ${raison}`);
  }, 90_000);

  it("réfutation sans citation : le code ne la retient pas, le défaut part à l'architecte", async () => {
    const { decidePrompts } = await run("C'est faux, l'agrégat est nommé.");
    await until(async () => decidePrompts.length >= 2, 60_000);
    expect(decidePrompts[1]).toContain(`[${DEFAUT}, major, deliverable] contracts.md ne nomme pas l'agrégat. (.skraft/us12-f15ade30/design/contracts.md) — gravité : Un contrat doit se lire seul. — aussi : .skraft/us12-f15ade30/design/event-model.md:1`);
    // L'occurrence qui vise un fichier absent est retirée par le code.
    expect(decidePrompts[1]).not.toContain("absent/inexistant.md");
  }, 90_000);
});
