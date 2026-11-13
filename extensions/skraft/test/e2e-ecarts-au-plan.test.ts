/**
 * Écarts au plan de test (ADR 0067, PLAN_DEVIATION de skraft-plugin v1.15.1) : le testeur déclare
 * qu'un test s'écarte de la matrice ; le code le vérifie, le garde, le donne à la revue, le commite
 * dans `ecarts-au-plan.md` et le cite dans le rapport final.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, git, shutdownHosts, simulatedAgents, stateOf, unitTestWriter, until } from "./support/harness.js";

export const ECART = { criterion: "ac-1", planned: "Application, aucune", actual: "Domaine, aucune", rule: "clean-architecture-testing : l'invariant du plafond se teste dans le domaine" };

/** Testeur ordinaire, qui déclare un écart au plan sur son premier test. */
export function testeurQuiSEcarte(root: string): ScriptedBehavior {
  const ecrire = unitTestWriter(root);
  let premier = true;
  return (t) =>
    ecrire({
      ...t,
      callTool: (nom: string, args: Record<string, unknown>) => {
        const avec = premier && nom === "report_phase" ? { ...args, planDeviations: [ECART] } : args;
        premier = false;
        return t.callTool(nom, avec);
      },
    } as typeof t);
}

describe("skraft — écarts au plan de test (ADR 0067)", () => {
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

  it("écart déclaré : gardé, donné à la revue, commité avec la livraison, cité dans le rapport", async () => {
    const revue: string[] = [];
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-test": testeurQuiSEcarte(root),
      "skraft-lens-test-integrity": async (t) => {
        if (t.prompt.includes("phase DELIVER")) revue.push(t.prompt);
        await t.callTool("submit_lens_verdict", { lens: "test-integrity", verdict: "APPROVED", defects: [] });
      },
    });
    const app = await assemble(root, runtime, tasksDir, { isolated: true });
    answerQuestions(app);
    await app.registry.command("skraft")!.handler("--auto stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;
    await until(async () => ["DONE", "ESCALATED"].includes(stateOf(await app.engine.status(id))?.stage ?? ""), 90_000);
    expect(stateOf(await app.engine.status(id))!.stage).toBe("DONE");
    expect(revue.at(-1)).toContain("Écart au plan déclaré par skraft-test (scénario ac-1, critère ac-1) : prévu Application, aucune → Domaine, aucune — règle : clean-architecture-testing");
    const livraison = git(root, "log", "--format=%H %s").split("\n").find((l) => l.endsWith("feat(us12-f15ade30): livraison de la story"))!.split(" ")[0]!;
    expect(git(root, "show", `${livraison}:.skraft/us12-f15ade30/deliver/ecarts-au-plan.md`)).toContain("| ac-1 | ac-1 | skraft-test | Application, aucune | Domaine, aucune |");
    await until(async () => app.posted.some((p) => p.includes("Écarts au plan de test")), 30_000);
    expect(app.posted.find((p) => p.includes("Écarts au plan de test"))).toContain("Écarts au plan de test : 1 (détail dans .skraft/us12-f15ade30/deliver/ecarts-au-plan.md).");
  }, 150_000);
});
