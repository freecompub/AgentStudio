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

/** Défaut d'environnement (runtime, quota, API) : escalade immédiate (D25). */
export class EnvFailureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EnvFailureError";
  }
}
