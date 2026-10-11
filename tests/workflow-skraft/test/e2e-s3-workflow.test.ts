// Repris de extensions/skraft-workflow/test/e2e-s3-workflow.test.ts (2026-10-10) : teste le workflow en dossier (ADR 0055).
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
import { renderAdr } from "../../../workflows/skraft/adr.mjs";
import { answerQuestions, assemble, createProject, git, put, ROLE, shutdownHosts, simulatedAgents, until } from "./support/harness.js";

const ADR_ARGS = {
  title: "Plafond appliqué dans le domaine",
  status: "Proposed",
  context: "La dose proposée peut dépasser le plafond défini par le médecin.",
  decision: "`BolusCapPolicy` applique le plafond dans le module Domain.",
  consequences: "L'interface affiche l'alerte produite par le domaine.",
  alternatives: "Plafonner dans l'interface : rejeté.",
};

/** Rapports de revue commités avec DESIGN (D8 de docs/12). */
async function rapportsDuDesign(root: string): Promise<string[]> {
  const ligne = async () => git(root, "log", "--format=%H %s").split("\n").find((l) => l.endsWith("docs(skraft): design de us-12"));
  await until(async () => (await ligne()) !== undefined, 60_000);
  const sha = (await ligne())!.split(" ")[0]!;
  return git(root, "ls-tree", "-r", "--name-only", sha, ".skraft/us-12/reviews/").split("\n").filter(Boolean).map((p) => p.split("/").at(-1)!);
}

