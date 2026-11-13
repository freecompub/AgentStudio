/**
 * Critères de sortie de S6 (SPEC-skraft §14) :
 *  - mesures d'usage par état sur trois stories (agents simulés).
 * Le bout en bout 13.3 sur une vraie chaîne Swift a été retiré avec Swift (ADR 0061).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  answerQuestions,
  assemble,
  createProject,
  git,
  shutdownHosts,
  simulatedAgents,
  stateOf,
  unitTestWriter,
  until,
} from "./support/harness.js";

type App = Awaited<ReturnType<typeof assemble>>;

/** Répond au fil de l'eau : difficulté confirmée, questions ouvertes (PO), ratification (architecte). */
function humans(app: App): void {
  answerQuestions(app);
  const done = new Set<string>();
  const tick = async () => {
    for (const p of await app.interactions.pending()) {
      if (done.has(p.id)) continue;
      if (p.title.startsWith("Difficulté")) {
        done.add(p.id);
        await app.interactions.respond(p.id, p.options[0]!.id);
      } else if (p.title.startsWith("Ratifier")) {
        done.add(p.id);
        await app.interactions.respond(p.id, p.options.find((o) => o.id.startsWith("accept:"))!.id);
      }
    }
  };
  app.interactions.onChange(() => void tick());
  void tick();
}

describe("skraft — mesures d'usage sur trois stories (§12)", () => {
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

  it("US-7 (simple), US-12 (assez difficile), US-15 (difficile) : requêtes et tokens par état, réessais, granularité", async () => {
    const measures: Record<string, { level: string; granularity: string; phases: Record<string, number>; retries: Record<string, number> }> = {};
    for (const story of ["us-7", "us-12", "us-15"]) {
      git(root, "checkout", "-q", "main");
      const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-test": unitTestWriter(root) }, { usage: true });
      const app = await assemble(root, runtime, tasksDir);
      humans(app);
      await app.registry.command("skraft")!.handler(`stories/${story}.md`);
      await until(async () => (await app.engine.list()).some((t) => stateOf(t)?.storyPath === `stories/${story}.md`));
      const id = (await app.engine.list()).find((t) => stateOf(t)?.storyPath === `stories/${story}.md`)!.id;
      await until(async () => ["DONE", "ESCALATED", "ABORTED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 60_000);
      const s = stateOf(await app.engine.status(id))!;
      expect(`${s.stage} ${JSON.stringify(s.escalation)} ${JSON.stringify(s.lastRejection)}`, story).toBe("DONE null null");
      const usage = await app.usage.report(id);
      measures[story] = {
        level: s.difficulty!.level,
        granularity: s.deliver!.granularity,
        phases: Object.fromEntries(usage.filter((r) => r.requests > 0).map((r) => [r.phase, r.requests])),
        retries: s.retries ?? {},
      };
      for (const r of usage.filter((x) => x.requests > 0)) expect(r.inputTokens, `${story} ${r.phase}`).toBeGreaterThan(0);
      await shutdownHosts();
      // Chaque story repart de main : on retire le code livré par la précédente.
      git(root, "checkout", "-q", "main");
      git(root, "clean", "-qfd");
    }
    expect(measures["us-7"]).toMatchObject({ level: "simple", granularity: "turn-per-scenario" });
    expect(measures["us-7"]!.phases.RESEARCH).toBeUndefined();
    expect(measures["us-12"]).toMatchObject({ level: "medium-hard", granularity: "turn-per-scenario" });
    expect(measures["us-15"]).toMatchObject({ level: "challenging", granularity: "session-per-step" });
    // Sessions séparées : plus de requêtes en DELIVER que le tour unique, pour un scénario moteur chacun.
    expect(measures["us-15"]!.phases.DELIVER!).toBeGreaterThan(measures["us-12"]!.phases.DELIVER!);
    expect(Object.keys(measures["us-12"]!.phases)).toEqual(expect.arrayContaining(["CLASSIFY", "RESEARCH", "DESIGN", "DISTILL", "DELIVER", "REVIEW"]));
  }, 180_000);
});

