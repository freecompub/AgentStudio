import type { EtatWorkflow } from "@agent-studio/workflow";
import { relire } from "../../packages/workflow/src/contenus.js";

export function workflowLivre(etat: EtatWorkflow | undefined): boolean {
  if (etat?.fin?.statut !== "fini") return false;
  const resultat = relire(etat.fin.valeur, etat.contenus);
  if (!resultat || typeof resultat !== "object" || Array.isArray(resultat)) return false;
  return Array.isArray(resultat.phases) && resultat.phases.includes("DELIVER");
}
