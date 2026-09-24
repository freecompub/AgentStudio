import type { GuardDecision, ToolCallGuard } from "../protocols/agent-runtime.js";

/**
 * Chaîne de gardes (D27, D28) : exécution en série dans l'ordre donné (gardes du cœur d'abord),
 * le premier refus l'emporte, délai maximal par garde, et refus si une garde plante ou expire.
 */
export function composeGuards(guards: readonly ToolCallGuard[], opts: { timeoutMs?: number } = {}): ToolCallGuard {
  const timeoutMs = opts.timeoutMs ?? 2_000;
  return {
    async check(req) {
      for (const [i, g] of guards.entries()) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const expired = new Promise<GuardDecision>((resolve) => {
          timer = setTimeout(() => resolve({ decision: "deny", reason: `Garde n°${i + 1} indisponible (délai dépassé) : action refusée par précaution.` }), timeoutMs);
        });
        let d: GuardDecision;
        try {
          d = await Promise.race([g.check(req), expired]);
        } catch {
          d = { decision: "deny", reason: `Garde n°${i + 1} indisponible (erreur) : action refusée par précaution.` };
        } finally {
          clearTimeout(timer);
        }
        if (d.decision === "deny") return d;
      }
      return { decision: "allow" };
    },
  };
}
