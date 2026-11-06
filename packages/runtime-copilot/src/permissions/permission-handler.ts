import type { PermissionHandler, PermissionRequestResult } from "@github/copilot-sdk";
import { DELAI_GARDE_MS, decideSafely, type GuardDecision, type ToolCallGuard, type ToolCallRequest } from "@agent-studio/core";
import { toToolCallRequest } from "./to-tool-call-request.js";

export interface PermissionHandlerOptions {
  /** Délai maximal de décision ; au-delà, refus (D28). Défaut : 5 min (confirmation humaine possible). */
  timeoutMs?: number;
  onDenied?: (req: ToolCallRequest, reason: string) => void;
  /**
   * **Tout** appel soumis à permission, autorisé comme refusé (ADR 0032).
   *
   * La garde est le seul endroit qui sache ce qu'un agent lit, écrit ou exécute : les résultats des
   * outils intégrés du CLI ne nous parviennent pas, seul `tool-end` nous dit qu'ils ont réussi. Ne
   * rendre que les refus, comme avant, laissait deviner ce qu'un agent avait fait de ses vingt-six
   * appels — et rendait un run indiagnosticable.
   */
  onDecision?: (req: ToolCallRequest, decision: GuardDecision) => void;
}

/**
 * L'unique `onPermissionRequest` d'une session (D27) : délègue à la garde du cœur et
 * transforme toute exception ou tout dépassement de délai en refus (D28).
 */
export function createPermissionHandler(guard: ToolCallGuard, opts: PermissionHandlerOptions = {}): PermissionHandler {
  const timeoutMs = opts.timeoutMs ?? DELAI_GARDE_MS;
  return async (request): Promise<PermissionRequestResult> => {
    const call = toToolCallRequest(request);
    const decision = await decideSafely(guard, call, timeoutMs);
    opts.onDecision?.(call, decision);
    if (decision.decision === "allow") return { kind: "approve-once" };
    opts.onDenied?.(call, decision.reason);
    return { kind: "reject", feedback: decision.reason };
  };
}
