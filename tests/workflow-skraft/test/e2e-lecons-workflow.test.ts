// @ts-nocheck — le registre et les leçons du workflow sont en JavaScript (ADR 0055).
/**
 * Leçons tirées des erreurs répétées (LEC-2, freecompub/AgentStudio#33), à la fin du run : une story
 * précédente a commis la même erreur ; l'agent de classement la rattache à une section de catalogue, le
 * code vérifie sa proposition, et la leçon est validée, puis commitée.
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

describe("skraft en workflow — leçons tirées des erreurs répétées (LEC-2)", () => {
  let root: string;
  let tasksDir: string;
  beforeEach(async () => {
    root = await createProject();
    // US-4, un run précédent, a commis la même erreur en DESIGN.
    const avant = erreurDeDefaut({ id: "architecture#1.1", lens: "architecture", severity: "major", description: DEFAUT, file: ".skraft/us-4/design/contracts.md", target: "deliverable", status: "fixed" }, "DESIGN", "us-4");
    await put(root, ".agent-studio/lecons/brut/us-4.jsonl", contenuDuRegistre("", [avant]));
    await put(root, ".agent-studio/lecons/stories.jsonl", `${JSON.stringify({ story: "us-4" })}\n`);
    git(root, "add", "-A");
    git(root, "commit", "-qm", "registre d'une story précédente");
    tasksDir = await mkdtemp(join(tmpdir(), "agent-studio-skraft-tasks-"));
  });
  afterEach(async () => {
    await shutdownHosts();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(tasksDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("le groupe répété devient une leçon validée, rattachée à une section existante ; une référence inventée est refusée", async () => {
    let revues = 0;
    const architecture: ScriptedBehavior = async (t) => {
      revues++;
      await t.callTool("submit_lens_verdict", {
        lens: "architecture",
        verdict: revues === 1 ? "CHANGES_REQUESTED" : "APPROVED",
        defects: revues === 1 ? [{ severity: "major", severityReason: "raison d’essai", description: DEFAUT, file: ".skraft/us12-f15ade30/design/contracts.md", target: "deliverable" }] : [],
      });
    };
    const leconsPrompts: string[] = [];
    const classement: ScriptedBehavior = async (t) => {
      leconsPrompts.push(t.prompt);
      const groupe = /Groupe (\S+) :/.exec(t.prompt)![1];
      const sources = [...t.prompt.matchAll(/^\s+- (\S+#\d+) /gm)].map((m) => m[1]);
      const section = leconsPrompts.length === 1 ? "V-CA-99: Inventée" : "V-CA-06: Infrastructure Details Leaking into Application Contracts";
      await t.callTool("submit_lecons", { lecons: [{ groupe, regle: "Un contrat nomme l'agrégat qu'il expose.", quand: "On écrit contracts.md.", aFaire: "Citer l'agrégat du modèle.", exemple: sources[0], sources, catalogue: { skill: CLEAN, section } }] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-lens-architecture": architecture, "skraft-lecons": classement });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const difficulty = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(difficulty.id, difficulty.options.find((o) => o.id.endsWith(":medium"))!.id);
    await until(async () => (await app.engine.status(id))?.status === "finished", 90_000);

    expect(leconsPrompts).toHaveLength(2);
    expect(leconsPrompts[0]).toContain(DEFAUT);
    expect(leconsPrompts[0]).toContain("V-CA-06: Infrastructure Details Leaking into Application Contracts");
    expect(leconsPrompts[1]).toContain(`« V-CA-99: Inventée » n'est pas une section de ${CLEAN}.`);
    expect(git(root, "log", "--format=%s", "-1")).toBe("docs(skraft): leçons après us12-f15ade30");
    const lecons = git(root, "show", "HEAD:.agent-studio/lecons/lecons.jsonl").trim().split("\n").map((l) => JSON.parse(l));
    expect(lecons).toEqual([expect.objectContaining({ id: "L-01", statut: "validee", role: "skraft-architect-decide", phase: "DESIGN", catalogue: { skill: CLEAN, section: "V-CA-06: Infrastructure Details Leaking into Application Contracts" } })]);
    expect(lecons[0].sources).toHaveLength(2);
    expect(git(root, "show", "HEAD:.agent-studio/lecons/stories.jsonl").trim().split("\n").map((l) => JSON.parse(l).story)).toEqual(["us-4", "us12-f15ade30"]);
    expect(app.posted.at(-1)).toContain("Leçons : 1 nouvelle, 1 validée");
  }, 150_000);
});
