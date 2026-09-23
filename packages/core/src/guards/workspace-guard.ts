import type { ToolCallGuard } from "../protocols/agent-runtime.js";
import type { UserConfirmer } from "../protocols/interaction.js";
import { createMemoryPermissionRules, createPermissionArbiter } from "./permission-arbiter.js";

export interface WorkspaceGuardDeps {
  root: string;
  confirmer: UserConfirmer;
}

/**
 * Garde de la session principale sans extension ni règle mémorisée : l'arbitre réduit à la
 * politique du cœur et à la question à l'écran (voir `createPermissionArbiter`).
 */
export function createWorkspaceGuard(deps: WorkspaceGuardDeps): ToolCallGuard {
  return createPermissionArbiter({ ...deps, rules: createMemoryPermissionRules(), extensionGuards: () => [] });
}
