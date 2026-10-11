/**
 * D22 (docs/12), ADR 0065, jumeau du test du workflow : un mutant survivant contesté par le testeur (mutant équivalent) est
 * jugé par l'arbitre de mutation. Équivalent : dérogation, le mutant sort de la porte. Non
 * équivalent, ou plafond de dérogations atteint : l'humain tranche. Chaque décision est tracée,
 * et les dérogations sont commitées avec DELIVER.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import type { StackAdapter } from "@agent-studio/stack-adapters";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, fakeStack, git, put, shutdownHosts, simulatedAgents, stateOf, unitTestWriter, until } from "./support/harness.js";

const CODE = "src/domain/bolus-cap.ts";
const UNIT = "tests/unit/bolus-cap.test.ts";
const TUEUR = "tue-mutant";

type App = Awaited<ReturnType<typeof assemble>>;

/** Mutants survivants aux lignes données, tant qu'aucun test ne les tue. */
function pileAvecMutants(root: string, lignes: number[]): StackAdapter {
  return {
    ...fakeStack(),
    mutation: async () => {
      const tues = (await readFile(join(root, UNIT), "utf8").catch(() => "")).includes(TUEUR);
      const survived = tues ? [] : lignes.map((line) => ({ line, operator: "EqualityOperator", replacement: "dose >= max" }));
      const total = lignes.length + 1;
      const killed = total - survived.length;
      return { score: (killed / total) * 100, files: [{ file: CODE, score: (killed / total) * 100, killed, total, survived }] };
    },
  };
}

