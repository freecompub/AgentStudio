/**
 * État de la connexion à Claude (ADR 0070), lu par `claude auth status` ; partagé par le serveur MCP
 * et l'application, qui disent chacun quoi faire avec leurs propres mots. La connexion est
 * interactive (navigateur) : ni l'un ni l'autre ne la mène.
 */
import { describe, expect, it } from "vitest";
import { etatConnexionClaude, MODELES_CLAUDE } from "../src/connexion.js";

const statut = (s: unknown) => ({ statut: async () => s });

describe("État de la connexion à Claude", () => {
  it("connecté, avec sa méthode ; non connecté", async () => {
    expect(await etatConnexionClaude(statut({ loggedIn: true, authMethod: "claude.ai" }))).toEqual({ etat: "connecte", methode: "claude.ai" });
    expect(await etatConnexionClaude(statut({ loggedIn: true }))).toEqual({ etat: "connecte" });
    expect(await etatConnexionClaude(statut({ loggedIn: false }))).toEqual({ etat: "non-connecte" });
  });

  it("CLI absent : à installer ; statut illisible : non connecté", async () => {
    expect(await etatConnexionClaude({ statut: async () => { throw Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }); } })).toEqual({ etat: "absent" });
    expect(await etatConnexionClaude({ statut: async () => { throw new SyntaxError("JSON"); } })).toEqual({ etat: "non-connecte" });
    expect(await etatConnexionClaude(statut(null))).toEqual({ etat: "non-connecte" });
  });

  it("modèles par défaut des classes de rôle (ADR 0048) : le plus capable pour concevoir, le plus léger pour classer", () => {
    expect(MODELES_CLAUDE).toEqual({ strong: "opus", standard: "sonnet", light: "haiku" });
  });
});
