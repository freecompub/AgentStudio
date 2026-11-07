/**
 * Skill d'architecture transmise à l'appel (`/skraft <story> --archi <nom>`, skills de skraft-plugin
 * v1.15.1) : le modélisateur la reçoit dans son dossier ; inconnue, skraft prévient et retient la
 * clean architecture par défaut.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, shutdownHosts, simulatedAgents, until } from "./support/harness.js";

describe("skraft — skill d'architecture transmise à l'appel", () => {
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

  async function dossierDuModelisateur(args: string) {
    const prompts: string[] = [];
    const modelisateur: ScriptedBehavior = async (t) => {
      prompts.push(t.prompt);
      await t.callTool("report_phase", { summary: "modèle", files: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-architect-model": modelisateur });
    const app = await assemble(root, runtime, tasksDir, { isolated: true });
    answerQuestions(app);
    await app.registry.command("skraft")!.handler(args);
    await until(async () => prompts.length > 0, 60_000);
    return { app, prompt: prompts[0]! };
  }

  it("--archi java : le modélisateur doit charger clean-architecture-java ; la pile vient de l'adaptateur", async () => {
    const { prompt } = await dossierDuModelisateur("--auto stories/us-12.md --archi java");
    expect(prompt).toContain("Architecture du projet : charge la skill `clean-architecture-java`");
    expect(prompt).toContain("Pile du projet : typescript ;");
  }, 90_000);

  it("--archi inconnue : avertissement, et la clean architecture par défaut", async () => {
    const { app, prompt } = await dossierDuModelisateur("--auto stories/us-12.md --archi cobol");
    expect(app.posted).toContainEqual(expect.stringContaining("Skill d'architecture « cobol » inconnue"));
    expect(prompt).toContain("Architecture du projet : clean architecture par défaut, skill `architecture-patterns`.");
  }, 90_000);
});
