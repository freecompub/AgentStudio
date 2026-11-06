import type { GuardDecision, ToolCallGuard, ToolCallRequest } from "../protocols/agent-runtime.js";

/** Délai par défaut d'une décision de garde : une confirmation humaine reste possible (D28). */
export const DELAI_GARDE_MS = 5 * 60_000;

/**
 * Décision de la garde, transformée en refus si elle lève ou dépasse son délai (D28). Commune à tous
 * les adaptateurs de runtime : une garde qui plante ne laisse jamais passer une action.
 */
export async function decideSafely(guard: ToolCallGuard, call: ToolCallRequest, timeoutMs = DELAI_GARDE_MS): Promise<GuardDecision> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<GuardDecision>((resolve) => {
    timer = setTimeout(
      () => resolve({ decision: "deny", reason: "Garde indisponible (délai dépassé) : action refusée par précaution." }),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([guard.check(call), timeout]);
  } catch {
    return { decision: "deny", reason: "Garde indisponible (erreur) : action refusée par précaution." };
  } finally {
    clearTimeout(timer);
  }
}
