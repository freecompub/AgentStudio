/**
 * Reprise d'une story (ADR 0089) : un run arrêté en DELIVER, puis relancé sur la même story. L'utilisateur
 * choisit de continuer la session (les phases approuvées ne sont pas refaites) ou d'en ouvrir une
 * nouvelle, qui écrase la précédente.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, git, shutdownHosts, simulatedAgents, unitTestWriter, until } from "./support/harness.js";
import { fin } from "./support/fin.js";

const SLUG = "us12-f15ade30";

describe("skraft en workflow — reprise d'une story arrêtée (ADR 0089)", () => {
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

  /** Un premier run qui va jusqu'à DELIVER, où le testeur pose une question restée sans réponse ; puis arrêté. */
  async function premierRunArrete() {
    let bloque = true;
    const testeur = unitTestWriter(root);
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-test": async (t) => {
        if (bloque) return void (await t.callTool("report_blocker", { question: "Quelle unité pour le plafond ?", choices: ["U", "mL"] }));
        return testeur(t);
      },
    });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("--auto stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Question de l'agent")), 60_000);
    const [premier] = await app.engine.list();
    await app.engine.cancel(premier!.id);
    await until(async () => (await app.engine.status(premier!.id))?.status === "finished");
    bloque = false;
    return { app, runtime };
  }

  async function relancer(app: Awaited<ReturnType<typeof assemble>>, choix: "continuer" | "nouvelle") {
    const avant = new Set((await app.engine.list()).map((t) => t.id));
    await app.registry.command("skraft-workflow")!.handler("--auto stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title === "US-12 a déjà une session : la continuer ?"), 60_000);
    const q = (await app.interactions.pending()).find((p) => p.title === "US-12 a déjà une session : la continuer ?")!;
    expect(q.detail).toContain("Phases approuvées : RESEARCH, DESIGN, DISTILL.");
    await app.interactions.respond(q.id, q.options.find((o) => o.id.endsWith(`:${choix}`))!.id);
    return (await app.engine.list()).find((t) => !avant.has(t.id))!.id;
  }

  it("continuer : les phases approuvées ne sont pas refaites, DELIVER reprend depuis le commit de DISTILL, la story est livrée", async () => {
    const { app, runtime } = await premierRunArrete();
    const tours = runtime.history.length;
    const id = await relancer(app, "continuer");
    const bilan = await fin(app, id, 90_000);
    const roles = runtime.history.slice(tours).map((x) => runtime.configs.get(x.id)?.role ?? "");
    for (const r of ["skraft-researcher", "skraft-architect-model", "skraft-architect-decide", "skraft-acceptance", "skraft-classifier"]) expect(roles.some((x) => x.endsWith(`/${r}`)), r).toBe(false);
    expect(roles.some((x) => x.endsWith("/skraft-test"))).toBe(true);
    expect(bilan.phases).toEqual(["RESEARCH", "DESIGN", "DISTILL", "DELIVER"]);
    const sujets = git(root, "log", "--format=%s").split("\n");
    expect(sujets.filter((s) => s === `docs(skraft): distill de ${SLUG}`)).toHaveLength(1);
    expect(sujets).toContain(`feat(${SLUG}): livraison de la story`);
  }, 180_000);

  it("nouvelle session : la branche est recréée depuis le départ, tout est refait", async () => {
    const { app, runtime } = await premierRunArrete();
    const tours = runtime.history.length;
    const id = await relancer(app, "nouvelle");
    await fin(app, id, 90_000);
    const roles = runtime.history.slice(tours).map((x) => runtime.configs.get(x.id)?.role ?? "");
    expect(roles.some((x) => x.endsWith("/skraft-researcher"))).toBe(true);
    // Une seule session sur la branche : celle-ci.
    expect(git(root, "log", "--format=%s").split("\n").filter((s) => s === `docs(skraft): research de ${SLUG}`)).toHaveLength(1);
  }, 180_000);
});
