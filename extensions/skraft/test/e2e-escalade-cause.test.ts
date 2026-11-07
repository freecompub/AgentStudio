/**
 * Escalade d'un scénario selon sa cause (ADR 0066, révisé le 07/11), jumeau du test du workflow.
 * Le code sait pourquoi le scénario échoue, et propose ce qui peut réussir :
 * - un test qui passait avant DELIVER et que la story fait échouer : l'humain le déclare obsolète ;
 *   il sort des portes, le cycle se termine, et le bilan rappelle de le mettre à jour (comme les
 *   défauts hors du changement) ;
 * - des lignes du scénario non couvertes : l'humain les exempte (dérogation, ADR 0065).
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import type { StackAdapter } from "@agent-studio/stack-adapters";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, fakeStack, git, put, shutdownHosts, simulatedAgents, stateOf, until } from "./support/harness.js";

const CODE = "src/domain/bolus-cap.ts";
const ANCIEN = "tests/legacy/bolus.test.ts > la dose proposée est celle du calcul";
type App = Awaited<ReturnType<typeof assemble>>;

/** Un test plus ancien que la story : vert tant que le plafond n'existe pas, rouge ensuite. */
function pileAvecTestAncien(): StackAdapter {
  const stack = fakeStack();
  const run = stack.runTests;
  stack.runTests = async (opts) => {
    const r = await run(opts);
    const plafond = await readFile(join(opts.root, CODE), "utf8").then(() => true, () => false);
    const ancien = plafond
      ? { id: ANCIEN, file: "tests/legacy/bolus.test.ts", status: "failed" as const, failureKind: "assertion" as const, message: "expected 10 to be 12.5" }
      : { id: ANCIEN, file: "tests/legacy/bolus.test.ts", status: "passed" as const };
    return { ...r, results: [...r.results, ancien], exitCode: plafond ? 1 : r.exitCode };
  };
  return stack;
}

/** La ligne 1 du code du scénario n'est jamais couverte (code défensif inatteignable). */
function pileLigneNonCouverte(): StackAdapter {
  const stack = fakeStack();
  const run = stack.runTests;
  stack.runTests = async (opts) => ({ ...(await run(opts)), coverage: { files: [{ file: CODE, covered: 0, total: 1, score: 0, lines: [{ number: 1, covered: false }] }] } });
  return stack;
}

async function lancer(app: App): Promise<string> {
  await app.registry.command("skraft")!.handler("stories/us-12.md");
  await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
  await app.interactions.respond((await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!.id, "medium-hard");
  return (await app.engine.list())[0]!.id;
}

async function escalade(app: App) {
  await until(async () => (await app.interactions.pending()).some((p) => p.title === "Pipeline skraft bloqué (DELIVER)"), 60_000);
  return (await app.interactions.pending()).find((p) => p.title === "Pipeline skraft bloqué (DELIVER)")!;
}

async function finie(app: App, id: string) {
  await until(async () => ["DONE", "ESCALATED", "ABORTED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 60_000);
  expect(stateOf(await app.engine.status(id))!.escalation?.reason).toBeUndefined();
  expect(stateOf(await app.engine.status(id))!.stage).toBe("DONE");
  // Le bilan est publié par un effet, après la transition vers DONE.
  await until(async () => app.posted.some((p) => p.startsWith("Pipeline skraft terminé")), 60_000);
  return app.posted.find((p) => p.startsWith("Pipeline skraft terminé"))!;
}

const arbitrages = async (app: App, id: string) =>
  ((await app.trace.list(id)).filter((e) => e.kind === "arbitrage") as { porte: string; élément: string; décision: string; par: string; raison: string }[]).map((a) => [a.porte, a.élément, a.décision, a.par, a.raison]);

describe("skraft — escalade d'un scénario selon sa cause (ADR 0066)", () => {
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

  it("test existant obsolète : l'escalade le nomme et propose de le déclarer obsolète ; il sort des portes, le cycle se termine, le bilan rappelle de le mettre à jour", async () => {
    const app = await assemble(root, simulatedAgents(new ScriptedRuntime(), root), tasksDir, { stack: pileAvecTestAncien() });
    answerQuestions(app);
    const id = await lancer(app);

    const q = await escalade(app);
    expect(q.detail).toContain(`Tests qui passaient avant DELIVER et que la story fait échouer : ${ANCIEN}`);
    expect(q.options.map((o) => o.id)).toEqual(["obsolete", "retry", "skip", "abort"]);
    expect(q.options[0]!.label).toBe("Déclarer ces tests obsolètes et continuer");
    await app.interactions.respond(q.id, "obsolete", "la story plafonne la dose", { role: "architecte" });

    const bilan = await finie(app, id);
    expect(await arbitrages(app, id)).toContainEqual(["tests existants", ANCIEN, "obsolète", "humain", "la story plafonne la dose"]);
    expect(await readFile(join(root, ".skraft/us-12/deliver/derogations.md"), "utf8")).toContain(ANCIEN);
    expect(git(root, "log", "--format=%s", "-1", "--", ".skraft/us-12/deliver/derogations.md")).toMatch(/livraison de la story/);
    expect(bilan).toContain("À corriger après le cycle");
    expect(bilan).toContain(`- mettre à jour ${ANCIEN} : déclaré obsolète au scénario ac-1 (la story plafonne la dose).`);
  }, 120_000);

  it("lignes non couvertes du scénario : l'escalade propose d'exempter ces lignes ; dérogation tracée et commitée, le scénario repart et passe", async () => {
    await put(root, ".agent-studio/projet.yaml", "qualite:\n  couverture:\n    domaine: 100\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "barre de qualité");
    const app = await assemble(root, simulatedAgents(new ScriptedRuntime(), root), tasksDir, { stack: pileLigneNonCouverte() });
    answerQuestions(app);
    const id = await lancer(app);

    const q = await escalade(app);
    expect(q.detail).toContain(`Lignes du scénario non couvertes : ${CODE}:1`);
    expect(q.options.map((o) => o.id)).toEqual(["exempt", "retry", "skip", "abort"]);
    expect(q.options[0]!.label).toBe("Exempter ces lignes et continuer");
    await app.interactions.respond(q.id, "exempt", "garde défensive", { role: "architecte" });

    await finie(app, id);
    expect(await arbitrages(app, id)).toContainEqual(["couverture du diff", `${CODE}:1`, "dérogation", "humain", "garde défensive"]);
    expect(await readFile(join(root, ".skraft/us-12/deliver/derogations.md"), "utf8")).toContain(`${CODE}:1`);
  }, 120_000);
});
