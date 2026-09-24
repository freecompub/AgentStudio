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

  it("incohérence rejetée, ratification bloquante réservée à l'architecte, amendement relance les décisions", async () => {
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
      await put(root, ".skraft/us-12/design/contracts.md", first ? "`CapBolus` produit `BolusLimited`.\n" : "`CapBolus` produit `BolusCapped`.\n");
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

    // 2. DISTILL inatteignable avant la ratification ; seul l'architecte peut ratifier.
    const s = stateOf(await app.engine.status(id))!;
    expect(s.adrs).toEqual([{ id: "ADR-001", path: "docs/adr/adr-001-plafond-applique-dans-le-domaine.md", status: "Proposed" }]);
    expect(acceptanceRan).toBe(false);
    // La demande de ratification naît d'un effet asynchrone : l'attendre, plutôt que de
    // supposer qu'elle est déjà là — sous charge, elle ne l'est pas toujours.
    const ratify = async () => {
      await until(async () => (await app.interactions.pending()).some((x) => x.title === "Ratifier ADR-001"));
      return (await app.interactions.pending()).find((x) => x.title === "Ratifier ADR-001")!;
    };
    await expect(app.interactions.respond((await ratify()).id, "accept:ADR-001", undefined, { role: "po" })).rejects.toThrow(/Architecte/);

    // 3. Amendement : relance de skraft-architect-decide avec la demande, nouvel ADR proposé au même numéro.
    await app.interactions.respond((await ratify()).id, "amend:ADR-001", "préciser que le plafond est par prise", { role: "architecte" });
    await until(async () => decidePrompts.length === 3);
    expect(decidePrompts[2]).toContain("Amendement demandé sur ADR-001 : préciser que le plafond est par prise");
    // Seule la session de décisions est relancée par l'amendement, pas la modélisation.
    const roles = runtime.history.map((h) => runtime.configs.get(h.id)?.role);
    expect(roles.filter((r) => r === ROLE("skraft-architect-model"))).toHaveLength(2);
    await until(async () => stateOf(await app.engine.status(id))?.stage === "RATIFICATION" && !!(await ratify()), 60_000);
    expect(acceptanceRan).toBe(false);

    // 4. Acceptation par l'architecte : statut basculé dans le fichier, phase enregistrée, DISTILL démarre.
    await app.interactions.respond((await ratify()).id, "accept:ADR-001", undefined, { role: "architecte" });
    await until(async () => acceptanceRan, 60_000);
    const adr = await readFile(join(root, "docs/adr/adr-001-plafond-applique-dans-le-domaine.md"), "utf8");
    expect(adr).toContain("- Statut : Accepted");
    expect(adr).toContain("Plafond par prise");
    expect(git(root, "show", "--name-only", "--format=%s", `HEAD`)).toMatch(/^docs\(skraft\): design de us-12/);
    expect(git(root, "show", "HEAD:docs/adr/adr-001-plafond-applique-dans-le-domaine.md")).toContain("- Statut : Accepted");
    expect(stateOf(await app.engine.status(id))!.adrs[0]).toMatchObject({ status: "Accepted", decisionBy: "user" });
  }, 120_000);
});
