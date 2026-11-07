/**
 * D10 (docs/12) : un test unitaire existant ne s'affaiblit pas en silence. Au pas `test`, il ne
 * reçoit que des ajouts ; au pas `fix-test`, il ne se modifie que si un défaut de revue le cite
 * (pour le renforcer).
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, put, shutdownHosts, simulatedAgents, unitTestWriter } from "./support/harness.js";
import { fin, lancerWorkflow } from "./support/fin.js";
import { developpeur, pileParMarques, UNIT } from "./support/marques.js";

const AFFAIBLI = "ne peut recevoir que des ajouts";

describe("skraft en workflow — tests unitaires existants (D10)", () => {
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

  it("pas test : un test existant affaibli est refusé ; le testeur repart avec le motif", async () => {
    const prompts: string[] = [];
    const ecrire = unitTestWriter(root);
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-test": async (t) => {
        prompts.push(t.prompt);
        await ecrire(t);
        // Deuxième scénario : en plus du nouveau test, il affaiblit celui du premier.
        if (prompts.length === 2) {
          const contenu = await readFile(join(root, UNIT), "utf8");
          await put(root, UNIT, contenu.replace('it("plafond 1", () => expect(new BolusCap().max).toBe(10));', 'it("plafond 1", () => expect(new BolusCap()).toBeDefined());'));
        }
      },
      "skraft-dev": developpeur(root),
    });
    const app = await assemble(root, runtime, tasksDir, { stack: pileParMarques(root) });
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await fin(app, id, 60_000);
    expect(prompts[2]).toContain(AFFAIBLI);
    expect(await readFile(join(root, UNIT), "utf8")).toContain('it("plafond 1", () => expect(new BolusCap().max).toBe(10));');
  }, 90_000);

  const correction = async (citeLeFichier: boolean) => {
    const prompts: string[] = [];
    let revues = 0;
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-test": async (t) => {
        prompts.push(t.prompt);
        if (!t.prompt.includes("[cold-reader#1.1")) return unitTestWriter(root)(t);
        const contenu = await readFile(join(root, UNIT), "utf8");
        if (!t.prompt.includes(AFFAIBLI)) {
          // Renforcement demandé : il réécrit l'assertion du test existant.
          await put(root, UNIT, contenu.replace(".toBe(10));", ".toStrictEqual(10));"));
        } else {
          await put(root, UNIT, `${contenu}it("plafond strict", () => expect(new BolusCap().max).toStrictEqual(10));\n`);
        }
        await t.callTool("report_phase", { summary: "renforcé", files: [UNIT], responses: [{ defect: "cold-reader#1.1", status: "fixed" }] });
      },
      "skraft-lens-cold-reader": async (t) => {
        const premiere = t.prompt.includes("phase DELIVER") && revues++ === 0;
        await t.callTool("submit_lens_verdict", premiere
          ? { lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [{ severity: "major", description: "assertion trop faible : toBe sur un nombre", target: "test", ...(citeLeFichier ? { file: UNIT } : {}) }] }
          : { lens: "cold-reader", verdict: "APPROVED", defects: [] });
      },
    });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await fin(app, id, 60_000);
    return { prompts, contenu: await readFile(join(root, UNIT), "utf8") };
  };

  it("pas fix-test : un défaut qui cite le test permet de le renforcer en le modifiant", async () => {
    const { prompts, contenu } = await correction(true);
    expect(prompts.some((p) => p.includes(AFFAIBLI))).toBe(false);
    expect(contenu).toContain(".toStrictEqual(10));");
    expect(contenu).not.toContain("plafond strict");
  }, 90_000);

  it("pas fix-test : sans défaut qui cite le test, la modification est refusée ; il ajoute un test", async () => {
    const { prompts, contenu } = await correction(false);
    expect(prompts.some((p) => p.includes(AFFAIBLI))).toBe(true);
    expect(contenu).toContain("plafond strict");
  }, 90_000);
});
