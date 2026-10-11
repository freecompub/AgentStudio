// Repris de extensions/skraft-workflow/test/e2e-reprise-workflow.test.ts (2026-10-10) : teste le workflow en dossier (ADR 0055).
/**
 * Reprise après un crash au milieu de DELIVER (ADR 0052, D23) : la pile entière redémarre sur le
 * même dépôt et le même dossier de tâches ; le script est rejoué contre son journal. Rien de ce
 * qui était fait n'est refait : seul le tour coupé est relancé, depuis son checkpoint.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, put, ROLE, shutdownHosts, simulatedAgents, until } from "./support/harness.js";
import { fin, lancerWorkflow } from "./support/fin.js";

describe("skraft en workflow — reprise après un crash", () => {
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

  it("crash pendant le tour du développeur : au redémarrage, seul ce tour est rejoué, et la story est livrée", async () => {
    // Premier démarrage : le développeur écrit un fichier à moitié, puis le processus « meurt ».
    const avant = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-dev": async (t) => {
        await put(root, "src/domain/bolus-cap.ts", "export class BolusCap { // à moitié écrit\n");
        t.hang();
      },
    });
    const app1 = await assemble(root, avant, tasksDir);
    answerQuestions(app1);
    const id = await lancerWorkflow(app1, "stories/us-12.md");
    await until(async () => avant.history.some((h) => avant.configs.get(h.id)?.role === ROLE("skraft-dev")), 60_000);
    const roles = (r: ScriptedRuntime) => r.history.map((h) => r.configs.get(h.id)!.role.split("/")[1]!);
    expect(roles(avant)).toContain("skraft-researcher");
    await shutdownHosts();

    // Second démarrage : nouvelle pile, même dépôt, même dossier de tâches.
    const apres = simulatedAgents(new ScriptedRuntime(), root);
    const app2 = await assemble(root, apres, tasksDir);
    answerQuestions(app2);
    await app2.engine.resumeAll();
    const s = await fin(app2, id, 60_000);

    // Seul le tour coupé (développeur) et la suite sont exécutés : ni classifieur, ni recherche, ni
    // architectes, ni acceptance, ni le test unitaire déjà rouge.
    expect(roles(apres).filter((r) => !r.startsWith("skraft-lens-"))).toEqual(["skraft-dev"]);
    expect(s.phases).toEqual(["RESEARCH", "DESIGN", "DISTILL", "DELIVER"]);
    // Le fichier à moitié écrit a été effacé par le retour au checkpoint du tour, puis réécrit.
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(join(root, "src/domain/bolus-cap.ts"), "utf8")).toBe("export class BolusCap {}\n");
  }, 120_000);
});
