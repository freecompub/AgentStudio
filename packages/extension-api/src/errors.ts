/**
 * Erreurs et utilitaires qu'une extension peut employer sans dépendre du cœur (D10).
 *
 * Ces classes sont définies ici, et non dans `@agent-studio/core`, parce qu'une extension
 * tierce ne doit connaître que `@agent-studio/extension-api`. Le cœur les réexporte.
 *
 * Elles franchissent la frontière de processus **par leur nom** : l'hôte sérialise l'erreur et
 * la reconstruit d'après `name` (`rpc/endpoint.ts`). Ce nom fait donc partie du contrat et ne
 * doit pas changer.
 */

/**
 * Défaut de travail de l'agent (silence, sortie structurée absente…) : réessai ciblé
 * si le budget le permet, jamais d'escalade immédiate (D24, D25).
 */
export class WorkDefectError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkDefectError";
  }
}

/** Silence de l'agent au-delà du seuil : traité comme un rejet par le réducteur (§6.2). */
export class TurnTimeoutError extends WorkDefectError {
  constructor(readonly idleMs: number) {
    super(`Aucune activité de l'agent depuis ${Math.round(idleMs / 1000)} s`);
    this.name = "TurnTimeoutError";
  }
}

/**
 * Plafond de durée du tour atteint (ADR 0026) : l'agent **travaillait**, mais trop longtemps.
 *
 * Distinct de `TurnTimeoutError`, qui dit l'inverse — l'agent s'est tu. La distinction compte pour
 * l'humain qui lit le motif : « il ne répond plus » et « il n'en finissait pas » n'appellent pas
 * la même correction.
 */
export class TurnBudgetError extends WorkDefectError {
  constructor(
    readonly maxMs: number,
    readonly elapsedMs: number,
  ) {
    super(`Le tour a dépassé son plafond de ${Math.round(maxMs / 60_000)} min (écoulé : ${Math.round(elapsedMs / 60_000)} min)`);
    this.name = "TurnBudgetError";
  }
}

/** Défaut d'environnement (runtime, quota, API) : escalade immédiate (D25). */
export class EnvFailureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EnvFailureError";
  }
}
