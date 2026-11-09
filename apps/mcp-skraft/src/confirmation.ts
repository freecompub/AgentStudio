/**
 * Confirmation par le client MCP (ADR 0075). Le serveur n'a pas de fenêtre ; le client peut poser une
 * question à l'utilisateur pour lui (elicitation), et la réponse vient de l'utilisateur, pas du LLM de
 * l'hôte. On ne suppose rien du client : il dit au démarrage s'il sait le faire. S'il ne le dit pas,
 * ou si la question n'aboutit pas, la réponse est « non » — le refus explique alors quoi corriger.
 */
import type { ConfirmAnswer, UserConfirmer } from "@agent-studio/core";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

export type ClientQuiDemande = Pick<Server, "getClientCapabilities" | "elicitInput">;

const REPONSES: Record<string, ConfirmAnswer> = { "Oui, cette fois": "allow-once", "Oui, toujours": "allow-always", Non: "deny" };

/** L'utilisateur peut mettre du temps à lire : le délai par défaut d'une requête (60 s) le couperait. */
const DELAI_MS = 10 * 60_000;

export function confirmerParLeClient(client: ClientQuiDemande): UserConfirmer & { peutDemander(): boolean } {
  const peutDemander = () => {
    const e = client.getClientCapabilities()?.elicitation as { form?: unknown; url?: unknown } | undefined;
    // Une capacité vide vaut formulaire (anciennes versions du protocole) ; l'adresse web seule ne suffit pas.
    return e !== undefined && (e.form !== undefined || e.url === undefined);
  };
  return {
    peutDemander,
    async confirm(req) {
      if (!peutDemander()) return "deny";
      try {
        const r = await client.elicitInput(
          {
            message: `${req.title}\n\n${req.detail}`,
            requestedSchema: { type: "object", properties: { reponse: { type: "string", title: "Réponse", enum: Object.keys(REPONSES) } }, required: ["reponse"] },
          },
          { timeout: DELAI_MS },
        );
        const reponse = r.action === "accept" ? r.content?.["reponse"] : undefined;
        return typeof reponse === "string" && Object.hasOwn(REPONSES, reponse) ? REPONSES[reponse]! : "deny";
      } catch {
        return "deny";
      }
    },
  };
}
