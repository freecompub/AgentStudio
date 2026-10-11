/**
 * D19 (docs/12) : un commit de phase en échec ne rembobine pas une phase approuvée. L'humain
 * relance le commit seul, continue sans commiter (tracé, fichiers inclus dans le commit suivant),
 * ou abandonne.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, git, ROLE, shutdownHosts, simulatedAgents, until } from "./support/harness.js";
import { fin, lancerWorkflow } from "./support/fin.js";

const DESIGN = "docs(skraft): design de us-12";
type App = Awaited<ReturnType<typeof assemble>>;

async function escaladeDuCommit(app: App) {
  await until(async () => (await app.interactions.pending()).some((p) => p.title.includes("commit impossible")), 60_000);
  return (await app.interactions.pending()).find((p) => p.title.includes("commit impossible"))!;
}

describe("skraft en workflow — commit de phase en échec (D19)", () => {
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
    const app = await assemble(root, runtime, tasksDir, { commitEchoue: (m) => m === DESIGN && echecs++ === 0 });
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium");
    const q = await escaladeDuCommit(app);
    expect(q.title).toContain("index.lock");
    expect(q.options.map((o) => o.label)).toEqual(["Relancer le commit", "Continuer sans commiter", "Abandonner la tâche"]);
    await app.interactions.respond(q.id, q.options.find((o) => o.id.endsWith("relancer"))!.id, undefined, { role: "architecte" });
    await fin(app, id, 60_000);
    expect(runtime.history.filter((h) => runtime.configs.get(h.id)!.role === ROLE("skraft-architect-model"))).toHaveLength(1);
    expect(git(root, "log", "--format=%s")).toContain(DESIGN);
  }, 90_000);

  it("continuer sans commiter : fichiers gardés et commités avec la phase suivante ; le choix est tracé et rapporté", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root);
    const app = await assemble(root, runtime, tasksDir, { commitEchoue: (m) => m === DESIGN });
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium");
    const q = await escaladeDuCommit(app);
    await app.interactions.respond(q.id, q.options.find((o) => o.id.endsWith("continuer"))!.id, undefined, { role: "architecte" });
    await fin(app, id, 60_000);
    expect(runtime.history.filter((h) => runtime.configs.get(h.id)!.role === ROLE("skraft-architect-model"))).toHaveLength(1);
    expect(git(root, "log", "--format=%s")).not.toContain(DESIGN);
    const distill = git(root, "log", "--format=%H %s").split("\n").find((l) => l.endsWith("docs(skraft): distill de us-12"))!.split(" ")[0]!;
    expect(git(root, "show", "--name-only", "--format=", distill)).toContain(".skraft/us-12/design/");
    const rejets = (await app.trace.list(id)).filter((e) => e.kind === "rejet") as { porte: string; motifs: string[] }[];
    expect(rejets).toContainEqual(expect.objectContaining({ porte: "commit", motifs: [expect.stringMatching(/DESIGN.*index\.lock.*sans commit/)] }));
    expect(app.posted.at(-1)).toContain("Phases non commitées : DESIGN");
  }, 90_000);
});
