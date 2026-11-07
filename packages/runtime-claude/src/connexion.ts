/**
 * État de la connexion à Claude (ADR 0070), lu par `claude auth status`. Partagé par le serveur MCP
 * et l'application ; chacun dit quoi faire avec ses mots. La connexion est interactive : personne
 * ici ne la mène. Aucun secret ne passe par ici.
 */
import type { LanceurClaude } from "./protocols.js";

/** Modèle par défaut de chaque classe de rôle (ADR 0048) avec Claude. */
export const MODELES_CLAUDE = { strong: "opus", standard: "sonnet", light: "haiku" } as const;

export type EtatConnexionClaude = { etat: "connecte"; methode?: string } | { etat: "non-connecte" } | { etat: "absent" };

export async function etatConnexionClaude(lanceur: Pick<LanceurClaude, "statut">): Promise<EtatConnexionClaude> {
  try {
    const s = (await lanceur.statut()) as { loggedIn?: unknown; authMethod?: unknown } | null;
    if (s?.loggedIn !== true) return { etat: "non-connecte" };
    return { etat: "connecte", ...(typeof s.authMethod === "string" ? { methode: s.authMethod } : {}) };
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? { etat: "absent" } : { etat: "non-connecte" };
  }
}
