/**
 * D19 (docs/12), jumeau du test du workflow : un commit de phase en échec ne rembobine pas une phase approuvée. L'humain
 * relance le commit seul, continue sans commiter (tracé, fichiers inclus dans le commit suivant),
 * ou abandonne.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, git, ROLE, shutdownHosts, simulatedAgents, stateOf, until } from "./support/harness.js";

const DESIGN = "docs(skraft): design de us12-f15ade30";
type App = Awaited<ReturnType<typeof assemble>>;

async function escaladeDuCommit(app: App) {
  await until(async () => (await app.interactions.pending()).some((p) => p.detail?.includes("Commit impossible")), 60_000);
  return (await app.interactions.pending()).find((p) => p.detail?.includes("Commit impossible"))!;
}

async function lancer(app: App): Promise<string> {
  await app.registry.command("skraft")!.handler("stories/us-12.md");
  await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
  await app.interactions.respond((await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!.id, "medium");
  return (await app.engine.list())[0]!.id;
}

async function finie(app: App, id: string) {
  await until(async () => ["DONE", "ESCALATED", "ABORTED"].includes(stateOf(await app.engine.status(id))?.stage ?? "") && !(await app.interactions.pending()).length, 60_000);
  expect(stateOf(await app.engine.status(id))!.stage).toBe("DONE");
  // Le rapport final est publié par un effet, après la transition vers DONE : on l'attend aussi.
  await until(async () => app.posted.some((p) => p.includes("Pipeline skraft terminé")), 60_000);
}

describe("skraft — commit de phase en échec (D19)", () => {
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

  it("relancer : le commit seul est refait, la phase n'est pas rejouée", async () => {
    let echecs = 0;
    const runtime = simulatedAgents(new ScriptedRuntime(), root);
    const app = await assemble(root, runtime, tasksDir, { commitEchoue: (m) => m === DESIGN && echecs++ === 0, isolated: true });
    answerQuestions(app);
    const id = await lancer(app);
    const q = await escaladeDuCommit(app);
    expect(q.detail).toContain("index.lock");
    expect(q.options.map((o) => o.label)).toEqual(["Relancer le commit", "Continuer sans commiter", "Abandonner"]);
    await app.interactions.respond(q.id, "retry", undefined, { role: "architecte" });
    await finie(app, id);
    expect(runtime.history.filter((h) => runtime.configs.get(h.id)!.role === ROLE("skraft-architect-model"))).toHaveLength(1);
    expect(git(root, "log", "--format=%s")).toContain(DESIGN);
  }, 90_000);

  it("continuer sans commiter : fichiers gardés et commités avec la phase suivante ; le choix est tracé et rapporté", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root);
    const app = await assemble(root, runtime, tasksDir, { commitEchoue: (m) => m === DESIGN, isolated: true });
    answerQuestions(app);
    const id = await lancer(app);
    const q = await escaladeDuCommit(app);
    await app.interactions.respond(q.id, "continue", undefined, { role: "architecte" });
    await finie(app, id);
    expect(runtime.history.filter((h) => runtime.configs.get(h.id)!.role === ROLE("skraft-architect-model"))).toHaveLength(1);
    expect(git(root, "log", "--format=%s")).not.toContain(DESIGN);
    const distill = git(root, "log", "--format=%H %s").split("\n").find((l) => l.endsWith("docs(skraft): distill de us12-f15ade30"))!.split(" ")[0]!;
    expect(git(root, "show", "--name-only", "--format=", distill)).toContain(".skraft/us12-f15ade30/design/");
    const rejets = (await app.trace.list(id)).filter((e) => e.kind === "rejet") as { porte: string; motifs: string[] }[];
    expect(rejets).toContainEqual(expect.objectContaining({ porte: "commit", motifs: [expect.stringMatching(/DESIGN.*index\.lock.*sans commit/)] }));
    expect(app.posted.at(-1)).toContain("Phases non commitées : DESIGN");
  }, 90_000);
  // Défaut relevé le 13/10 (docs/skraft-fonctionnement) : la panne du commit de DISTILL levait le gel.
  it("commit de DISTILL en échec, continuer : DELIVER garde le gel des tests d'acceptance", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root);
    const app = await assemble(root, runtime, tasksDir, { commitEchoue: (m) => m === "docs(skraft): distill de us12-f15ade30", isolated: true });
    answerQuestions(app);
    const id = await lancer(app);
    const q = await escaladeDuCommit(app);
    await app.interactions.respond(q.id, "continue", undefined, { role: "architecte" });
    await finie(app, id);
    const testeur = runtime.history.find((h) => runtime.configs.get(h.id)!.role === ROLE("skraft-test"))!;
    expect(testeur.sent[0]).toContain("Les tests d'acceptance sont gelés : ne les modifie jamais.");
  }, 90_000);
});
