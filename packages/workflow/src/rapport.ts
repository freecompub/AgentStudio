/**
 * Rapport d'un run de workflow, tiré de son état persisté (ADR 0068, `skraft_rapport`) : rien n'est
 * relancé, rien n'est relu sur le disque du projet. Les messages sont ceux que le script a dits
 * (`w.informer`, dont son bilan final), une fois exécutés.
 */
import { relire } from "./contenus.js";
import type { Arbitrage, EtatWorkflow, Json } from "./protocols.js";

export type RapportWorkflow = (
  | { statut: "en-cours" }
  | { statut: "fini"; valeur: Json }
  | { statut: "echec"; motif: string }
  | { statut: "annule" }
) & {
  messages: string[];
  dernierRejet: { gate: string; reasons: string[] } | null;
  arbitrages: Arbitrage[];
};

export function rapportDuWorkflow(etat: EtatWorkflow): RapportWorkflow {
  const messages = etat.journal
    .filter((e) => e.appel === "informer" && e.resultat !== undefined)
    .map((e) => (relire(e.args, etat.contenus) as { texte: string }).texte);
  const commun = { messages, dernierRejet: etat.lastRejection ?? null, arbitrages: etat.arbitrages ?? [] };
  const f = etat.fin;
  if (!f) return { statut: "en-cours", ...commun };
  if (f.statut === "fini") return { statut: "fini", valeur: relire(f.valeur, etat.contenus), ...commun };
  if (f.statut === "echec") return { statut: "echec", motif: f.motif, ...commun };
  return { statut: "annule", ...commun };
}