/** Testeur : TDD ordinaire ; en correction de mutation, conteste (équivalent), ou tue le mutant si l'humain l'exige. */
const testeur = (root: string): ScriptedBehavior => {
  const ecrire = unitTestWriter(root);
  return async (t) => {
    const ids = [...t.prompt.matchAll(/\[(mutation#[\d.]+)/g)].map((m) => m[1]!);
    if (!ids.length) return ecrire(t);
    if (t.prompt.includes("tranché par l'humain")) {
      const contenu = await readFile(join(root, UNIT), "utf8");
      await put(root, UNIT, `${contenu}it("${TUEUR}", () => expect(1).toBe(1));\n`);
      return void (await t.callTool("report_phase", { summary: "mutant tué", files: [UNIT], responses: ids.map((defect) => ({ defect, status: "fixed" })) }));
    }
    await t.callTool("report_phase", {
      summary: "contesté",
      files: [],
      responses: [...new Set(ids)].map((defect) => ({ defect, status: "contested", reason: "mutant équivalent : à dose == max, les deux branches rendent max" })),
    });
  };
};

/** Arbitre : `accepted` (équivalent) ou `maintained` pour chaque défaut cité. */
const arbitre = (decision: "accepted" | "maintained", prompts: string[]): ScriptedBehavior => async (t) => {
  prompts.push(t.prompt);
  const ids = [...new Set([...t.prompt.matchAll(/\[(mutation#[\d.]+)/g)].map((m) => m[1]!))];
  await t.callTool("submit_lens_verdict", {
    lens: "mutation-arbiter",
    verdict: "APPROVED",
    defects: [],
    rulings: ids.map((defect) => ({ defect, decision, reason: decision === "accepted" ? "équivalent : même valeur à dose == max" : "un test à dose == max le distingue" })),
  });
};

const arbitrages = async (app: App, id: string) =>
  ((await app.trace.list(id)).filter((e) => e.kind === "arbitrage") as { décision: string; par: string; élément: string; porte: string }[]).map((a) => [a.par, a.décision]);

const repondreArbitrage = async (app: App, choix: "derogation" | "corriger", commentaire?: string) => {
  await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Arbitrer un mutant")), 60_000);
  const q = (await app.interactions.pending()).find((p) => p.title.startsWith("Arbitrer un mutant"))!;
  await app.interactions.respond(q.id, q.options.find((o) => o.id.startsWith(`${choix}:`))!.id, commentaire, { role: "architecte" });
  return q;
};

const commitDeLivraison = (root: string) => git(root, "log", "--format=%H %s").split("\n").find((l) => l.endsWith("feat(us-12): livraison de la story"))!.split(" ")[0]!;

/** Lance skraft au niveau « assez difficile » ; rend l'identifiant de la tâche. */
async function lancer(app: App): Promise<string> {
  await app.registry.command("skraft")!.handler("stories/us-12.md");
  await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
  await app.interactions.respond((await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!.id, "medium-hard");
  return (await app.engine.list())[0]!.id;
}

/** Attend la fin ; une escalade fait échouer le test avec son motif. */
async function finie(app: App, id: string) {
  await until(async () => ["DONE", "ESCALATED", "ABORTED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 60_000);
  const s = stateOf(await app.engine.status(id))!;
  expect(s.escalation?.reason).toBeUndefined();
  expect(s.stage).toBe("DONE");
}

describe("skraft — arbitrage d'un mutant contesté (D22, ADR 0065)", () => {
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

  it("équivalent selon l'arbitre : dérogation tracée, commitée, montrée aux lentilles ; livré", async () => {
    const arbitrePrompts: string[] = [];
    const lensPrompts: string[] = [];
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-test": testeur(root),
      "skraft-mutation-arbiter": arbitre("accepted", arbitrePrompts),
      // test-integrity reçoit les faits établis par le code (cold-reader, lui, n'en reçoit aucun).
      "skraft-lens-test-integrity": async (t) => {
        if (t.prompt.includes("phase DELIVER")) lensPrompts.push(t.prompt);
        await t.callTool("submit_lens_verdict", { lens: "test-integrity", verdict: "APPROVED", defects: [] });
      },
    });
    const app = await assemble(root, runtime, tasksDir, { stack: pileAvecMutants(root, [1]), isolated: true });
    answerQuestions(app);
    const id = await lancer(app);
    await finie(app, id);
    expect(arbitrePrompts[0]).toContain("mutant équivalent : à dose == max");
    expect(arbitrePrompts[0]).toContain("dose >= max");
    expect(await arbitrages(app, id)).toEqual([["agent", "dérogation"]]);
    const fichier = git(root, "show", `${commitDeLivraison(root)}:.skraft/us-12/deliver/derogations.md`);
    expect(fichier).toContain(`${CODE}:1 (EqualityOperator)`);
    expect(fichier).toContain("équivalent : même valeur à dose == max");
    expect(lensPrompts.at(-1)).toContain(`Dérogation de mutation (agent) : ${CODE}:1 (EqualityOperator)`);
    expect(app.posted.at(-1)).toContain("Dérogations de mutation : 1");
  }, 90_000);

  it("non équivalent selon l'arbitre : l'humain accorde la dérogation, les deux décisions sont tracées", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-test": testeur(root),
      "skraft-mutation-arbiter": arbitre("maintained", []),
    });
    const app = await assemble(root, runtime, tasksDir, { stack: pileAvecMutants(root, [1]), isolated: true });
    answerQuestions(app);
    const id = await lancer(app);
    const q = await repondreArbitrage(app, "derogation", "équivalent, vérifié à la main");
    expect(q.detail).toContain("mutant équivalent : à dose == max");
    expect(q.detail).toContain("un test à dose == max le distingue");
    await finie(app, id);
    expect(await arbitrages(app, id)).toEqual([["agent", "à corriger"], ["humain", "dérogation"]]);
    expect(git(root, "show", `${commitDeLivraison(root)}:.skraft/us-12/deliver/derogations.md`)).toContain("équivalent, vérifié à la main");
  }, 90_000);

  it("l'humain exige la correction : le testeur tue le mutant, aucune dérogation", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-test": testeur(root),
      "skraft-mutation-arbiter": arbitre("maintained", []),
    });
    const app = await assemble(root, runtime, tasksDir, { stack: pileAvecMutants(root, [1]), isolated: true });
    answerQuestions(app);
    const id = await lancer(app);
    await repondreArbitrage(app, "corriger");
    await finie(app, id);
    expect(await arbitrages(app, id)).toEqual([["agent", "à corriger"], ["humain", "à corriger"]]);
    expect(await readFile(join(root, UNIT), "utf8")).toContain(TUEUR);
    expect(git(root, "ls-tree", "-r", "--name-only", commitDeLivraison(root), ".skraft/us-12/deliver/")).not.toContain("derogations.md");
  }, 90_000);

  it("plafond : au-delà de deux dérogations accordées par l'arbitre, l'humain tranche", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-test": testeur(root),
      "skraft-mutation-arbiter": arbitre("accepted", []),
    });
    const app = await assemble(root, runtime, tasksDir, { stack: pileAvecMutants(root, [1, 2, 3]), isolated: true });
    answerQuestions(app);
    const id = await lancer(app);
    await repondreArbitrage(app, "derogation", "équivalent aussi");
    await finie(app, id);
    expect(await arbitrages(app, id)).toEqual([["agent", "dérogation"], ["agent", "dérogation"], ["humain", "dérogation"]]);
  }, 90_000);
});
