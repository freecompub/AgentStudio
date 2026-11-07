import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTaskAgentRunner, type TaskAgentSpec } from "../src/agents/task-agent-runner.js";
import { createJsonTaskSessionStore } from "../src/agents/json-task-session-store.js";
import { ScriptedRuntime } from "../src/testing/scripted-runtime.js";

/**
 * Sessions orphelines (ADR 0053, `docs/09` §14 étape 2).
 *
 * Le lien rôle → session ne vivait que dans une `Map` en mémoire : après un crash, personne ne
 * connaissait plus les identifiants, et les sessions restaient sur le disque côté runtime. Chaque
 * session ouverte est désormais inscrite dans un registre persisté, et supprimée au redémarrage
 * comme à la fermeture normale.
 */

const AGENT: TaskAgentSpec = { role: "skraft-researcher", systemPrompt: "Tu enquêtes.", writable: [], output: "report_phase" };
const CLE = { resumeKey: "t1/skraft/skraft-researcher" };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sessions-"));
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

function demarrer() {
  const runtime = new ScriptedRuntime();
  const sessions = createJsonTaskSessionStore(dir);
  const runner = createTaskAgentRunner({ runtime, root: "/projets/demo", idleMs: 60_000, sessions });
  return { runtime, runner, sessions };
}

const finir: Parameters<ScriptedRuntime["behave"]>[1] = async (t) => {
  await t.callTool("report_phase", { summary: "fini", files: [] });
};

describe("Sessions orphelines (ADR 0053)", () => {
  it("sessions supprimées au redémarrage : la session qu'une tâche en cours gardait", async () => {
    const avant = demarrer();
    avant.runtime.behave("skraft-researcher", finir);
    await avant.runner.run(AGENT, "x", CLE);
    const gardee = avant.runtime.last.id;
    expect(avant.runtime.deleted).toEqual([]);

    // Crash : le processus disparaît sans rien libérer. Au démarrage suivant, un nouvel exécuteur
    // ne connaît que le registre.
    const apres = demarrer();
    await apres.runner.releaseAll();

    expect(apres.runtime.deleted).toEqual([gardee]);
    expect(await apres.sessions.list()).toEqual([]);
  });

  it("sessions supprimées au redémarrage : la session d'un tour que le crash a coupé", async () => {
    const avant = demarrer();
    avant.runtime.behave("skraft-researcher", (t) => t.hang());
    void avant.runner.run(AGENT, "x", CLE).catch(() => undefined);
    await vi.waitFor(async () => expect(await avant.sessions.list()).toHaveLength(1));
    const enCours = avant.runtime.last.id;

    const apres = demarrer();
    await apres.runner.releaseAll();

    expect(apres.runtime.deleted).toEqual([enCours]);
  });

  it("sessions supprimées au redémarrage : toutes les tâches, tous les rôles", async () => {
    const avant = demarrer();
    avant.runtime.behave("skraft-researcher", finir);
    await avant.runner.run(AGENT, "x", { resumeKey: "t1/skraft/skraft-researcher" });
    await avant.runner.run(AGENT, "x", { resumeKey: "t2/skraft/skraft-researcher" });
    const ids = avant.runtime.history.map((s) => s.id);

    const apres = demarrer();
    await apres.runner.releaseAll();

    expect([...apres.runtime.deleted].sort()).toEqual([...ids].sort());
  });

  it("fermeture normale : releaseAll supprime aussi les sessions gardées, puis le tour suivant repart neuf", async () => {
    const { runtime, runner, sessions } = demarrer();
    runtime.behave("skraft-researcher", finir);
    await runner.run(AGENT, "x", CLE);
    const gardee = runtime.last.id;

    await runner.releaseAll();
    expect(runtime.deleted).toEqual([gardee]);
    expect(await sessions.list()).toEqual([]);

    // La Map en mémoire est vidée aussi : on ne reprend pas une session supprimée.
    await runner.run(AGENT, "x", CLE);
    expect(runtime.last.id).not.toBe(gardee);
  });

  it("une session supprimée en fin de tour quitte le registre", async () => {
    const { runtime, runner, sessions } = demarrer();
    runtime.behave("skraft-researcher", finir);
    await runner.run(AGENT, "x");
    expect(runtime.deleted).toEqual([runtime.last.id]);
    expect(await sessions.list()).toEqual([]);
  });

  it("releaseTask et releaseRoles retirent leurs sessions du registre", async () => {
    const { runtime, runner, sessions } = demarrer();
    runtime.behave("skraft-researcher", finir);
    await runner.run(AGENT, "x", { resumeKey: "t1/skraft/skraft-researcher" });
    await runner.run(AGENT, "x", { resumeKey: "t1/skraft/skraft-architect-model" });
    await runner.run(AGENT, "x", { resumeKey: "t2/skraft/skraft-researcher" });

    await runner.releaseRoles("t1", ["skraft/skraft-architect-model"]);
    expect((await sessions.list()).map((s) => s.key).sort()).toEqual(["t1/skraft/skraft-researcher", "t2/skraft/skraft-researcher"]);

    await runner.releaseTask("t1");
    expect((await sessions.list()).map((s) => s.key)).toEqual(["t2/skraft/skraft-researcher"]);
  });

  it("suppression refusée par le runtime : l'identifiant reste inscrit pour le démarrage suivant", async () => {
    const avant = demarrer();
    avant.runtime.behave("skraft-researcher", finir);
    await avant.runner.run(AGENT, "x", CLE);
    const gardee = avant.runtime.last.id;

    const panne = demarrer();
    vi.spyOn(panne.runtime, "deleteSession").mockRejectedValueOnce(new Error("runtime indisponible"));
    await expect(panne.runner.releaseAll()).resolves.toBeUndefined();
    expect((await panne.sessions.list()).map((s) => s.sessionId)).toEqual([gardee]);

    const ensuite = demarrer();
    await ensuite.runner.releaseAll();
    expect(ensuite.runtime.deleted).toEqual([gardee]);
  });

  it("registre vide : releaseAll n'appelle pas le runtime", async () => {
    const { runtime, runner } = demarrer();
    const del = vi.spyOn(runtime, "deleteSession");
    await runner.releaseAll();
    expect(del).not.toHaveBeenCalled();
  });
});

