/**
 * D10 (docs/12) : un test unitaire existant ne s'affaiblit pas en silence. Au pas `test`, il ne
 * reçoit que des ajouts ; au pas `fix-test`, il ne se modifie que si un défaut de revue le cite
 * (pour le renforcer).
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import type { StackAdapter } from "@agent-studio/stack-adapters";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, fakeStack, put, shutdownHosts, simulatedAgents, stateOf, unitTestWriter, until } from "./support/harness.js";

const UNIT = "tests/unit/bolus-cap.test.ts";
const CODE = "src/domain/bolus-cap.ts";
const AFFAIBLI = "ne peut recevoir que des ajouts";

/**
 * Pile où un test ne passe que si le code porte sa marque (`// ac-1`, `// plafond 1`) : chaque
 * scénario demande son propre cycle, et un nouveau test unitaire est rouge.
 */
function pileParMarques(root: string): StackAdapter {
  return {
    ...fakeStack(),
    runTests: async () => {
      const lire = (p: string) => readFile(join(root, p), "utf8").catch(() => "");
      const code = await lire(CODE);
      const results: { id: string; file: string; status: "passed" | "failed"; failureKind?: "assertion"; message?: string }[] = [];
      const ajouter = (file: string, nom: string) =>
        results.push(code.includes(`// ${nom}\n`) ? { id: `${file} > ${nom}`, file, status: "passed" } : { id: `${file} > ${nom}`, file, status: "failed", failureKind: "assertion", message: "AssertionError" });
      const acc = "tests/acceptance/story.acceptance.test.ts";
      for (const m of (await lire(acc)).matchAll(/^it\("(ac-\d+)"/gm)) ajouter(acc, m[1]!);
      for (const m of (await lire(UNIT)).matchAll(/^it\("([^"]+)"/gm)) ajouter(UNIT, m[1]!);
      return { results, exitCode: results.some((r) => r.status === "failed") ? 1 : 0, timedOut: false, output: "", durationMs: 1 };
    },
  };
}

/** Développeur qui marque le scénario en cours et chaque test unitaire écrit. */
const developpeur = (root: string) => async (t: { prompt: string; callTool: (n: string, a: unknown) => Promise<unknown> }) => {
  const scenario = /Scénario en cours : (ac-\d+)/.exec(t.prompt)?.[1];
  const tests = [...(await readFile(join(root, UNIT), "utf8").catch(() => "")).matchAll(/^it\("([^"]+)"/gm)].map((m) => m[1]!);
  const avant = await readFile(join(root, CODE), "utf8").catch(() => "export class BolusCap { max = 10; }\n");
  const marques = [...(scenario ? [scenario] : []), ...tests].filter((m) => !avant.includes(`// ${m}\n`));
  await put(root, CODE, avant + marques.map((m) => `// ${m}\n`).join(""));
  await t.callTool("report_phase", { summary: "code", files: [CODE] });
};

type App = Awaited<ReturnType<typeof assemble>>;

/** Lance skraft au niveau « assez difficile » et attend la fin ; rend l'état final. */
async function lancerEtFinir(app: App) {
  answerQuestions(app);
  await app.registry.command("skraft")!.handler("stories/us-12.md");
  await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
  await app.interactions.respond((await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!.id, "medium-hard");
  const id = (await app.engine.list())[0]!.id;
  await until(async () => ["DONE", "ESCALATED", "ABORTED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 60_000);
  const s = stateOf(await app.engine.status(id))!;
  expect(s.escalation?.reason).toBeUndefined();
  expect(s.stage).toBe("DONE");
}

describe("skraft — tests unitaires existants (D10)", () => {
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
    await lancerEtFinir(await assemble(root, runtime, tasksDir, { stack: pileParMarques(root), isolated: true }));
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
    await lancerEtFinir(await assemble(root, runtime, tasksDir, { isolated: true }));
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
