/**
 * Registre des erreurs commises (LEC-1, freecompub/AgentStudio#32), mené par le workflow : un défaut de
 * revue retenu en DESIGN et un refus de la porte des valeurs en DISTILL sont enregistrés dans le
 * fichier de la story, commité à la fin du run ; aucun agent ne peut l'écrire.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptanceWriter, answerQuestions, assemble, createProject, git, put, shutdownHosts, simulatedAgents, until } from "./support/harness.js";

const REGISTRE = ".agent-studio/lecons/brut/us12-f15ade30.jsonl";

describe("skraft en workflow — registre des erreurs commises (LEC-1)", () => {
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

  it("le défaut retenu et le refus de porte sont enregistrés, puis commités seuls à la fin du run ; aucun agent ne peut écrire le registre", async () => {
    let revues = 0;
    const architecture: ScriptedBehavior = async (t) => {
      revues++;
      await t.callTool("submit_lens_verdict", {
        lens: "architecture",
        verdict: revues === 1 ? "CHANGES_REQUESTED" : "APPROVED",
        defects: revues === 1 ? [{ severity: "major", severityReason: "raison d’essai", description: "contracts.md ne nomme pas l'agrégat.", file: ".skraft/us12-f15ade30/design/contracts.md", target: "deliverable" }] : [],
      });
    };
    let essais = 0;
    const probes: unknown[] = [];
    const ecrire = acceptanceWriter(root);
    const acceptance: ScriptedBehavior = async (t) => {
      essais++;
      probes.push(await t.config.guard.check({ kind: "write", toolName: "edit", path: REGISTRE }));
      await ecrire({ ...t, callTool: async (n, a) => (n === "report_phase" ? undefined : t.callTool(n, a)) });
      if (essais === 1) {
        const feature = ".skraft/us12-f15ade30/distill/features/plafond.feature";
        await put(root, feature, (await readFile(join(root, feature), "utf8")).replace("12,5 U", "douze unités"));
      }
      await t.callTool("report_phase", { summary: "scénarios", files: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-lens-architecture": architecture, "skraft-acceptance": acceptance });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const difficulty = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(difficulty.id, difficulty.options.find((o) => o.id.endsWith(":medium"))!.id);
    await until(async () => (await app.engine.status(id))?.status === "finished", 90_000);

    // Le commit des leçons (LEC-2) suit celui du registre : on le retrouve par son message.
    const commit = git(root, "log", "--format=%H %s").split("\n").find((l) => l.endsWith("docs(skraft): registre des erreurs de us12-f15ade30"))!.split(" ")[0]!;
    expect(git(root, "show", "--name-only", "--format=", commit).trim()).toBe(REGISTRE);
    const erreurs = git(root, "show", `${commit}:${REGISTRE}`).trim().split("\n").map((l) => JSON.parse(l));
    expect(erreurs).toEqual([
      expect.objectContaining({ type: "defaut", story: "us12-f15ade30", phase: "DESIGN", lentille: "architecture", cible: "deliverable", description: "contracts.md ne nomme pas l'agrégat." }),
      expect.objectContaining({ type: "refus", story: "us12-f15ade30", phase: "DISTILL", porte: "valeurs" }),
    ]);
    expect(probes[0]).toEqual(expect.objectContaining({ decision: "deny" }));
    expect(app.posted.at(-1)).toContain(`Registre des erreurs : 2 erreur(s) enregistrée(s) dans ${REGISTRE}`);
  }, 150_000);

  it("phase escaladée puis abandonnée : le registre est écrit avant la question, et reste après l'abandon", async () => {
    // Le même refus deux fois : le disjoncteur escalade DESIGN (ADR 0073).
    const decide: ScriptedBehavior = async (t) => {
      await put(root, ".skraft/us12-f15ade30/design/contracts.md", "## Commande `CapBolus`\n\n## Événement `BolusCapped`\n");
      await put(root, "docs/adr/adr-001-plafond.md", "# ADR 0001 — Plafond\n\n- Statut : Proposed\n");
      await t.callTool("report_phase", { summary: "décisions", files: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-architect-decide": decide });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const difficulty = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(difficulty.id, difficulty.options.find((o) => o.id.endsWith(":medium"))!.id);
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Phase DESIGN")), 60_000);
    const lignes = (await readFile(join(root, REGISTRE), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(lignes.length).toBeGreaterThanOrEqual(2);
    expect(lignes.every((e) => e.type === "refus" && e.phase === "DESIGN" && e.story === "us12-f15ade30")).toBe(true);
    const escalade = (await app.interactions.pending()).find((p) => p.title.startsWith("Phase DESIGN"))!;
    await app.interactions.respond(escalade.id, escalade.options.find((o) => /abandon/.test(o.id))!.id);
    await until(async () => (await app.engine.status(id))?.status === "finished", 60_000);
    expect(((await app.engine.status(id))!.state as { fin?: { statut: string } }).fin?.statut).toBe("echec");
    expect((await readFile(join(root, REGISTRE), "utf8")).trim().split("\n")).toHaveLength(lignes.length);
  }, 150_000);
});
