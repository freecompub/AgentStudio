import type { Phase, Role } from "./model.js";

/**
 * Configuration unique du pipeline (défaut C3 rendu impossible) : l'ordre des phases n'existe
 * qu'ici ; l'état est initialisé sur `PHASE_ORDER[0]` à la première route.
 */
export const PHASE_ORDER: Phase[] = ["RESEARCH", "DESIGN", "DISTILL", "DELIVER"];

/** Phases revues par des lentilles ; RESEARCH est vérifiée par une porte, sans reviewer (§7.1). */
export const REVIEWED_PHASES: Phase[] = ["DESIGN", "DISTILL", "DELIVER"];

/** Rôle spécialiste d'une phase (DESIGN : modélisation puis décisions, §7.2). */
export function specialistRole(phase: Phase, designStep: "model" | "decide"): Role {
  switch (phase) {
    case "RESEARCH":
      return "skraft-researcher";
    case "DESIGN":
      return designStep === "model" ? "skraft-architect-model" : "skraft-architect-decide";
    case "DISTILL":
      return "skraft-acceptance";
    case "DELIVER":
      return "skraft-dev";
  }
}

/** Message de commit d'une phase (§5.2, COMMIT). */
export function commitMessage(phase: Phase, slug: string): string {
  return phase === "DELIVER" ? `feat(${slug}): livraison de la story` : `docs(skraft): ${phase.toLowerCase()} de ${slug}`;
}