describe("skraft en workflow — critères de S3 (DESIGN), script isolé", () => {
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
      // Plus d'outil render_adr (ADR 0055) : l'architecte écrit le fichier, au gabarit ; un amendement le réécrit.
      await put(root, "docs/adr/adr-001-plafond-applique-dans-le-domaine.md", renderAdr(1, amending ? { ...ADR_ARGS, consequences: "Plafond par prise ; l'interface affiche l'alerte." } : ADR_ARGS, "2026-10-10"));
      await t.callTool("report_phase", { summary: "décisions", files: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-architect-model": model, "skraft-architect-decide": decide });
    const app = await assemble(root, runtime, tasksDir);
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

    // 4. Acceptation : statut basculé dans le fichier, phase commitée, la suite déroulée jusqu'au bilan.
    await app.interactions.respond((await ratify()).id, await option("accept"), undefined, { role: "architecte" });
    await until(async () => (await app.engine.status(id))?.status === "finished", 60_000);
    const adr = await readFile(join(root, "docs/adr/adr-001-plafond-applique-dans-le-domaine.md"), "utf8");
    expect(adr).toContain("- Statut : Accepted");
    expect(adr).toContain("Plafond par prise");
    // Rattaché à son US par le code, et la ligne a survécu à l'amendement (réécriture complète).
    expect(adr).toContain("- Story : us-12");
    // Les phases suivantes commitent ensuite : le commit de DESIGN est dans l'historique, avec l'ADR accepté.
    const design = git(root, "log", "--format=%H %s").split("\n").find((l) => l.endsWith("docs(skraft): design de us-12"))!.split(" ")[0]!;
    expect(git(root, "show", `${design}:docs/adr/adr-001-plafond-applique-dans-le-domaine.md`)).toContain("- Statut : Accepted");
    expect(app.posted.at(-1)).toContain("ADR : ADR-001 (Accepted).");
  }, 120_000);

  // D3 (docs/12) : un ADR accepté ne se réécrit plus pendant l'amendement d'un autre.
  it("ADR accepté pendant que l'autre est amendé : statut écrit aussitôt, écriture refusée, réécriture annulée", async () => {
    const ADR1 = "docs/adr/adr-001-plafond-applique-dans-le-domaine.md";
    const ADR2 = "docs/adr/adr-002-alerte-dans-l-interface.md";
    const ADR2_ARGS = { ...ADR_ARGS, title: "Alerte dans l'interface", decision: "L'interface affiche l'alerte du domaine." };
    let amendement = "";
    let amendementFini = false;
    const probes: unknown[] = [];
    const decide: ScriptedBehavior = async (t) => {
      const amending = t.prompt.includes("Amendement demandé sur ADR-002");
      await put(root, ".skraft/us-12/design/contracts.md", "`CapBolus` produit `BolusCapped`.\n");
      if (amending) {
        amendement = await readFile(join(root, ADR1), "utf8");
        probes.push(await t.config.guard.check({ kind: "write", toolName: "edit", path: ADR1 }));
        // Contournement de la garde : la réécriture doit être annulée par le code.
        await put(root, ADR1, amendement.replace("`BolusCapPolicy` applique le plafond dans le module Domain.", "Plafond appliqué dans l'interface."));
        await put(root, ADR2, renderAdr(2, { ...ADR2_ARGS, consequences: "Alerte par prise." }, "2026-10-10"));
        amendementFini = true;
      } else if (!t.prompt.includes("cet ADR appartient à une autre story ou est déjà décidé")) {
        await put(root, ADR1, renderAdr(1, ADR_ARGS, "2026-10-10"));
        await put(root, ADR2, renderAdr(2, ADR2_ARGS, "2026-10-10"));
      }
      await t.callTool("report_phase", { summary: "décisions", files: [] });
    };
    const model: ScriptedBehavior = async (t) => {
      await put(root, ".skraft/us-12/design/event-model.md", "Commande `CapBolus` → événement `BolusCapped`.\n");
      await t.callTool("report_phase", { summary: "modèle", files: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-architect-model": model, "skraft-architect-decide": decide });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const difficulty = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(difficulty.id, difficulty.options.find((o) => o.id.endsWith(":medium"))!.id);
    const ratifier = async (adr: string, action: string, commentaire?: string) => {
      await until(async () => (await app.interactions.pending()).some((x) => x.title === `Ratifier ${adr}`), 60_000);
      const q = (await app.interactions.pending()).find((x) => x.title === `Ratifier ${adr}`)!;
      await app.interactions.respond(q.id, q.options.find((o) => o.id.endsWith(`:${action}`))!.id, commentaire, { role: "architecte" });
    };
    await ratifier("ADR-001", "accept");
    await ratifier("ADR-002", "amend", "alerte par prise");
    await until(async () => amendementFini, 60_000);
    // Le statut est dans le fichier dès la ratification, avant l'amendement de l'autre ADR.
    expect(amendement).toContain("- Statut : Accepted");
    expect(probes).toEqual([expect.objectContaining({ decision: "deny" })]);
    await ratifier("ADR-002", "accept");
    await until(async () => (await app.engine.status(id))?.status === "finished", 60_000);
    const adr1 = await readFile(join(root, ADR1), "utf8");
    expect(adr1).toContain("`BolusCapPolicy` applique le plafond dans le module Domain.");
    expect(adr1).toContain("- Statut : Accepted");
    expect(await readFile(join(root, ADR2), "utf8")).toContain("Alerte par prise.");
  }, 120_000);

  // D8 (docs/12) : un amendement ne consomme pas d'essai ; sa revue ne doit pas écraser la précédente.
  it("amendement : la revue d'avant et celle d'après ont chacune leur rapport (D8)", async () => {
    const ADR1 = "docs/adr/adr-001-plafond-applique-dans-le-domaine.md";
    const decide: ScriptedBehavior = async (t) => {
      await put(root, ".skraft/us-12/design/contracts.md", "`CapBolus` produit `BolusCapped`.\n");
      const amende = t.prompt.includes("Amendement demandé sur ADR-001");
      await put(root, ADR1, renderAdr(1, amende ? { ...ADR_ARGS, consequences: "Alerte par prise." } : ADR_ARGS, "2026-10-10"));
      await t.callTool("report_phase", { summary: "décisions", files: [] });
    };
    const model: ScriptedBehavior = async (t) => {
      await put(root, ".skraft/us-12/design/event-model.md", "Commande `CapBolus` → événement `BolusCapped`.\n");
      await t.callTool("report_phase", { summary: "modèle", files: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-architect-model": model, "skraft-architect-decide": decide });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const difficulty = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(difficulty.id, difficulty.options.find((o) => o.id.endsWith(":medium"))!.id);
    for (const action of ["amend", "accept"]) {
      await until(async () => (await app.interactions.pending()).some((x) => x.title === "Ratifier ADR-001"), 60_000);
      const q = (await app.interactions.pending()).find((x) => x.title === "Ratifier ADR-001")!;
      await app.interactions.respond(q.id, q.options.find((o) => o.id.endsWith(`:${action}`))!.id, action === "amend" ? "alerte par prise" : undefined, { role: "architecte" });
    }
    expect(await rapportsDuDesign(root)).toEqual(["design-review-1.json", "design-review-1.md", "design-review-2.json", "design-review-2.md"]);
  }, 120_000);

  // D2 (docs/12) : la liste des ADR suit le disque, que le rembobinage remet au début de la phase.
  describe("ADR proposés puis effacés par un rembobinage (D2)", () => {
    const DOMAINE = "docs/adr/adr-001-plafond-dans-le-domaine.md";
    const INTERFACE = "docs/adr/adr-001-plafond-dans-l-interface.md";
    const scenario = async (decision: "relancer" | "sauter") => {
      let escalade = false;
      const decide: ScriptedBehavior = async (t) => {
        await put(root, ".skraft/us-12/design/contracts.md", "`CapBolus` produit `BolusCapped`.\n");
        if (escalade) await put(root, INTERFACE, renderAdr(1, { ...ADR_ARGS, title: "Plafond dans l'interface" }, "2026-10-10"));
        else await put(root, DOMAINE, renderAdr(1, { ...ADR_ARGS, title: "Plafond dans le domaine" }, "2026-10-10"));
        await t.callTool("report_phase", { summary: "décisions", files: [] });
      };
      const model: ScriptedBehavior = async (t) => {
        await put(root, ".skraft/us-12/design/event-model.md", "Commande `CapBolus` → événement `BolusCapped`.\n");
        await t.callTool("report_phase", { summary: "modèle", files: [] });
      };
      // Première revue de DESIGN : deux lentilles rejettent, donc REJECTED et escalade.
      const lentille = (lens: string): ScriptedBehavior => async (t) => {
        const rejette = t.prompt.includes("phase DESIGN") && !escalade;
        await t.callTool("submit_lens_verdict", { lens, verdict: rejette ? "REJECTED" : "APPROVED", defects: [] });
      };
      const runtime = simulatedAgents(new ScriptedRuntime(), root, {
        "skraft-architect-model": model,
        "skraft-architect-decide": decide,
        "skraft-lens-cold-reader": lentille("cold-reader"),
        "skraft-lens-architecture": lentille("architecture"),
      });
      const app = await assemble(root, runtime, tasksDir);
      answerQuestions(app);
      await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
      await until(async () => (await app.engine.list()).length > 0);
      const id = (await app.engine.list())[0]!.id;
      await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
      const difficulty = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
      await app.interactions.respond(difficulty.id, difficulty.options.find((o) => o.id.endsWith(":medium"))!.id);
      await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Phase DESIGN")), 60_000);
      escalade = true;
      const q = (await app.interactions.pending()).find((p) => p.title.startsWith("Phase DESIGN"))!;
      await app.interactions.respond(q.id, q.options.find((o) => o.id.endsWith(decision))!.id, undefined, { role: "architecte" });
      return { app, id };
    };

    it("relancer : la ratification porte sur le nouvel ADR, l'ancien chemin est oublié", async () => {
      const { app, id } = await scenario("relancer");
      await until(async () => (await app.interactions.pending()).some((x) => x.title === "Ratifier ADR-001"), 60_000);
      const q = (await app.interactions.pending()).find((x) => x.title === "Ratifier ADR-001")!;
      expect(q.detail).toContain(INTERFACE);
      await app.interactions.respond(q.id, q.options.find((o) => o.id.endsWith(":accept"))!.id, undefined, { role: "architecte" });
      await until(async () => (await app.engine.status(id))?.status === "finished", 60_000);
      expect(((await app.engine.status(id))!.state as { fin?: { statut: string } }).fin?.statut).toBe("fini");
      expect(await readFile(join(root, INTERFACE), "utf8")).toContain("- Statut : Accepted");
    }, 120_000);

    it("sauter : aucun ADR fantôme à ratifier, la tâche continue sans DESIGN", async () => {
      const { app, id } = await scenario("sauter");
      await until(async () => (await app.engine.status(id))?.status === "finished", 60_000);
      expect(((await app.engine.status(id))!.state as { fin?: { statut: string } }).fin?.statut).toBe("fini");
      expect(app.posted.at(-1)).not.toContain("ADR-001");
    }, 120_000);
  });

  // D15 (docs/12) : après « relancer », la phase repart avec le motif de l'escalade.
  it("relancer DESIGN après un verdict REJECTED : le modélisateur reçoit le motif (D15)", async () => {
    let relance = false;
    const modelPrompts: string[] = [];
    const model: ScriptedBehavior = async (t) => {
      modelPrompts.push(t.prompt);
      await put(root, ".skraft/us-12/design/event-model.md", "Commande `CapBolus` → événement `BolusCapped`.\n");
      await t.callTool("report_phase", { summary: "modèle", files: [] });
    };
    const lentille = (lens: string): ScriptedBehavior => async (t) => {
      const rejette = t.prompt.includes("phase DESIGN") && !relance;
      await t.callTool("submit_lens_verdict", { lens, verdict: rejette ? "REJECTED" : "APPROVED", defects: rejette ? [{ severity: "blocker", description: "conception hors sujet", target: "deliverable" }] : [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-architect-model": model,
      "skraft-lens-cold-reader": lentille("cold-reader"),
      "skraft-lens-architecture": lentille("architecture"),
    });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const difficulty = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(difficulty.id, difficulty.options.find((o) => o.id.endsWith(":medium"))!.id);
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Phase DESIGN")), 60_000);
    relance = true;
    const q = (await app.interactions.pending()).find((p) => p.title.startsWith("Phase DESIGN"))!;
    await app.interactions.respond(q.id, q.options.find((o) => o.id.endsWith("relancer"))!.id, undefined, { role: "architecte" });
    await until(async () => (await app.engine.status(id))?.status === "finished", 60_000);
    expect(modelPrompts.at(-1)).toContain("Revue : verdict REJECTED (cold-reader : REJECTED — conception hors sujet");
  }, 120_000);

  // D6 (docs/12) : les lentilles ne reçoivent ni faits d'un run effacé, ni rapports de revue en livrables.
  it("après un rembobinage, les faits de la revue portent sur le run en cours ; les rapports de revue ne sont pas des livrables ni ressuscités (D8)", async () => {
    let revues = 0;
    let relance = false;
    const prompts: string[] = [];
    const model: ScriptedBehavior = async (t) => {
      await put(root, ".skraft/us-12/design/event-model.md", "Commande `CapBolus` → événement `BolusCapped`.\n");
      await t.callTool("report_phase", { summary: "modèle", files: [] });
    };
    const decide: ScriptedBehavior = async (t) => {
      await put(root, ".skraft/us-12/design/contracts.md", relance ? "`CapBolus` produit `BolusCapped` (v2).\n" : `\`CapBolus\` produit \`BolusCapped\` (essai ${revues + 1}).\n`);
      await t.callTool("report_phase", { summary: "décisions", files: [] });
    };
    // Run 1 : revue 1 « changements demandés », revue 2 REJECTED (escalade). Run 2 : approuvée.
    const parLentille: Record<string, number> = {};
    const lentille = (lens: string): ScriptedBehavior => async (t) => {
      if (!t.prompt.includes("phase DESIGN")) return void (await t.callTool("submit_lens_verdict", { lens, verdict: "APPROVED", defects: [] }));
      const n = (parLentille[lens] = (parLentille[lens] ?? 0) + 1);
      if (lens === "architecture") {
        prompts.push(t.prompt);
        revues = n;
      }
      const verdict = relance ? "APPROVED" : n === 1 && lens === "architecture" ? "CHANGES_REQUESTED" : n === 2 && (lens === "architecture" || lens === "cold-reader") ? "REJECTED" : "APPROVED";
      const defects = verdict === "CHANGES_REQUESTED" ? [{ severity: "major", description: "contrat incomplet", target: "deliverable" }] : [];
      await t.callTool("submit_lens_verdict", { lens, verdict, defects });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-architect-model": model,
      "skraft-architect-decide": decide,
      "skraft-lens-cold-reader": lentille("cold-reader"),
      "skraft-lens-architecture": lentille("architecture"),
    });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft-workflow")!.handler("stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    const difficulty = (await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!;
    await app.interactions.respond(difficulty.id, difficulty.options.find((o) => o.id.endsWith(":medium"))!.id);
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Phase DESIGN")), 60_000);
    relance = true;
    const q = (await app.interactions.pending()).find((p) => p.title.startsWith("Phase DESIGN"))!;
    await app.interactions.respond(q.id, q.options.find((o) => o.id.endsWith("relancer"))!.id, undefined, { role: "architecte" });
    await until(async () => (await app.engine.status(id))?.status === "finished", 60_000);
    expect(prompts).toHaveLength(3);
    // Revue 2 : le rapport de la revue 1 est sur le disque, mais ce n'est pas un livrable.
    expect(prompts[1]).not.toContain("/reviews/");
    // Revue du run 2 : seul l'essai en cours, pas l'essai 2 du run effacé.
    expect(prompts[2]).toContain("validée à l'essai 1");
    expect(prompts[2]).not.toContain("à l'essai 2");
    // D8 : les rapports du run effacé ne ressuscitent pas ; le numéro de revue ne recule pas.
    expect(await rapportsDuDesign(root)).toEqual(["design-review-3.json", "design-review-3.md"]);
  }, 120_000);
});
