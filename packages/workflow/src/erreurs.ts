/**
 * Erreurs que le script voit. Elles sont journalisées par leur nature et relevées sous la même
 * classe à chaque rejeu : un `catch` du script se comporte pareil au premier passage et au rejeu.
 */

/** Tour d'agent coupé (silence, plafond de durée ou de coût) : un rejet, pas une panne (D24). */
export class TourInterrompu extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TourInterrompu";
  }
}

/** Panne d'environnement (modèle injoignable, quota…) : escalade immédiate, sans budget (D25). */
export class PanneEnvironnement extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PanneEnvironnement";
  }
}

/** Levée par `w.echec` : la tâche se termine en échec avec ce motif. */
export class EchecWorkflow extends Error {
  constructor(readonly motif: string) {
    super(motif);
    this.name = "EchecWorkflow";
  }
}

/** Levée par `essayer` quand le budget est épuisé ; `w.phase` la transforme en question à l'humain. */
export class Escalade extends Error {
  constructor(readonly motifs: readonly string[]) {
    super(motifs.join(" ; ") || "budget d'essais épuisé");
    this.name = "Escalade";
  }
}
