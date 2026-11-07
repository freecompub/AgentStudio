/**
 * Connexion au runtime Claude (ADR 0070) : lue par `claude auth status`. Le serveur ne peut pas
 * mener la connexion lui-même (elle est interactive) : il dit quoi taper. Le runtime n'est démarré
 * qu'une fois connecté.
 */
import type { AgentRuntime } from "@agent-studio/core";
import { describe, expect, it } from "vitest";
import { createConnexionClaude } from "../src/connexion-claude.js";

const statut = (s: unknown) => async () => s;

describe("Connexion à Claude (ADR 0070)", () => {
  it("connecté : rien à faire ; le runtime démarre une fois, au premier besoin", async () => {
    let demarrages = 0;
    const c = createConnexionClaude({ statut: statut({ loggedIn: true, authMethod: "claude.ai" }) });
    expect(await c.verifier()).toEqual({ ok: true });
    expect(await c.connecter()).toEqual({ ok: true, texte: "Déjà connecté à Claude (claude.ai)." });
    const runtime = c.runtime(() => ({ start: async () => void demarrages++ }) as unknown as AgentRuntime);
    await runtime();
    await runtime();
    expect(demarrages).toBe(1);
  });

  it("non connecté : les outils renvoient vers skraft_connexion, qui dit de lancer `claude auth login` ; pas de runtime", async () => {
    const c = createConnexionClaude({ statut: statut({ loggedIn: false }) });
    expect(await c.verifier()).toEqual({ ok: false, motif: expect.stringMatching(/Claude.*non connecté.*skraft_connexion/s) });
    expect(await c.connecter()).toEqual({ ok: false, texte: expect.stringContaining("claude auth login") });
    await expect(c.runtime(() => ({}) as AgentRuntime)()).rejects.toThrow(/skraft_connexion/);
  });

  it("CLI absent : dit de l'installer", async () => {
    const c = createConnexionClaude({ statut: async () => { throw Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }); } });
    expect(await c.verifier()).toEqual({ ok: false, motif: expect.stringMatching(/Claude Code \(claude\) introuvable/) });
  });
});
