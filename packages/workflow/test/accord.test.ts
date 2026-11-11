import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJsonAccordStore, resumeAccord, verifierAccord } from "../src/accord/accords.js";
import type { WorkflowTrouve } from "../src/chargeur/chargeur.js";
import type { MetaWorkflow } from "../src/chargeur/schema.js";
import { createWorkflowTask } from "../src/workflow-task.js";
import { fauxContexte, lancer } from "./faux-contexte.js";

/** Accord de l'utilisateur et gel du dossier (ADR 0055, `docs/11` §7). */

const META: MetaWorkflow = {
  name: "skraft",
  description: "Livre une user story.",
  commande: "skraft",
  entrees: {},
  outils: {},
  phases: {},
  humains: { "ratifier-adr": ["architecte"] },
  permissions: { ecriture: [".skraft/**", "@stack:unitTests"], tests: true, git: ["branche", "commit"] },
  agents: { "skraft-test": { prompt: "agents/skraft-test.agent.md", ecriture: ["@stack:unitTests"], outils: ["run_tests"], sortie: "report_phase" } },
};
const wf = (empreinte = "sha256:aaa"): WorkflowTrouve => ({ nom: "skraft", origine: "projet", dossier: "/projet/.agent-studio/workflows/skraft", meta: META, empreinte });

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "accords-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const confirmeur = (reponse: "allow-once" | "allow-always" | "deny") => {
  const demandes: { title: string; detail: string }[] = [];
  return { demandes, confirm: async (r: { title: string; detail: string }) => (demandes.push(r), reponse) };
};

describe("accord par empreinte", () => {
  it("le résumé montre d'où vient le workflow, ce que le script peut faire, ses agents et ses questions", () => {
    const r = resumeAccord(wf());
    expect(r.title).toBe("Exécuter le workflow « skraft » (projet) ?");
    expect(r.detail).toContain("/projet/.agent-studio/workflows/skraft");
    expect(r.detail).toContain("Écrire : .skraft/**, @stack:unitTests");
    expect(r.detail).toContain("Lancer les tests");
    expect(r.detail).toContain("Git : branche, commit");
    expect(r.detail).toContain("skraft-test : écrit dans @stack:unitTests ; outils run_tests");
    expect(r.detail).toContain("ratifier-adr : architecte");
  });

  it("« toujours » : l'accord est retenu pour cette empreinte, et survit à une nouvelle instance", async () => {
    const c = confirmeur("allow-always");
    expect(await verifierAccord({ workflow: wf(), accords: createJsonAccordStore(join(dir, "a.json")), confirmer: c })).toBe(true);
    const c2 = confirmeur("deny");
    expect(await verifierAccord({ workflow: wf(), accords: createJsonAccordStore(join(dir, "a.json")), confirmer: c2 })).toBe(true);
    expect(c2.demandes).toEqual([]);
  });

  it("dossier modifié (autre empreinte) : l'accord est redemandé", async () => {
    const accords = createJsonAccordStore(join(dir, "a.json"));
    await verifierAccord({ workflow: wf("sha256:aaa"), accords, confirmer: confirmeur("allow-always") });
    const c = confirmeur("allow-once");
    expect(await verifierAccord({ workflow: wf("sha256:bbb"), accords, confirmer: c })).toBe(true);
    expect(c.demandes).toHaveLength(1);
  });

  it("« une fois » : autorisé cette fois, redemandé la suivante ; « refuser » : rien ne démarre, rien n'est retenu", async () => {
    const accords = createJsonAccordStore(join(dir, "a.json"));
    expect(await verifierAccord({ workflow: wf(), accords, confirmer: confirmeur("allow-once") })).toBe(true);
    const c = confirmeur("deny");
    expect(await verifierAccord({ workflow: wf(), accords, confirmer: c })).toBe(false);
    expect(c.demandes).toHaveLength(1);
    expect(await accords.accorde("skraft", "sha256:aaa")).toBe(false);
  });
});

describe("gel du dossier pendant une tâche", () => {
  it("le script ne peut pas écrire dans un dossier de workflow, quelle que soit la casse", async () => {
    for (const chemin of [".agent-studio/workflows/skraft/portes/citations.mjs", ".Agent-Studio/Workflows/x.mjs"]) {
      const f = fauxContexte();
      const t = await lancer({ nom: "t", empreinte: "v1", script: async (w) => w.ecrireFichier(chemin, "affaibli") }, f.ctx);
      expect((await t.record()).state.fin).toMatchObject({ statut: "echec", motif: expect.stringMatching(/dossier d'un workflow/) });
      expect(f.appels).toEqual([]);
    }
  });

  it("dossier modifié entre deux reprises : la tâche refuse de reprendre et dit de la relancer", async () => {
    const def1 = createWorkflowTask({ nom: "t", empreinte: "sha256:avant", script: async (w) => w.lireFichier("a") });
    const def2 = createWorkflowTask({ nom: "t", empreinte: "sha256:apres", script: async (w) => w.lireFichier("a") });
    const s0 = await def1.initialState(null);
    const r = await def2.transition(s0, { type: "RESULTAT", n: 1, resultat: "x" });
    expect(r.state.fin).toMatchObject({ statut: "echec", motif: expect.stringMatching(/workflow a été modifié.*relance/i) });
  });
});
