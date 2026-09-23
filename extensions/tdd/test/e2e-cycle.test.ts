/**
 * Critères de sortie de J2 (§14), sans LLM : vrai dépôt Git, vrai Vitest, agents scriptés.
 *  1. `/tdd` déroule un cycle complet sur un projet TypeScript ;
 *  2. une modification de test par l'agent dev est détectée et annulée ;
 *  3. un redémarrage en plein GREEN reprend proprement.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TddState } from "../src/index.js";
import { assemble, CAP_SRC, CAP_TEST, createProject, devAgent, git, phaseOf, planner, ROLE, testAgent, until, HOST_MODES, shutdownHosts } from "./support/harness.js";

describe.each(HOST_MODES)("Extension tdd — critères de sortie de J2 (extension %s)", (mode) => {
  let root: string;
  let tasksDir: string;

  beforeEach(async () => {
    root = await createProject();
    tasksDir = await mkdtemp(join(tmpdir(), "agent-studio-tasks-"));
  });
  afterEach(async () => {
    await shutdownHosts();
    await rm(root, { recursive: true, force: true });
    await rm(tasksDir, { recursive: true, force: true });
  });

  async function startTdd(app: Awaited<ReturnType<typeof assemble>>, args = "--strict Plafonner la dose proposée") {
    await app.registry.command("tdd")!.handler(args);
    const [task] = await app.engine.list();
    await until(async () => (await app.interactions.pending()).length === 1);
    const [review] = await app.interactions.pending();
    expect(review?.title).toContain("Valider le plan TDD");
    await app.interactions.respond(review!.id, "approve");
    return task!.id;
  }

  it("1. /tdd déroule un cycle complet : plan validé, rouge, vert, nettoyage, commits", async () => {
    const runtime = new ScriptedRuntime()
      .behave(ROLE("tdd-planner"), planner([{ id: "s1", behavior: "plafonne une dose au-dessus du plafond" }]))
      .behave(ROLE("tdd-test"), testAgent(root))
      .behave(ROLE("tdd-dev"), devAgent(root));
    const app = await assemble(root, runtime, tasksDir, mode);

    const id = await startTdd(app);
    await app.engine.idle(id);

    const rec = await app.engine.status(id);
    expect(phaseOf(rec)).toBe("DONE");
    expect(rec?.status).toBe("finished");
    expect((rec?.state as TddState).steps[0]?.status).toBe("done");
    expect(git(root, "log", "--format=%s")).toBe(
      ["feat: plafonne une dose au-dessus du plafond", "test: plafonne une dose au-dessus du plafond", "init"].join("\n"),
    );
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(app.posted[0]).toContain("Cycle TDD lancé");
    // Sessions éphémères : une par rôle et par phase, toutes supprimées (D17).
    expect(runtime.deleted.length).toBe(runtime.history.length);
    expect(runtime.history.length).toBe(4); // planificateur, test, dev vert, dev nettoyage
  }, 90_000);

  it("2. une modification de test par l'agent dev est détectée, annulée, et l'agent est relancé avec le motif", async () => {
    const dev = devAgent(root, { tamperFirst: true });
    const runtime = new ScriptedRuntime()
      .behave(ROLE("tdd-planner"), planner([{ id: "s1", behavior: "plafonne la dose" }]))
      .behave(ROLE("tdd-test"), testAgent(root))
      .behave(ROLE("tdd-dev"), dev);
    const app = await assemble(root, runtime, tasksDir, mode);

    const id = await startTdd(app);
    await app.engine.idle(id);

    expect(phaseOf(await app.engine.status(id))).toBe("DONE");
    // Le test gelé a été restauré à sa version rouge.
    expect(await readFile(join(root, "tests/cap.test.ts"), "utf8")).toBe(CAP_TEST);
    expect(await readFile(join(root, "src/cap.ts"), "utf8")).toBe(CAP_SRC);
    // Relance ciblée : le deuxième tour vert reçoit le motif précis du rejet.
    const greenPrompts = dev.prompts.filter((p) => p.includes("phase verte"));
    expect(greenPrompts).toHaveLength(2);
    expect(greenPrompts[1]).toContain("Rejet précédent : Les fichiers de test ont été modifiés");
    expect(git(root, "log", "--format=%s", "-1")).toBe("feat: plafonne la dose");
  }, 90_000);

  it("3. un redémarrage en plein GREEN reprend proprement depuis le checkpoint", async () => {
    // Premier lancement : l'agent dev écrit un brouillon puis ne rend jamais la main (plantage).
    const first = new ScriptedRuntime()
      .behave(ROLE("tdd-planner"), planner([{ id: "s1", behavior: "plafonne la dose" }]))
      .behave(ROLE("tdd-test"), testAgent(root))
      .behave(ROLE("tdd-dev"), devAgent(root, { hang: true }));
    const app1 = await assemble(root, first, tasksDir, mode);
    const id = await startTdd(app1);
    await until(async () => existsSync(join(root, "src/brouillon.ts")));
    const crashed = await app1.engine.status(id);
    expect(phaseOf(crashed)).toBe("GREEN");
    expect(crashed?.inflight?.effect).toMatchObject({ kind: "runDevAgent", mode: "green" });

    // Redémarrage : nouveaux services sur le même dépôt et le même stockage des tâches.
    const second = new ScriptedRuntime().behave(ROLE("tdd-dev"), devAgent(root));
    const app2 = await assemble(root, second, tasksDir, mode);
    await app2.engine.resumeAll();
    await app2.engine.idle(id);

    const rec = await app2.engine.status(id);
    expect(phaseOf(rec)).toBe("DONE");
    // Le travail partiel n'a pas été « récupéré » : rollback au checkpoint avant l'effet.
    expect(existsSync(join(root, "src/brouillon.ts"))).toBe(false);
    expect(git(root, "log", "--format=%s", "-1")).toBe("feat: plafonne la dose");
  }, 90_000);
});
