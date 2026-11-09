/**
 * Confirmation par le client MCP (ADR 0075) : le serveur n'a pas de fenêtre, mais le client peut poser
 * une question à l'utilisateur pour lui (elicitation). La réponse vient de l'utilisateur, jamais du LLM
 * de l'hôte. Un client qui ne l'annonce pas, une question refusée, annulée ou en erreur : « non ».
 */
import { describe, expect, it } from "vitest";
import { confirmerParLeClient, type ClientQuiDemande } from "../src/confirmation.js";

function client(capacites: Record<string, unknown> | undefined, reponse: () => Promise<{ action: string; content?: Record<string, unknown> }>) {
  const demandes: { message: string; requestedSchema: unknown }[] = [];
  const c: ClientQuiDemande = {
    getClientCapabilities: () => capacites,
    elicitInput: async (p) => {
      demandes.push(p as { message: string; requestedSchema: unknown });
      return (await reponse()) as never;
    },
  };
  return { c, demandes };
}

const QUESTION = { title: "Ouvrir ce dépôt ?", detail: "skraft y écrira." };
const accepte = (reponse: string) => async () => ({ action: "accept", content: { reponse } });

describe("confirmerParLeClient", () => {
  it("le client annonce l'elicitation : la question est posée, titre et détail, avec trois réponses", async () => {
    const { c, demandes } = client({ elicitation: {} }, accepte("Oui, cette fois"));
    const conf = confirmerParLeClient(c);
    expect(conf.peutDemander()).toBe(true);
    expect(await conf.confirm(QUESTION)).toBe("allow-once");
    expect(demandes).toEqual([
      {
        message: "Ouvrir ce dépôt ?\n\nskraft y écrira.",
        requestedSchema: { type: "object", properties: { reponse: { type: "string", title: "Réponse", enum: ["Oui, cette fois", "Oui, toujours", "Non"] } }, required: ["reponse"] },
      },
    ]);
  });

  it("« Oui, toujours » et « Non »", async () => {
    expect(await confirmerParLeClient(client({ elicitation: {} }, accepte("Oui, toujours")).c).confirm(QUESTION)).toBe("allow-always");
    expect(await confirmerParLeClient(client({ elicitation: {} }, accepte("Non")).c).confirm(QUESTION)).toBe("deny");
  });

  it("refusée, annulée, réponse inconnue ou erreur : « non »", async () => {
    expect(await confirmerParLeClient(client({ elicitation: {} }, async () => ({ action: "decline" })).c).confirm(QUESTION)).toBe("deny");
    expect(await confirmerParLeClient(client({ elicitation: {} }, async () => ({ action: "cancel" })).c).confirm(QUESTION)).toBe("deny");
    expect(await confirmerParLeClient(client({ elicitation: {} }, accepte("peut-être")).c).confirm(QUESTION)).toBe("deny");
    // Une réponse qui tombe sur une propriété héritée de l'objet n'est pas une réponse.
    expect(await confirmerParLeClient(client({ elicitation: {} }, accepte("constructor")).c).confirm(QUESTION)).toBe("deny");
    expect(await confirmerParLeClient(client({ elicitation: {} }, async () => { throw new Error("délai"); }).c).confirm(QUESTION)).toBe("deny");
  });

  it("le client n'annonce pas l'elicitation (ou seulement par adresse web) : rien n'est demandé, « non »", async () => {
    for (const capacites of [undefined, {}, { roots: {} }, { elicitation: { url: {} } }]) {
      const { c, demandes } = client(capacites, accepte("Oui, toujours"));
      const conf = confirmerParLeClient(c);
      expect(conf.peutDemander()).toBe(false);
      expect(await conf.confirm(QUESTION)).toBe("deny");
      expect(demandes).toEqual([]);
    }
    // Un formulaire annoncé explicitement, avec ou sans adresse web, suffit.
    expect(confirmerParLeClient(client({ elicitation: { form: {}, url: {} } }, accepte("Non")).c).peutDemander()).toBe(true);
  });
});
