/**
 * D16 (docs/12) : un nettoyage ne change pas le comportement. Celui qui fait passer le test
 * d'acceptance du scénario de vert à rouge est refusé : retour au vert, nettoyage annulé, sans
 * reprendre le scénario.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, put, shutdownHosts, simulatedAgents, unitTestWriter } from "./support/harness.js";
import { fin, lancerWorkflow } from "./support/fin.js";
import { CODE, developpeur, pileParMarques } from "./support/marques.js";

describe("skraft en workflow — nettoyage qui casse l'acceptance (D16)", () => {
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

  it("refusé : retour au vert, nettoyage annulé, le scénario n'est pas repris", async () => {
    const coder = developpeur(root);
    let nettoyages = 0;
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-test": unitTestWriter(root),
      "skraft-dev": async (t) => {
        // Premier nettoyage : il retire la marque de l'acceptance, les tests unitaires restent verts.
        if (t.prompt.includes("nettoie le code de production") && nettoyages++ === 0) {
          await put(root, CODE, (await readFile(join(root, CODE), "utf8")).replace("// ac-1\n", ""));
          return void (await t.callTool("report_phase", { summary: "nettoyé", files: [CODE] }));
        }
        await coder(t);
      },
    });
    const app = await assemble(root, runtime, tasksDir, { stack: pileParMarques(root) });
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "challenging");
    const bilan = await fin(app, id, 60_000);
    expect(bilan.livraison?.notes.some((n) => n.startsWith("Scénario ac-1 : nettoyage annulé") && n.includes("acceptance"))).toBe(true);
    const rejets = ((await app.trace.list(id)).filter((e) => e.kind === "rejet") as { porte: string }[]).map((r) => r.porte);
    expect(rejets).not.toContain("scénario ac-1");
    // D21 (docs/12) : le nettoyage refusé est tracé, sous le même nom de porte dans les deux.
    expect(rejets).toContain("pas refactor (ac-1)");
    expect(await readFile(join(root, CODE), "utf8")).toContain("// ac-1\n");
  }, 90_000);
});
