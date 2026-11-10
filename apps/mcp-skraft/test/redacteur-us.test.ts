/**
 * L'agent qui met en forme une US GitHub en story (ADR 0078), joué par un runtime scripté : il n'écrit
 * que le fichier de la story, reçoit le contexte et, après un refus, les motifs. Le code vérifie ensuite
 * la story (us-github.ts) : l'agent propose, le code juge.
 */
import { createTaskAgentRunner } from "@agent-studio/core";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import type { UsGithub } from "@agent-studio/github-auth";
import { describe, expect, it } from "vitest";
import { createMiseEnFormeParAgent, PROMPT_REDACTEUR_US, ROLE_REDACTEUR_US } from "../src/redacteur-us.js";

const US = { ref: { hostname: "github.com", owner: "org", repo: "app", numero: 12 }, issue: { numero: 12, titre: "Payer", etat: "open", url: "u", corps: "", labels: [] }, commentaires: [], sousIssues: [], bloqueePar: [], bloque: [], citees: [], lacunes: [] } as UsGithub;
const ENTREE = { us: US, contexte: "# Contexte GitHub de org/app#12 — Payer\n\nPlafond : 500 €.", chemin: ".skraft/github/US-12.md", identifiant: "US-12" };

describe("createMiseEnFormeParAgent", () => {
  it("l'agent reçoit le contexte, l'identifiant et le fichier à écrire ; il n'a le droit d'écrire que lui", async () => {
    let prompt = "";
    const runtime = new ScriptedRuntime().behave(ROLE_REDACTEUR_US, async (t) => {
      prompt = t.prompt;
      await t.callTool("report_phase", { summary: "story écrite", files: [".skraft/github/US-12.md"] });
    });
    const agents = createTaskAgentRunner({ runtime, root: "/projets/app", idleMs: 60_000 });
    expect(await createMiseEnFormeParAgent({ agents: async () => agents, modele: async () => "m" })(ENTREE)).toEqual({ ok: true });
    expect(prompt).toContain("Plafond : 500 €.");
    expect(prompt).toContain("`.skraft/github/US-12.md`");
    expect(prompt).toContain("# US-12 — ");
    const cfg = [...runtime.configs.values()][0]!;
    expect(cfg.model).toBe("m");
    expect((await cfg.guard.check({ kind: "write", toolName: "write", path: "/projets/app/.skraft/github/US-12.md" })).decision).toBe("allow");
    expect((await cfg.guard.check({ kind: "write", toolName: "write", path: "/projets/app/src/a.ts" })).decision).toBe("deny");
  });

  it("après un refus, les motifs sont dans la demande", async () => {
    let prompt = "";
    const runtime = new ScriptedRuntime().behave(ROLE_REDACTEUR_US, async (t) => {
      prompt = t.prompt;
      await t.callTool("report_phase", { summary: "corrigé", files: [] });
    });
    const agents = createTaskAgentRunner({ runtime, root: "/projets/app", idleMs: 60_000 });
    await createMiseEnFormeParAgent({ agents: async () => agents })({ ...ENTREE, precedent: { motifs: ["Critère 1 : « 750 » ne vient ni de l'issue…"] } });
    expect(prompt).toMatch(/refusée[\s\S]*« 750 »/);
  });

  it("un runtime en échec : une erreur rendue, pas une exception", async () => {
    const runtime = new ScriptedRuntime();
    runtime.openSession = async () => {
      throw new Error("Non connecté à GitHub.");
    };
    const agents = createTaskAgentRunner({ runtime, root: "/p", idleMs: 1_000 });
    expect(await createMiseEnFormeParAgent({ agents: async () => agents })(ENTREE)).toEqual({ erreur: expect.stringContaining("Non connecté") });
  });

  it("le prompt ne nomme aucun langage, et laisse les doutes aux questions ouvertes", () => {
    expect(PROMPT_REDACTEUR_US).toMatch(/Questions ouvertes/);
    expect(PROMPT_REDACTEUR_US).toMatch(/Critères d'acceptation/);
    expect(PROMPT_REDACTEUR_US).not.toMatch(/\b(python|typescript|java|dotnet|C#)\b/i);
  });
});
