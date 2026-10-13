/**
 * Couverture du diff contestée en fin de DELIVER (suite de D22, docs/12) : l'humain tranche.
 * Dérogation : les lignes sortent du calcul, la décision est tracée et commitée. « À tester » : le
 * testeur doit les couvrir. Cas visé : une source écrite hors des scénarios (ici en DISTILL), que
 * seule la porte de fin de DELIVER mesure.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import type { StackAdapter } from "@agent-studio/stack-adapters";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptanceWriter, answerQuestions, assemble, createProject, fakeStack, git, put, shutdownHosts, simulatedAgents, unitTestWriter, until } from "./support/harness.js";
import { fin, lancerWorkflow } from "./support/fin.js";

const CODE = "src/domain/bolus-cap.ts";
const STUB = "src/domain/bolus-stub.ts";
const UNIT = "tests/unit/bolus-cap.test.ts";
type App = Awaited<ReturnType<typeof assemble>>;

/** Couverture : le code des scénarios est couvert ; la ligne 2 de la source de DISTILL seulement si un test la marque `couvre-2`. */
function pileCouverture(root: string): StackAdapter {
  const stack = fakeStack();
  const run = stack.runTests;
  stack.runTests = async (opts) => {
    const r = await run(opts);
    const couverte = (await readFile(join(root, UNIT), "utf8").catch(() => "")).includes("couvre-2");
    return {
      ...r,
      coverage: {
        files: [
          { file: CODE, covered: 1, total: 1, score: 100, lines: [{ number: 1, covered: true }] },
          { file: STUB, covered: couverte ? 2 : 1, total: 2, score: couverte ? 100 : 50, lines: [{ number: 1, covered: true }, { number: 2, covered: couverte }] },
        ],
      },
    };
  };
  return stack;
}

const testeur = (root: string): ScriptedBehavior => {
  const ecrire = unitTestWriter(root);
  return async (t) => {
    const ids = [...new Set([...t.prompt.matchAll(/\[(couverture#[\d.]+)/g)].map((m) => m[1]!))];
    if (!ids.length) return ecrire(t);
    if (t.prompt.includes("tranché par l'humain")) {
      await put(root, UNIT, `${await readFile(join(root, UNIT), "utf8")}it("couvre-2", () => expect(1).toBe(1));\n`);
      return void (await t.callTool("report_phase", { summary: "couvert", files: [UNIT], responses: ids.map((defect) => ({ defect, status: "fixed" })) }));
    }
    await t.callTool("report_phase", { summary: "contesté", files: [], responses: ids.map((defect) => ({ defect, status: "contested", reason: "ligne défensive : le plafond est validé en amont" })) });
  };
};

/** Agent d'acceptance : écrit aussi une source à deux lignes, que les scénarios ne touchent pas. */
const acceptance = (root: string): ScriptedBehavior => {
  const ecrire = acceptanceWriter(root);
  return async (t) => {
    await put(root, STUB, "export const plafonner = (d: number, m: number) => Math.min(d, m);\nexport const defensif = 1;\n");
    await ecrire(t);
  };
};

const arbitrages = async (app: App, id: string) =>
  ((await app.trace.list(id)).filter((e) => e.kind === "arbitrage") as { décision: string; par: string; porte: string }[]).map((a) => [a.porte, a.par, a.décision]);

async function trancher(app: App, choix: "derogation" | "corriger", commentaire?: string) {
  await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Arbitrer un défaut de couverture")), 60_000);
  const q = (await app.interactions.pending()).find((p) => p.title.startsWith("Arbitrer un défaut de couverture"))!;
  expect(q.detail).toContain("ligne défensive");
  await app.interactions.respond(q.id, q.options.find((o) => o.id.endsWith(`:${choix}`))!.id, commentaire, { role: "architecte" });
}

describe("skraft en workflow — couverture du diff contestée, arbitrée par l'humain", () => {
  let root: string;
  let tasksDir: string;
  beforeEach(async () => {
    root = await createProject();
    await put(root, ".skraft/quality.json", '{"coverage":{"core":90},"mutation":{"active":false}}\n');
    git(root, "add", "-A");
    git(root, "commit", "-qm", "barre de qualité");
    tasksDir = await mkdtemp(join(tmpdir(), "agent-studio-skraft-tasks-"));
  });
  afterEach(async () => {
    await shutdownHosts();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(tasksDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("dérogation : la ligne sort du calcul, la décision est tracée, commitée et rapportée", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-test": testeur(root), "skraft-acceptance": acceptance(root) });
    const app = await assemble(root, runtime, tasksDir, { stack: pileCouverture(root) });
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await trancher(app, "derogation", "défensif, validé par l'écran de réglage");
    await fin(app, id, 60_000);
    expect(await arbitrages(app, id)).toEqual([["couverture du diff", "humain", "dérogation"]]);
    const livraison = git(root, "log", "--format=%H %s").split("\n").find((l) => l.endsWith("feat(us-12): livraison de la story"))!.split(" ")[0]!;
    const fichier = git(root, "show", `${livraison}:.skraft/us-12/deliver/derogations.md`);
    expect(fichier).toContain(`${STUB}:2`);
    expect(fichier).toContain("défensif, validé par l'écran de réglage");
    expect(app.posted.at(-1)).toContain("Lignes exemptées de la couverture du diff : 1");
  }, 90_000);

  it("à tester : le testeur doit couvrir la ligne, sans recours", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-test": testeur(root), "skraft-acceptance": acceptance(root) });
    const app = await assemble(root, runtime, tasksDir, { stack: pileCouverture(root) });
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await trancher(app, "corriger");
    await fin(app, id, 60_000);
    expect(await arbitrages(app, id)).toEqual([["couverture du diff", "humain", "à corriger"]]);
    expect(await readFile(join(root, UNIT), "utf8")).toContain("couvre-2");
  }, 90_000);
});
