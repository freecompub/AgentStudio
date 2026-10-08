/**
 * Jumeau de `extensions/skraft/test/e2e-s3.test.ts` pour `/skraft-workflow` (DESIGN) : incohérence
 * rejetée par la porte, ratification réservée à l'architecte, amendement qui ne relance que les
 * décisions. Le workflow s'arrête après DESIGN : on vérifie le dossier de DISTILL au lieu de
 * l'agent d'acceptance.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestions, assemble, createProject, git, put, ROLE, shutdownHosts, simulatedAgents, until } from "./support/harness.js";

const ADR_ARGS = {
  title: "Plafond appliqué dans le domaine",
  status: "Proposed",
  context: "La dose proposée peut dépasser le plafond défini par le médecin.",
  decision: "`BolusCapPolicy` applique le plafond dans le module Domain.",
  consequences: "L'interface affiche l'alerte produite par le domaine.",
  alternatives: "Plafonner dans l'interface : rejeté.",
};

describe.each([
  { mode: "dans le processus principal", isolated: false },
  { mode: "en processus isolé", isolated: true },
])("skraft en workflow — critères de S3 (DESIGN), $mode", ({ isolated }) => {
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

  it("incohérence rejetée, ratification bloquante réservée à l'architecte, amendement relance les décisions", async () => {
    const decidePrompts: string[] = [];
    const model: ScriptedBehavior = async (t) => {
      await put(root, ".skraft/us-12/design/event-model.md", "Commande `CapBolus` → événement `BolusCapped`.\n");
      await put(root, ".skraft/us-12/design/domain-model.md", "Agrégat `BolusCalculation`, objet-valeur `MaxBolus`.\n");
      await t.callTool("report_phase", { summary: "modèle", files: [] });
    };
    const decide: ScriptedBehavior = async (t) => {
      decidePrompts.push(t.prompt);
      const first = decidePrompts.length === 1;
      const amending = t.prompt.includes("Amendement demandé");
      await put(root, ".skraft/us-12/design/contracts.md", first ? "`CapBolus` produit `BolusLimited`.\n" : "`CapBolus` produit `BolusCapped`.\n");
      await t.callTool("render_adr", amending ? { ...ADR_ARGS, number: 1, consequences: "Plafond par prise ; l'interface affiche l'alerte." } : ADR_ARGS);
      await t.callTool("report_phase", { summary: "décisions", files: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-architect-model": model, "skraft-architect-decide": decide });
    const app = await assemble(root, runtime, tasksDir, { isolated });
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const difficulty = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(difficulty.id, difficulty.options.find((o) => o.id.endsWith(":medium"))!.id);

    const ratify = async () => {
      await until(async () => (await app.interactions.pending()).some((x) => x.title === "Ratifier ADR-001"), 60_000);
      return (await app.interactions.pending()).find((x) => x.title === "Ratifier ADR-001")!;
    };
    const option = async (action: string) => (await ratify()).options.find((o) => o.id.endsWith(`:${action}`))!.id;

    // 1. Porte cohérence : rejet précis, puis relance (modélisation et décisions).
    await ratify();
    expect(decidePrompts).toHaveLength(2);
    expect(decidePrompts[1]).toContain("`BolusLimited` cité dans contracts.md n'existe pas dans event-model.md ni dans domain-model.md.");

    // 2. Pas de suite avant la ratification ; seul l'architecte peut ratifier.
    expect((await app.engine.status(id))!.status).toBe("waiting");
    await expect(app.interactions.respond((await ratify()).id, await option("accept"), undefined, { role: "po" })).rejects.toThrow(/Architecte/);

    // 3. Amendement : seule la session de décisions est relancée, avec la demande.
    await app.interactions.respond((await ratify()).id, await option("amend"), "préciser que le plafond est par prise", { role: "architecte" });
    await until(async () => decidePrompts.length === 3);
    expect(decidePrompts[2]).toContain("Amendement demandé sur ADR-001 : préciser que le plafond est par prise");
    const roles = runtime.history.map((h) => runtime.configs.get(h.id)?.role);
    expect(roles.filter((r) => r === ROLE("skraft-architect-model"))).toHaveLength(2);

    // 4. Acceptation : statut basculé dans le fichier, phase commitée, dossier de DISTILL publié.
    await app.interactions.respond((await ratify()).id, await option("accept"), undefined, { role: "architecte" });
    await until(async () => (await app.engine.status(id))?.status === "finished", 60_000);
    const adr = await readFile(join(root, "docs/adr/adr-001-plafond-applique-dans-le-domaine.md"), "utf8");
    expect(adr).toContain("- Statut : Accepted");
    expect(adr).toContain("Plafond par prise");
    // DISTILL commite ensuite : le commit de DESIGN est dans l'historique, avec l'ADR accepté.
    expect(git(root, "log", "--format=%s")).toContain("docs(skraft): design de us-12");
    expect(git(root, "show", "HEAD~1:docs/adr/adr-001-plafond-applique-dans-le-domaine.md")).toContain("- Statut : Accepted");
    expect(git(root, "show", "HEAD:docs/adr/adr-001-plafond-applique-dans-le-domaine.md")).toContain("- Statut : Accepted");
    expect(app.posted.find((m) => m.includes("prête pour DELIVER"))).toContain("ADR-001 (Accepted) : docs/adr/adr-001-plafond-applique-dans-le-domaine.md");
  }, 120_000);
});
