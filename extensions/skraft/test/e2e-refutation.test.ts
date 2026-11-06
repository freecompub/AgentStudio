/**
 * Réfutateur des défauts de revue (ADR 0069), mené par l'extension en DELIVER : un défaut réfuté
 * par une citation d'un fichier qui existe ne coûte aucun tour au développeur et reste dans le
 * rapport ; une réfutation sans citation ne vaut rien, et le défaut part au développeur.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, put, shutdownHosts, simulatedAgents, stateOf, until } from "./support/harness.js";

type App = Awaited<ReturnType<typeof assemble>>;
const DEFAUT = "cold-reader#1.1";

describe("skraft — réfutateur des défauts de revue (ADR 0069)", () => {
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
    const devPrompts: string[] = [];
    const refuterPrompts: string[] = [];
    let deliverReviews = 0;
    const dev: ScriptedBehavior = async (t) => {
      devPrompts.push(t.prompt);
      await put(root, "src/domain/bolus-cap.ts", t.prompt.includes(`[${DEFAUT}`) ? "export class PlafondDeBolus {}\nexport { PlafondDeBolus as BolusCap };\n" : "export class BolusCap {}\n");
      await t.callTool("report_phase", { summary: "code", files: ["src/domain/bolus-cap.ts"], ...(t.prompt.includes(`[${DEFAUT}`) ? { responses: [{ defect: DEFAUT, status: "fixed" }] } : {}) });
    };
    const coldReader: ScriptedBehavior = async (t) => {
      const premiere = t.prompt.includes("phase DELIVER") && deliverReviews++ === 0;
      await t.callTool("submit_lens_verdict", premiere
        ? { lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [{ severity: "major", description: "nom vague : BolusCap", file: "src/domain/bolus-cap.ts", line: 1, target: "code" }] }
        : { lens: "cold-reader", verdict: "APPROVED", defects: [] });
    };
    const refuter: ScriptedBehavior = async (t) => {
      refuterPrompts.push(t.prompt);
      await t.callTool("submit_lens_verdict", { lens: "finding-refuter", verdict: "APPROVED", defects: [], rulings: [{ defect: DEFAUT, decision: "accepted", reason: raison }] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-dev": dev, "skraft-lens-cold-reader": coldReader, "skraft-finding-refuter": refuter });
    const app: App = await assemble(root, runtime, tasksDir, { isolated: true });
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    answerQuestions(app);
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const req = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(req.id, req.options[0]!.id);
    const id = (await app.engine.list())[0]!.id;
    await until(async () => ["DONE", "ESCALATED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 60_000);
    return { app, id, devPrompts, refuterPrompts };
  }

  it("défaut réfuté par une citation d'un fichier qui existe : aucun tour de correction, livré, le rapport garde la réfutation", async () => {
    const raison = "`src/domain/bolus-cap.ts:1` nomme la classe comme le contrat ratifié.";
    const { app, id, devPrompts, refuterPrompts } = await run(raison);
    expect(stateOf(await app.engine.status(id))!.stage).toBe("DONE");
    expect(refuterPrompts).toHaveLength(1);
    expect(refuterPrompts[0]).toContain(`[${DEFAUT}] (major) nom vague : BolusCap (src/domain/bolus-cap.ts:1)`);
    expect(devPrompts.some((p) => p.includes(`[${DEFAUT}`))).toBe(false);
    const dossier = join(root, ".skraft/us-12/reviews");
    const fichier = (await readdir(dossier)).find((f) => f.startsWith("deliver-review-") && f.endsWith(".md"))!;
    expect(await readFile(join(dossier, fichier), "utf8")).toContain(`- réfuté : \`${DEFAUT}\` **major** nom vague : BolusCap — ${raison}`);
  }, 90_000);

  it("réfutation sans citation : le code ne la retient pas, le défaut part au développeur", async () => {
    const { devPrompts } = await run("C'est faux, le nom est clair.");
    expect(devPrompts.some((p) => p.includes(`[${DEFAUT}, major, code] nom vague : BolusCap`))).toBe(true);
  }, 90_000);
});
