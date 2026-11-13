/**
 * Critères de sortie de S3 (SPEC-skraft §14) :
 *  - la fixture de cohérence est rejetée (nom d'événement incohérent) ;
 *  - DISTILL est inatteignable avant la ratification ;
 *  - « amend » relance le bon rôle (skraft-architect-decide).
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime, type ScriptedBehavior } from "@agent-studio/core/testing";
import type { ExtensionContext } from "@agent-studio/extension-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderAdrTool } from "../src/render-adr-tool.js";
import { answerQuestions, assemble, createProject, git, put, ROLE, shutdownHosts, simulatedAgents, stateOf, until } from "./support/harness.js";

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

describe("render_adr (outil de l'extension)", () => {
  function fakeCtx(files: Record<string, string>): ExtensionContext {
    return {
      workspace: {
        listFiles: async () => Object.keys(files),
        readFile: async (p: string) => {
          if (!(p in files)) throw new Error("absent");
          return files[p]!;
        },
        writeFile: async (p: string, c: string) => void (files[p] = c),
      },
    } as unknown as ExtensionContext;
  }

  it("numéro suivant, gabarit, registre des remplacements", async () => {
    const files: Record<string, string> = { "docs/adr/adr-001-existant.md": "# ADR-001 — Existant\n\n- Statut : Accepted\n" };
    const tool = renderAdrTool(fakeCtx(files), () => "2026-09-23");
    expect(await tool.handler({ ...ADR_ARGS, supersedes: ["ADR-001"] })).toBe("ADR-002 rédigé : docs/adr/adr-002-plafond-applique-dans-le-domaine.md");
    expect(files["docs/adr/adr-002-plafond-applique-dans-le-domaine.md"]).toContain("- Remplace : ADR-001");
    expect(files["docs/adr/supersessions.md"]).toContain("- ADR-002 remplace ADR-001");
  });

  it("refus : champ vide, statut imposé, amendement d'un ADR déjà décidé", async () => {
    const tool = renderAdrTool(fakeCtx({ "docs/adr/adr-001-existant.md": "# ADR-001 — Existant\n\n- Statut : Accepted\n" }));
    await expect(tool.handler({ ...ADR_ARGS, decision: "" })).rejects.toThrow(/Champ obligatoire vide : decision/);
    await expect(tool.handler({ ...ADR_ARGS, status: "Accepted" })).rejects.toThrow(/Proposed/);
    await expect(tool.handler({ ...ADR_ARGS, number: 1 })).rejects.toThrow(/déjà Accepted/);
  });
});

describe("skraft — critères de sortie de S3 (DESIGN)", () => {
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

  // Phase 7.0 du plugin retirée le 11/11 (décision du responsable) : la porte juge ce que la story produit,
  // pas l'existant. Un engagement déjà dans le code n'exige plus d'ADR de rattrapage.
  it("un bus de commandes déjà dans le code, sans ADR : DESIGN n'est pas refusée, la ratification arrive au premier essai", async () => {
    await put(root, "src/app/command-bus.ts", "export class CommandBus {}\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "bus");
    const decidePrompts: string[] = [];
    const model: ScriptedBehavior = async (t) => {
      await put(root, ".skraft/us-12/design/event-model.md", "Commande `CapBolus` → événement `BolusCapped`.\n");
      await t.callTool("report_phase", { summary: "modèle", files: [] });
    };
    const decide: ScriptedBehavior = async (t) => {
      decidePrompts.push(t.prompt);
      await put(root, ".skraft/us-12/design/contracts.md", "## Commande `CapBolus`\n\n## Événement `BolusCapped`\n");
      await t.callTool("render_adr", ADR_ARGS);
      await t.callTool("report_phase", { summary: "décisions", files: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-architect-model": model, "skraft-architect-decide": decide });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    await app.interactions.respond((await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!.id, "medium");
    await until(async () => stateOf(await app.engine.status(id))?.stage === "RATIFICATION", 60_000);
    expect(decidePrompts).toHaveLength(1);
  }, 120_000);


  // L'architecte qui décide signale un défaut du modèle au lieu de le corriger : le code relance le
  // modélisateur avec la remarque, une seule fois par essai, puis l'architecte qui décide (11/11).
  it("un défaut du modèle signalé par l'architecte qui décide relance le modélisateur, une fois ; il ne peut pas écrire le modèle", async () => {
    const REMARQUE = "`MaxBolus` est cité par la story mais manque au modèle de domaine.";
    const modelPrompts: string[] = [];
    const decidePrompts: string[] = [];
    const probes: unknown[] = [];
    const model: ScriptedBehavior = async (t) => {
      modelPrompts.push(t.prompt);
      await put(root, ".skraft/us-12/design/event-model.md", "Commande `CapBolus` → événement `BolusCapped`.\n");
      await t.callTool("report_phase", { summary: "modèle", files: [] });
    };
    const decide: ScriptedBehavior = async (t) => {
      decidePrompts.push(t.prompt);
      probes.push(await t.config.guard.check({ kind: "write", toolName: "edit", path: ".skraft/us-12/design/event-model.md" }));
      await put(root, ".skraft/us-12/design/contracts.md", "## Commande `CapBolus`\n\n## Événement `BolusCapped`\n");
      await t.callTool("render_adr", ADR_ARGS);
      await t.callTool("report_phase", { summary: "décisions", files: [], modelDefects: [REMARQUE] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-architect-model": model, "skraft-architect-decide": decide });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    await app.interactions.respond((await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!.id, "medium");
    await until(async () => stateOf(await app.engine.status(id))?.stage === "RATIFICATION", 60_000);
    expect(modelPrompts).toHaveLength(2);
    expect(modelPrompts[1]).toContain(`Remarque de l'architecte qui décide sur le modèle : ${REMARQUE}`);
    expect(decidePrompts).toHaveLength(2);
    expect(probes[0]).toEqual(expect.objectContaining({ decision: "deny" }));
  }, 120_000);
  it("incohérence rejetée, ratification bloquante, amendement relance les décisions", async () => {
    const decidePrompts: string[] = [];
    let acceptanceRan = false;
    const model: ScriptedBehavior = async (t) => {
      await put(root, ".skraft/us-12/design/event-model.md", "Commande `CapBolus` → événement `BolusCapped`.\n");
      await put(root, ".skraft/us-12/design/domain-model.md", "Agrégat `BolusCalculation`, objet-valeur `MaxBolus`.\n");
      await t.callTool("report_phase", { summary: "modèle", files: [] });
    };
    const decide: ScriptedBehavior = async (t) => {
      decidePrompts.push(t.prompt);
      const first = decidePrompts.length === 1;
      const amending = t.prompt.includes("Amendement demandé");
      // Premier essai : nom d'événement incohérent avec le modèle.
      await put(root, ".skraft/us-12/design/contracts.md", first ? "## Commande `CapBolus`\n\n## Événement `BolusCapped`\n\n`CapBolus` produit `BolusLimited`.\n" : "## Commande `CapBolus`\n\n## Événement `BolusCapped`\n\n`CapBolus` produit `BolusCapped`.\n");
      await t.callTool("render_adr", amending ? { ...ADR_ARGS, number: 1, consequences: "Plafond par prise ; l'interface affiche l'alerte." } : ADR_ARGS);
      await t.callTool("report_phase", { summary: "décisions", files: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-architect-model": model,
      "skraft-architect-decide": decide,
      "skraft-acceptance": async (t) => {
        acceptanceRan = true;
        await put(root, ".skraft/us-12/distill/features/plafond.feature", "Fonctionnalité: plafond\n");
        await t.callTool("report_phase", { summary: "scénarios", files: [] });
      },
    });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;
    const [difficulty] = await (async () => {
      await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
      return (await app.interactions.pending()).filter((p) => p.title.startsWith("Difficulté"));
    })();
    await app.interactions.respond(difficulty!.id, "medium");

    // 1. Porte cohérence : rejet précis, puis relance (modélisation et décisions).
    await until(async () => stateOf(await app.engine.status(id))?.stage === "RATIFICATION", 60_000);
    expect(decidePrompts).toHaveLength(2);
    expect(decidePrompts[1]).toContain("`BolusLimited` cité dans contracts.md n'existe pas dans event-model.md ni dans domain-model.md.");

    // 2. DISTILL inatteignable avant la ratification .
    const s = stateOf(await app.engine.status(id))!;
    expect(s.adrs).toEqual([{ id: "ADR-001", path: "docs/adr/adr-001-plafond-applique-dans-le-domaine.md", status: "Proposed" }]);
    expect(acceptanceRan).toBe(false);
    // La demande de ratification naît d'un effet asynchrone : l'attendre, plutôt que de
    // supposer qu'elle est déjà là — sous charge, elle ne l'est pas toujours.
    const ratify = async () => {
      await until(async () => (await app.interactions.pending()).some((x) => x.title === "Ratifier ADR-001"));
      return (await app.interactions.pending()).find((x) => x.title === "Ratifier ADR-001")!;
    };

    // 3. Amendement : relance de skraft-architect-decide avec la demande, nouvel ADR proposé au même numéro.
    await app.interactions.respond((await ratify()).id, "amend:ADR-001", "préciser que le plafond est par prise");
    await until(async () => decidePrompts.length === 3);
    expect(decidePrompts[2]).toContain("Amendement demandé sur ADR-001 : préciser que le plafond est par prise");
    // Seule la session de décisions est relancée par l'amendement, pas la modélisation.
    const roles = runtime.history.map((h) => runtime.configs.get(h.id)?.role);
    expect(roles.filter((r) => r === ROLE("skraft-architect-model"))).toHaveLength(2);
    await until(async () => stateOf(await app.engine.status(id))?.stage === "RATIFICATION" && !!(await ratify()), 60_000);
    expect(acceptanceRan).toBe(false);

    // 4. Acceptation par l'architecte : statut basculé dans le fichier, phase enregistrée, DISTILL démarre.
    await app.interactions.respond((await ratify()).id, "accept:ADR-001");
    await until(async () => acceptanceRan, 60_000);
    const adr = await readFile(join(root, "docs/adr/adr-001-plafond-applique-dans-le-domaine.md"), "utf8");
    expect(adr).toContain("- Statut : Accepted");
    expect(adr).toContain("Plafond par prise");
    expect(git(root, "show", "--name-only", "--format=%s", `HEAD`)).toMatch(/^docs\(skraft\): design de us-12/);
    expect(git(root, "show", "HEAD:docs/adr/adr-001-plafond-applique-dans-le-domaine.md")).toContain("- Statut : Accepted");
    // La matrice de cohérence est écrite par le code et commitée avec DESIGN (G10, docs/15 §4.5).
    const matrice = git(root, "show", "HEAD:.skraft/us-12/design/consistency-matrix.md");
    expect(matrice).toContain("| `CapBolus` | Commande |");
    expect(matrice).toContain("consistency-gate: PASS");
    expect(stateOf(await app.engine.status(id))!.adrs[0]).toMatchObject({ status: "Accepted", decisionBy: "user" });
  }, 120_000);

  // D3 (docs/12) : un ADR accepté ne se réécrit plus pendant l'amendement d'un autre.
  it("ADR accepté pendant que l'autre est amendé : statut écrit aussitôt, réécriture refusée", async () => {
    const ADR1 = "docs/adr/adr-001-plafond-applique-dans-le-domaine.md";
    const ADR2_ARGS = { ...ADR_ARGS, title: "Alerte dans l'interface", decision: "L'interface affiche l'alerte du domaine." };
    let pendantAmendement = "";
    let amendementFini = false;
    const probes: unknown[] = [];
    const refus: string[] = [];
    let acceptanceRan = false;
    const decide: ScriptedBehavior = async (t) => {
      await put(root, ".skraft/us-12/design/contracts.md", "## Commande `CapBolus`\n\n## Événement `BolusCapped`\n\n`CapBolus` produit `BolusCapped`.\n");
      if (t.prompt.includes("Amendement demandé sur ADR-002")) {
        pendantAmendement = await readFile(join(root, ADR1), "utf8");
        probes.push(await t.config.guard.check({ kind: "write", toolName: "edit", path: ADR1 }));
        await t.callTool("render_adr", { ...ADR_ARGS, number: 1, decision: "Plafond appliqué dans l'interface." }).catch((e: Error) => void refus.push(e.message));
        await t.callTool("render_adr", { ...ADR2_ARGS, number: 2, consequences: "Alerte par prise." });
        amendementFini = true;
      } else {
        await t.callTool("render_adr", ADR_ARGS);
        await t.callTool("render_adr", ADR2_ARGS);
      }
      await t.callTool("report_phase", { summary: "décisions", files: [] });
    };
    const model: ScriptedBehavior = async (t) => {
      await put(root, ".skraft/us-12/design/event-model.md", "Commande `CapBolus` → événement `BolusCapped`.\n");
      await t.callTool("report_phase", { summary: "modèle", files: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-architect-model": model,
      "skraft-architect-decide": decide,
      "skraft-acceptance": async (t) => {
        acceptanceRan = true;
        await put(root, ".skraft/us-12/distill/features/plafond.feature", "Fonctionnalité: plafond\n");
        await t.callTool("report_phase", { summary: "scénarios", files: [] });
      },
    });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    await app.interactions.respond((await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!.id, "medium");
    const ratifier = async (adr: string, action: string, commentaire?: string) => {
      await until(async () => (await app.interactions.pending()).some((x) => x.title === `Ratifier ${adr}`), 60_000);
      const q = (await app.interactions.pending()).find((x) => x.title === `Ratifier ${adr}`)!;
      await app.interactions.respond(q.id, `${action}:${adr}`, commentaire);
    };
    await ratifier("ADR-001", "accept");
    await ratifier("ADR-002", "amend", "alerte par prise");
    await until(async () => amendementFini, 60_000);
    expect(pendantAmendement).toContain("- Statut : Accepted");
    expect(probes).toEqual([expect.objectContaining({ decision: "deny" })]);
    expect(refus).toEqual([expect.stringMatching(/déjà Accepted/)]);
    await ratifier("ADR-002", "accept");
    await until(async () => acceptanceRan, 60_000);
    const adr1 = await readFile(join(root, ADR1), "utf8");
    expect(adr1).toContain("`BolusCapPolicy` applique le plafond dans le module Domain.");
    expect(adr1).toContain("- Statut : Accepted");
  }, 120_000);

  // D2 (docs/12) : la liste des ADR revient au début de la phase avec le dépôt.
  describe("ADR proposés puis effacés par un rembobinage (D2)", () => {
    const INTERFACE = "docs/adr/adr-001-plafond-dans-l-interface.md";
    const scenario = async (decision: "retry" | "skip") => {
      let escalade = false;
      let acceptanceRan = false;
      const decide: ScriptedBehavior = async (t) => {
        await put(root, ".skraft/us-12/design/contracts.md", "## Commande `CapBolus`\n\n## Événement `BolusCapped`\n\n`CapBolus` produit `BolusCapped`.\n");
        await t.callTool("render_adr", { ...ADR_ARGS, title: escalade ? "Plafond dans l'interface" : "Plafond dans le domaine" });
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
        "skraft-acceptance": async (t) => {
          acceptanceRan = true;
          await put(root, ".skraft/us-12/distill/features/plafond.feature", "Fonctionnalité: plafond\n");
          await t.callTool("report_phase", { summary: "scénarios", files: [] });
        },
      });
      const app = await assemble(root, runtime, tasksDir);
      answerQuestions(app);
      await app.registry.command("skraft")!.handler("stories/us-12.md");
      await until(async () => (await app.engine.list()).length > 0);
      const id = (await app.engine.list())[0]!.id;
      await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
      await app.interactions.respond((await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!.id, "medium");
      await until(async () => (await app.interactions.pending()).some((p) => p.title === "Pipeline skraft bloqué (DESIGN)"), 60_000);
      escalade = true;
      const q = (await app.interactions.pending()).find((p) => p.title === "Pipeline skraft bloqué (DESIGN)")!;
      await app.interactions.respond(q.id, decision);
      return { app, id, acceptance: () => acceptanceRan };
    };

    it("relancer : la ratification porte sur le nouvel ADR, l'ancien est oublié", async () => {
      const { app, id, acceptance } = await scenario("retry");
      await until(async () => (await app.interactions.pending()).some((x) => x.title === "Ratifier ADR-001"), 60_000);
      const q = (await app.interactions.pending()).find((x) => x.title === "Ratifier ADR-001")!;
      expect(q.detail).toContain(INTERFACE);
      expect(stateOf(await app.engine.status(id))!.adrs).toEqual([{ id: "ADR-001", path: INTERFACE, status: "Proposed" }]);
      await app.interactions.respond(q.id, "accept:ADR-001");
      await until(async () => acceptance(), 60_000);
      expect(await readFile(join(root, INTERFACE), "utf8")).toContain("- Statut : Accepted");
    }, 120_000);

    it("sauter : aucun ADR fantôme à ratifier, DESIGN ni terminée ni ratifiée", async () => {
      const { app, id, acceptance } = await scenario("skip");
      await until(async () => acceptance(), 60_000);
      const s = stateOf(await app.engine.status(id))!;
      expect(s.adrs).toEqual([]);
      expect(s.skipPhases).toContain("DESIGN");
      expect(s.phasesCompleted).not.toContain("DESIGN");
      expect((await app.interactions.pending()).some((x) => x.title.startsWith("Ratifier"))).toBe(false);
    }, 120_000);
  });

  // D8 (docs/12) : un amendement ne consomme pas d'essai ; sa revue ne doit pas écraser la précédente.
  it("amendement : la revue d'avant et celle d'après ont chacune leur rapport (D8)", async () => {
    const decide: ScriptedBehavior = async (t) => {
      await put(root, ".skraft/us-12/design/contracts.md", "## Commande `CapBolus`\n\n## Événement `BolusCapped`\n\n`CapBolus` produit `BolusCapped`.\n");
      const amende = t.prompt.includes("Amendement demandé sur ADR-001");
      await t.callTool("render_adr", amende ? { ...ADR_ARGS, number: 1, consequences: "Alerte par prise." } : ADR_ARGS);
      await t.callTool("report_phase", { summary: "décisions", files: [] });
    };
    const model: ScriptedBehavior = async (t) => {
      await put(root, ".skraft/us-12/design/event-model.md", "Commande `CapBolus` → événement `BolusCapped`.\n");
      await t.callTool("report_phase", { summary: "modèle", files: [] });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, { "skraft-architect-model": model, "skraft-architect-decide": decide });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    await app.interactions.respond((await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!.id, "medium");
    for (const action of ["amend", "accept"]) {
      await until(async () => (await app.interactions.pending()).some((x) => x.title === "Ratifier ADR-001"), 60_000);
      const q = (await app.interactions.pending()).find((x) => x.title === "Ratifier ADR-001")!;
      await app.interactions.respond(q.id, `${action}:ADR-001`, action === "amend" ? "alerte par prise" : undefined);
    }
    expect(await rapportsDuDesign(root)).toEqual(["design-review-1.json", "design-review-1.md", "design-review-2.json", "design-review-2.md"]);
  }, 120_000);

  // D6 (docs/12) : les lentilles ne reçoivent ni faits d'un run effacé, ni rapports de revue en livrables.
  it("après un rembobinage, les faits de la revue portent sur le run en cours ; les rapports de revue ne sont pas des livrables ni ressuscités (D8)", async () => {
    let relance = false;
    let decisions = 0;
    const prompts: string[] = [];
    const model: ScriptedBehavior = async (t) => {
      await put(root, ".skraft/us-12/design/event-model.md", "Commande `CapBolus` → événement `BolusCapped`.\n");
      await t.callTool("report_phase", { summary: "modèle", files: [] });
    };
    const decide: ScriptedBehavior = async (t) => {
      decisions++;
      await put(root, ".skraft/us-12/design/contracts.md", relance ? "## Commande `CapBolus`\n\n## Événement `BolusCapped`\n\n`CapBolus` produit `BolusCapped` (v2).\n" : `## Commande \`CapBolus\`\n\n## Événement \`BolusCapped\`\n\n\`CapBolus\` produit \`BolusCapped\` (essai ${decisions}).\n`);
      await t.callTool("report_phase", { summary: "décisions", files: [] });
    };
    // Run 1 : revue 1 « changements demandés », revue 2 REJECTED (escalade). Run 2 : approuvée.
    const parLentille: Record<string, number> = {};
    const lentille = (lens: string): ScriptedBehavior => async (t) => {
      if (!t.prompt.includes("phase DESIGN")) return void (await t.callTool("submit_lens_verdict", { lens, verdict: "APPROVED", defects: [] }));
      const n = (parLentille[lens] = (parLentille[lens] ?? 0) + 1);
      if (lens === "architecture") prompts.push(t.prompt);
      const verdict = relance ? "APPROVED" : n === 1 && lens === "architecture" ? "CHANGES_REQUESTED" : n === 2 && (lens === "architecture" || lens === "test-integrity") ? "REJECTED" : "APPROVED";
      const defects = verdict === "CHANGES_REQUESTED" ? [{ severity: "major", severityReason: "raison d’essai", description: "contrat incomplet", target: "deliverable" }] : [];
      await t.callTool("submit_lens_verdict", { lens, verdict, defects });
    };
    const runtime = simulatedAgents(new ScriptedRuntime(), root, {
      "skraft-architect-model": model,
      "skraft-architect-decide": decide,
      "skraft-lens-test-integrity": lentille("test-integrity"),
      "skraft-lens-architecture": lentille("architecture"),
    });
    const app = await assemble(root, runtime, tasksDir);
    answerQuestions(app);
    await app.registry.command("skraft")!.handler("stories/us-12.md");
    await until(async () => (await app.engine.list()).length > 0);
    const id = (await app.engine.list())[0]!.id;
    await until(async () => (await app.interactions.pending()).some((p) => p.title.startsWith("Difficulté")));
    await app.interactions.respond((await app.interactions.pending()).find((p) => p.title.startsWith("Difficulté"))!.id, "medium");
    await until(async () => (await app.interactions.pending()).some((p) => p.title === "Pipeline skraft bloqué (DESIGN)"), 60_000);
    relance = true;
    const q = (await app.interactions.pending()).find((p) => p.title === "Pipeline skraft bloqué (DESIGN)")!;
    await app.interactions.respond(q.id, "retry");
    await until(async () => (stateOf(await app.engine.status(id))?.phasesCompleted ?? []).includes("DESIGN"), 60_000);
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
