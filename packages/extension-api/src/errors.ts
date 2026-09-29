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

/**
 * Plafond de **coût** du tour atteint (ADR 0027) : le cumul des tokens d'entrée facturés.
 *
 * Chaque appel au modèle renvoie tout le contexte, donc le paie à nouveau : un tour de N appels
 * coûte en O(N²). Le cumul ne décroît jamais — c'est ce qui a été payé, pas ce qui tient en
 * mémoire. Distincte de `TurnBudgetError` : un tour peut être bref et ruineux, ou long et sobre.
 */
export class TurnCostError extends WorkDefectError {
  constructor(
    readonly maxInputTokens: number,
    readonly inputTokens: number,
  ) {
    super(`Le tour a dépassé son plafond de ${Math.round(maxInputTokens / 1000)} k tokens d'entrée (cumul : ${Math.round(inputTokens / 1000)} k)`);
    this.name = "TurnCostError";
  }
}

/**
 * La fenêtre de contexte du modèle est pleine (ADR 0031).
 *
 * Mesure rendue par le runtime, pas calculée par nous : `currentTokens` dit ce qui **occupe** la
 * fenêtre à l'instant présent — et décroît quand le runtime compacte —, là où le cumul des
 * `usage` compte ce qui a **transité** et ne décroît jamais. C'est la seule des deux qui dise si
 * l'agent est près de ne plus pouvoir travailler.
 */
export class TurnContextError extends WorkDefectError {
  constructor(
    readonly currentTokens: number,
    readonly tokenLimit: number,
    readonly fraction: number,
  ) {
    super(
      `La fenêtre de contexte est occupée à ${Math.round((currentTokens / tokenLimit) * 100)} % (${Math.round(currentTokens / 1000)} k sur ${Math.round(tokenLimit / 1000)} k), au-delà du seuil de ${Math.round(fraction * 100)} %`,
    );
    this.name = "TurnContextError";
  }
}

/** Défaut d'environnement (runtime, quota, API) : escalade immédiate (D25). */
export class EnvFailureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EnvFailureError";
  }
}