describe("Registre JSON des sessions de tâche", () => {
  it("survit à une nouvelle instance, et des inscriptions simultanées ne se perdent pas", async () => {
    const a = createJsonTaskSessionStore(dir);
    await Promise.all(Array.from({ length: 8 }, (_, i) => a.add({ key: `t1/r${i}`, sessionId: `s${i}` })));
    const b = createJsonTaskSessionStore(dir);
    expect((await b.list()).map((s) => s.sessionId).sort()).toEqual(["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]);

    await b.remove("s3");
    expect((await a.list()).map((s) => s.sessionId)).not.toContain("s3");
  });

  it("une session réinscrite n'apparaît qu'une fois", async () => {
    const s = createJsonTaskSessionStore(dir);
    await s.add({ key: "t1/r", sessionId: "s1" });
    await s.add({ key: "t1/r", sessionId: "s1" });
    expect(await s.list()).toEqual([{ key: "t1/r", sessionId: "s1" }]);
  });

  it("fichier illisible : liste vide, et l'inscription suivante le remplace", async () => {
    await writeFile(join(dir, "sessions.json"), "{ pas du json");
    const s = createJsonTaskSessionStore(dir);
    expect(await s.list()).toEqual([]);
    await s.add({ key: "t1/r", sessionId: "s1" });
    expect(JSON.parse(await readFile(join(dir, "sessions.json"), "utf8"))).toEqual([{ key: "t1/r", sessionId: "s1" }]);
  });
});
