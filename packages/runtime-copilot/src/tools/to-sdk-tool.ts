import { defineTool, type Tool } from "@github/copilot-sdk";
import type { ToolSpec } from "@agent-studio/core";

/**
 * Nos outils sont exécutés par notre code : ils ne passent pas par l'invite de permission
 * du runtime (leur contrôle est dans leur handler). Un outil terminal clôt le tour (D18).
 */
export function toSdkTool(spec: ToolSpec): Tool {
  return defineTool(spec.name, {
    description: spec.description,
    parameters: spec.parameters,
    skipPermission: true,
    ...(spec.terminal ? { isTerminal: true } : {}),
    handler: (args: unknown) => spec.handler(args),
  });
}
