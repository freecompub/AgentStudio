/**
 * D4 (docs/12) : une lentille qui pose une question ou qui reste muette ne fait plus payer le
 * producteur. La question part à l'humain ; la phase est rejouée avec la question et la réponse,
 * sans consommer d'essai (DELIVER : seule la revue est relancée) ; au-delà de deux questions de
 * revue dans une phase, escalade. Une lentille muette est relancée seule, une fois.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, ROLE, shutdownHosts, simulatedAgents, stateOf, until } from "./support/harness.js";

type App = Awaited<ReturnType<typeof assemble>>;

/** Lance skraft, confirme la difficulté proposée, répond aux questions ouvertes et aux questions de revue. */
async function lancer(app: App): Promise<string> {
  answerQuestions(app);
  const faites = new Set<string>();
  const tick = async () => {
    for (const p of await app.interactions.pending()) {
      if (faites.has(p.id) || !(p.title.startsWith("Difficulté") || p.title.startsWith("Question de la revue"))) continue;
      faites.add(p.id);
      await app.interactions.respond(p.id, p.options[0]!.id, undefined, { role: "po" });
    }
  };
  app.interactions.onChange(() => void tick());
  await app.registry.command("skraft")!.handler("stories/us-12.md");
  void tick();
  await until(async () => (await app.engine.list()).length > 0);
  return (await app.engine.list())[0]!.id;
}

const stade = async (app: App, id: string) => stateOf(await app.engine.status(id))?.stage ?? "";
const finie = async (app: App, id: string) => {
  await until(async () => ["DONE", "ESCALATED", "ABORTED"].includes(await stade(app, id)), 60_000);
  return stateOf(await app.engine.status(id))!;
};

/** Lentille qui pose ses questions dans la phase donnée (une par appel, dans l'ordre), puis approuve. */
const lentilleQuiDemande = (lens: string, phase: string, questions: string[]): ScriptedBehavior => {
  let n = 0;
  return async (t) => {
    if (t.prompt.includes(`phase ${phase}`) && n < questions.length) {
      await t.callTool("report_blocker", { question: questions[n++]!, choices: ["par ligne", "par commande"] });
      return;
    }
    await t.callTool("submit_lens_verdict", { lens, verdict: "APPROVED", defects: [] });
  };
};

describe("skraft — question ou silence d'une lentille (D4)", () => {
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

  const roles = (r: ScriptedRuntime) => r.history.map((h) => r.configs.get(h.id)!.role.split("/")[1]!);
  const portes = async (app: App, id: string) => ((await app.trace.list(id)).filter((e) => e.kind === "rejet") as { porte: string }[]).map((r) => r.porte);

  it("DESIGN : la question part à l'humain, la phase est rejouée avec la réponse, sans essai consommé", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-lens-architecture": lentilleQuiDemande("architecture", "DESIGN", ["Le palier s'applique-t-il par ligne ou par commande ?"]),
    });
    const app = await assemble(root, runtime, tasksDir, { isolated: true });
    const id = await lancer(app);
    expect((await finie(app, id)).stage).toBe("DONE");
    const model = runtime.history.filter((h) => runtime.configs.get(h.id)!.role === ROLE("skraft-architect-model")).map((h) => h.sent.join("\n"));
    expect(model).toHaveLength(2);
    expect(model[1]).toContain("Question de la revue (architecture) : Le palier s'applique-t-il par ligne ou par commande ? — Réponse de l'utilisateur : par ligne");
    expect(model[1]).not.toContain("interrompu");
    expect(await portes(app, id)).toEqual(["question de revue"]);
  }, 90_000);

  it("une troisième question de revue dans la phase : escalade", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-lens-architecture": lentilleQuiDemande("architecture", "DESIGN", ["Q1 ?", "Q2 ?", "Q3 ?"]),
    });
    const app = await assemble(root, runtime, tasksDir, { isolated: true });
    const id = await lancer(app);
    const s = await finie(app, id);
    expect(s.stage).toBe("ESCALATED");
    expect(s.escalation?.reason).toMatch(/Plus de 2 questions de revue dans la phase DESIGN.*Q3 \?/);
    expect(roles(runtime).filter((r) => r === "skraft-architect-model")).toHaveLength(3);
  }, 90_000);

  it("lentille muette : relancée seule, une fois, le producteur ne refait rien", async () => {
    let silences = 0;
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-lens-cold-reader": async (t) => {
        // Muette deux tours de suite : le moteur d'agents la relance une fois de lui-même, puis abandonne l'appel.
        if ((t.prompt.includes("phase DESIGN") || t.prompt.includes("submit_lens_verdict")) && silences++ < 2) return;
        await t.callTool("submit_lens_verdict", { lens: "cold-reader", verdict: "APPROVED", defects: [] });
      },
    });
    const app = await assemble(root, runtime, tasksDir, { isolated: true });
    const id = await lancer(app);
    expect((await finie(app, id)).stage).toBe("DONE");
    expect(roles(runtime).filter((r) => r === "skraft-architect-model")).toHaveLength(1);
    expect(await portes(app, id)).toEqual([]);
  }, 90_000);

  it("DELIVER : la réponse relance la revue seule, personne ne rejoue la livraison", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-lens-architecture": lentilleQuiDemande("architecture", "DELIVER", ["Le palier s'applique-t-il par ligne ou par commande ?"]),
    });
    const app = await assemble(root, runtime, tasksDir, { isolated: true });
    const id = await lancer(app);
    expect((await finie(app, id)).stage).toBe("DONE");
    const suite = roles(runtime);
    // Après la question de la revue de DELIVER : seules les lentilles repassent, ni testeur ni développeur.
    const apres = suite.slice(suite.indexOf("skraft-lens-architecture", suite.lastIndexOf("skraft-dev")) + 1);
    expect(apres.length).toBeGreaterThan(0);
    expect(apres.every((r) => r.startsWith("skraft-lens-"))).toBe(true);
    expect(await portes(app, id)).toEqual(["question de revue"]);
  }, 90_000);
});
