import type { PermissionRequest } from "@github/copilot-sdk";
import type { ToolCallRequest } from "@agent-studio/core";

/**
 * Normalise une demande de permission du SDK. On s'appuie sur les sortes de permission
 * (stables) plutôt que sur les noms d'outils intégrés, qui varient selon la version du CLI (§15).
 */
export function toToolCallRequest(req: PermissionRequest): ToolCallRequest {
  switch (req.kind) {
    case "write":
      return { kind: "write", toolName: "write", path: req.resolvedPath ?? req.fileName };
    case "read":
      return { kind: "read", toolName: "read", path: req.resolvedPath ?? req.path };
    case "shell":
      return { kind: "shell", toolName: "shell", command: req.fullCommandText };
    case "url":
      return { kind: "url", toolName: "url", url: req.url };
    case "mcp":
      return { kind: "mcp", toolName: `${req.serverName}/${req.toolName}` };
    case "custom-tool":
      return { kind: "custom-tool", toolName: req.toolName };
    default:
      return { kind: "other", toolName: req.kind };
  }
}
