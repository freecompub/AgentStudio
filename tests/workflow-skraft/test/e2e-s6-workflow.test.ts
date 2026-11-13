// Repris de extensions/skraft-workflow/test/e2e-s6-workflow.test.ts (2026-10-10) : teste le workflow en dossier (ADR 0055).
/**
 * Jumeau de `extensions/skraft/test/e2e-s6.test.ts` pour `/skraft-workflow`. Ce que le réducteur
 * seul compte (réessais par phase, `rejections`, états CLASSIFY et REVIEW de l'usage) n'existe pas
 * dans le workflow : ces vérifications sont retirées. L'usage se lit par étape, avec les noms de l'extension.
 *
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
  unitTestWriter,
  until,
} from "./support/harness.js";
import { fin } from "./support/fin.js";

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
        await app.interactions.respond(p.id, p.options.find((o) => o.id.endsWith(":accept"))!.id);
      }
    }
  };
  app.interactions.onChange(() => void tick());
  void tick();
}

describe("skraft en workflow — mesures d'usage sur trois stories (§12)", () => {
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
    const measures: Record<string, { level: string; granularity: string; phases: Record<string, number> }> = {};
    for (const story of ["us-7", "us-12", "us-15"]) {
      git(root, "checkout", "-q", "main");
      const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-test": unitTestWriter(root) }, { usage: true });
      const app = await assemble(root, runtime, tasksDir);
      humans(app);
      await app.registry.command("skraft-workflow")!.handler(`stories/${story}.md`);
      const ici = async () => (await app.engine.list()).find((t) => (t.state as { entree?: { story?: string } }).entree?.story === `stories/${story}.md`);
      await until(async () => !!(await ici()));
      const id = (await ici())!.id;
      const s = await fin(app, id, 60_000);
      const usage = await app.usage.report(id);
      measures[story] = {
        level: s.niveau,
        granularity: s.livraison!.granularity,
        phases: Object.fromEntries(usage.filter((r) => r.requests > 0).map((r) => [r.phase, r.requests])),
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

