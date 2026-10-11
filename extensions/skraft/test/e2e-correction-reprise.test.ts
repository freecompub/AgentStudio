/**
 * D12 (docs/12), jumeau du test du workflow : une correction ciblée de DELIVER qui échoue reprend d'un état cohérent
 * avec le disque rembobiné (empreinte des tests unitaires, référence, dernier vert), et le premier
 * agent de la reprise reçoit la cause de l'échec.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, put, shutdownHosts, simulatedAgents, stateOf, unitTestWriter, until } from "./support/harness.js";
import { CODE, developpeur, pileParMarques } from "./support/marques.js";

const DEFAUT = "cold-reader#1.1";
const ROUGES = "Tests ajoutés par la correction côté tests";

describe("skraft — reprise d'une correction ciblée (D12)", () => {
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

  it("défaut renvoyé au testeur, développeur en échec : la reprise n'est pas refusée pour des tests « modifiés », et connaît la cause", async () => {
    const devPrompts: string[] = [];
    let echecs = 0;
    let revues = 0;
    const coder = developpeur(root);
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-test": unitTestWriter(root),
      "skraft-dev": async (t) => {
        if (!t.prompt.includes(`[${DEFAUT}`) && !t.prompt.includes(ROUGES)) return coder(t);
        devPrompts.push(t.prompt);
        // Défaut de code renvoyé : il faut d'abord un test.
        if (!t.prompt.includes(ROUGES))
          return void (await t.callTool("report_phase", { summary: "renvoyé", files: [], responses: [{ defect: DEFAUT, status: "outOfScope", reason: "il faut d'abord un test de dose négative" }] }));
        // Essai 1 de la correction : du code, mais le test rouge ne passe pas (trois refus).
        if (echecs++ < 3) {
          await put(root, CODE, `export class BolusCap { max = 10; } // tentative ${echecs}\n`);
          return void (await t.callTool("report_phase", { summary: "tentative", files: [CODE] }));
        }
        await coder(t);
      },
      "skraft-lens-cold-reader": async (t) => {
        const premiere = t.prompt.includes("phase DELIVER") && revues++ === 0;
        await t.callTool("submit_lens_verdict", premiere
          ? { lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [{ severity: "major", description: "dose négative non gérée", target: "code" }] }
          : { lens: "cold-reader", verdict: "APPROVED", defects: [] });
      },
    });
    const app = await assemble(root, runtime, tasksDir, { stack: pileParMarques(root), isolated: true });
    answerQuestions(app);
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    await app.interactions.respond((await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!.id, "medium-hard");
    const id = (await app.engine.list())[0]!.id;
    await until(async () => ["DONE", "ESCALATED", "ABORTED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 60_000);
    expect(stateOf(await app.engine.status(id))!.escalation?.reason).toBeUndefined();
    expect(devPrompts.some((p) => p.includes("Les tests unitaires ont été modifiés"))).toBe(false);
    // La reprise connaît la cause de l'échec (déjà le cas dans l'extension).
    const reprise = devPrompts.find((p, i) => i > 0 && !p.includes(ROUGES));
    expect(reprise).toContain("Tests en échec");
  }, 90_000);
});
