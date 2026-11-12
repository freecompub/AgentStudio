// @ts-nocheck — le registre et les leçons du workflow sont en JavaScript (ADR 0055).
/**
 * Leçons réinjectées (LEC-3, freecompub/AgentStudio#34) : une leçon validée du projet est donnée à
 * l'agent de son rôle au début de sa phase, et aux lentilles ; l'erreur revient malgré elle, sa
 * récidive est comptée et signalée au bilan.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contenuDuRegistre, erreurDeDefaut } from "../../../workflows/skraft/registre.mjs";
import { answerQuestions, assemble, createProject, git, put, shutdownHosts, simulatedAgents, until } from "./support/harness.js";

const DEFAUT = "contracts.md ne nomme pas l'agrégat.";
const CLEAN = "architecture-review-criteria/references/clean-arch-violations.md";
const fil = (story) => ({ id: "architecture#1.1", lens: "architecture", severity: "major", description: DEFAUT, file: `.skraft/${story}/design/contracts.md`, target: "deliverable", status: "fixed" });

describe("skraft en workflow — leçons réinjectées (LEC-3)", () => {
  let root: string;
  let tasksDir: string;
  beforeEach(async () => {
    root = await createProject();
    const a = erreurDeDefaut(fil("us-4"), "DESIGN", "us-4");
    const b = erreurDeDefaut(fil("us-7"), "DESIGN", "us-7");
    await put(root, ".agent-studio/lecons/brut/us-4.jsonl", contenuDuRegistre("", [a]));
    await put(root, ".agent-studio/lecons/brut/us-7.jsonl", contenuDuRegistre("", [b]));
    await put(root, ".agent-studio/lecons/stories.jsonl", `${JSON.stringify({ story: "us-4" })}\n${JSON.stringify({ story: "us-7" })}\n`);
    const lecon = { id: "L-07", groupe: a.signature, regle: "Un contrat nomme l'agrégat qu'il expose.", quand: "On écrit contracts.md.", aFaire: "Citer l'agrégat du modèle.", exemple: "us-7#1", sources: ["us-4#1", "us-7#1"], catalogue: { skill: CLEAN, section: "V-CA-06: Infrastructure Details Leaking into Application Contracts" }, role: "skraft-architect-decide", phase: "DESIGN", statut: "validee", recidivesMalgreLecon: 1 };
    await put(root, ".agent-studio/lecons/lecons.jsonl", `${JSON.stringify(lecon)}\n`);
    git(root, "add", "-A");
    git(root, "commit", "-qm", "leçons du projet");
    tasksDir = await mkdtemp(join(tmpdir(), "agent-studio-skraft-tasks-"));
  });
  afterEach(async () => {
    await shutdownHosts();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(tasksDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("la leçon va à l'agent de son rôle et aux lentilles de sa phase ; l'erreur revient, la récidive est comptée et signalée", async () => {
    const prompts: Record<string, string[]> = { model: [], decide: [], lentille: [] };
    let revues = 0;
    const architecture: ScriptedBehavior = async (t) => {
      revues++;
      if (revues === 1) prompts.lentille.push(t.prompt);
      await t.callTool("submit_lens_verdict", {
        lens: "architecture",
        verdict: revues === 1 ? "CHANGES_REQUESTED" : "APPROVED",
        defects: revues === 1 ? [{ severity: "major", severityReason: "raison d’essai", description: DEFAUT, file: ".skraft/us-12/design/contracts.md", target: "deliverable" }] : [],
      });
    };
    const model: ScriptedBehavior = async (t) => {
      prompts.model.push(t.prompt);
      await put(root, ".skraft/us-12/design/event-model.md", "`BolusCapped`\n");
      await t.callTool("report_phase", { summary: "modèle", files: [] });
    };
    const decide: ScriptedBehavior = async (t) => {
      prompts.decide.push(t.prompt);
      await put(root, ".skraft/us-12/design/contracts.md", "`BolusCapped`\n");
      await t.callTool("report_phase", { summary: "décisions", files: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-lens-architecture": architecture, "skraft-architect-model": model, "skraft-architect-decide": decide });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const difficulty = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(difficulty.id, difficulty.options.find((o) => o.id.endsWith(":medium"))!.id);
    await until(async () => (await app.engine.status(id))?.status === "finished", 90_000);

    expect(prompts.decide[0]).toContain("Erreurs déjà commises en DESIGN sur ce projet (à éviter) :");
    expect(prompts.decide[0]).toContain("[L-07] Un contrat nomme l'agrégat qu'il expose.");
    expect(prompts.decide[0]).toContain(`Déjà vu : us-7, ${DEFAUT}`);
    expect(prompts.model[0]).not.toContain("Erreurs déjà commises");
    expect(prompts.lentille[0]).toMatch(/Points de vigilance connus :\n {2}- \[L-07\][\s\S]*Cette liste ne remplace pas ton examen général/);
    const lecons = git(root, "show", "HEAD:.agent-studio/lecons/lecons.jsonl").trim().split("\n").map((l) => JSON.parse(l));
    expect(lecons[0]).toMatchObject({ id: "L-07", recidivesMalgreLecon: 2 });
    expect(app.posted.at(-1)).toContain("Leçons qui n'ont pas suffi (au moins 2 récidives) : L-07, candidate à devenir une porte de code.");
    // La valeur rendue par le script, rangée par référence (contenus volumineux, ADR 0052).
    const etat = (await app.engine.status(id))!.state;
    const valeur = etat.fin.valeur.ref ? JSON.parse(etat.contenus[etat.fin.valeur.ref]) : etat.fin.valeur.clair;
    expect(valeur.leconsInjectees).toEqual(expect.arrayContaining([{ phase: "DESIGN", role: "skraft-architect-decide", ids: ["L-07"] }, { phase: "DESIGN", role: "lentilles", ids: ["L-07"] }]));
  }, 150_000);
});
