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
import { answerQuestions, assemble, createProject, ROLE, shutdownHosts, simulatedAgents, until } from "./support/harness.js";
import { fin, lancerWorkflow } from "./support/fin.js";

type App = Awaited<ReturnType<typeof assemble>>;

/** Répond « par ligne » (premier choix) à chaque question de revue. */
function repondreAuxQuestionsDeRevue(app: App): void {
  const faites = new Set<string>();
  const tick = async () => {
    for (const p of await app.interactions.pending()) {
      if (!p.title.startsWith("Question de la revue") || faites.has(p.id)) continue;
      faites.add(p.id);
      await app.interactions.respond(p.id, p.options[0]!.id);
    }
  };
  app.interactions.onChange(() => void tick());
  void tick();
}

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

describe("skraft en workflow — question ou silence d'une lentille (D4)", () => {
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

  it("DESIGN : la question part à l'humain, la phase est rejouée avec la réponse, sans essai consommé", async () => {
    const modelPrompts: string[] = [];
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-lens-architecture": lentilleQuiDemande("architecture", "DESIGN", ["Le palier s'applique-t-il par ligne ou par commande ?"]),
    });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    repondreAuxQuestionsDeRevue(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await fin(app, id, 60_000);
    for (const h of runtime.history) if (runtime.configs.get(h.id)!.role === ROLE("skraft-architect-model")) modelPrompts.push(h.sent.join("\n"));
    expect(modelPrompts).toHaveLength(2);
    expect(modelPrompts[1]).toContain("Question de la revue (architecture) : Le palier s'applique-t-il par ligne ou par commande ? — Réponse de l'utilisateur : par ligne");
    expect(modelPrompts[1]).not.toContain("interrompu");
    const rejets = (await app.trace.list(id)).filter((e) => e.kind === "rejet") as { porte: string }[];
    expect(rejets.map((r) => r.porte)).toEqual(["question de revue"]);
  }, 90_000);

  it("une troisième question de revue dans la phase : escalade", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-lens-architecture": lentilleQuiDemande("architecture", "DESIGN", ["Q1 ?", "Q2 ?", "Q3 ?"]),
    });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    repondreAuxQuestionsDeRevue(app);
    await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Phase DESIGN : Plus de 2 questions de revue")), 60_000);
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
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await fin(app, id, 60_000);
    expect(roles(runtime).filter((r) => r === "skraft-architect-model")).toHaveLength(1);
    const rejets = (await app.trace.list(id)).filter((e) => e.kind === "rejet");
    expect(rejets).toEqual([]);
  }, 90_000);

  it("DELIVER : la réponse relance la revue seule, personne ne rejoue la livraison", async () => {
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-lens-architecture": lentilleQuiDemande("architecture", "DELIVER", ["Le palier s'applique-t-il par ligne ou par commande ?"]),
    });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    repondreAuxQuestionsDeRevue(app);
    const id = await lancerWorkflow(app, "stories/us-12.md", "medium-hard");
    await fin(app, id, 60_000);
    const suite = roles(runtime);
    // Après la question de la revue de DELIVER : seules les lentilles repassent, ni testeur ni développeur.
    const apres = suite.slice(suite.indexOf("skraft-lens-architecture", suite.lastIndexOf("skraft-dev")) + 1);
    expect(apres.length).toBeGreaterThan(0);
    expect(apres.every((r) => r.startsWith("skraft-lens-"))).toBe(true);
    expect(suite.filter((r) => r === "skraft-lens-architecture").length).toBeGreaterThanOrEqual(2);
    const rejets = (await app.trace.list(id)).filter((e) => e.kind === "rejet") as { porte: string }[];
    expect(rejets.map((r) => r.porte)).toEqual(["question de revue"]);
  }, 90_000);
});
