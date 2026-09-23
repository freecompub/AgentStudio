import type { PermissionHandler, PermissionRequestResult } from "@github/copilot-sdk";
import type { GuardDecision, ToolCallGuard, ToolCallRequest } from "@agent-studio/core";
import { toToolCallRequest } from "./to-tool-call-request.js";

export interface PermissionHandlerOptions {
  /** Délai maximal de décision ; au-delà, refus (D28). Défaut : 5 min (confirmation humaine possible). */
  timeoutMs?: number;
  onDenied?: (req: ToolCallRequest, reason: string) => void;
}

/**
 * L'unique `onPermissionRequest` d'une session (D27) : délègue à la garde du cœur et
 * transforme toute exception ou tout dépassement de délai en refus (D28).
 */
export function createPermissionHandler(guard: ToolCallGuard, opts: PermissionHandlerOptions = {}): PermissionHandler {
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  return async (request): Promise<PermissionRequestResult> => {
    const call = toToolCallRequest(request);
    const decision = await decideSafely(guard, call, timeoutMs);
    if (decision.decision === "allow") return { kind: "approve-once" };
    opts.onDenied?.(call, decision.reason);
    return { kind: "reject", feedback: decision.reason };
  };
}

async function decideSafely(guard: ToolCallGuard, call: ToolCallRequest, timeoutMs: number): Promise<GuardDecision> {
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
