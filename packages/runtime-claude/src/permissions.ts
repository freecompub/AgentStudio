/**
 * Demandes de permission de `claude -p`, reçues par notre outil MCP (ADR 0070), normalisées comme
 * celles de Copilot : la garde (`ToolCallGuard`) ne voit que des sortes et des chemins.
 */
import type { GuardDecision, ToolCallRequest } from "@agent-studio/core";

const ECRITURE = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const LECTURE = new Set(["Read", "Glob", "Grep", "LS"]);

export function versDemande(outil: string, entree: unknown): ToolCallRequest {
  const e = (entree && typeof entree === "object" ? entree : {}) as Record<string, unknown>;
  const texte = (k: string) => (typeof e[k] === "string" ? (e[k] as string) : undefined);
  if (ECRITURE.has(outil)) return { kind: "write", toolName: outil, ...withPath(texte("file_path") ?? texte("notebook_path")), args: entree };
  if (LECTURE.has(outil)) return { kind: "read", toolName: outil, ...withPath(texte("file_path") ?? texte("path")), args: entree };
  if (outil === "Bash") return { kind: "shell", toolName: outil, ...(texte("command") !== undefined ? { command: texte("command")! } : {}), args: entree };
  if (outil === "WebFetch" || outil === "WebSearch") return { kind: "url", toolName: outil, ...(texte("url") !== undefined ? { url: texte("url")! } : {}), args: entree };
  if (outil.startsWith("mcp__")) return { kind: "mcp", toolName: outil, args: entree };
  return { kind: "other", toolName: outil, args: entree };
}

const withPath = (p: string | undefined) => (p !== undefined ? { path: p } : {});

/** Réponse attendue par le CLI : accord avec l'entrée inchangée, ou refus avec la raison. */
export function reponsePermission(d: GuardDecision, entree: unknown): string {
  return JSON.stringify(d.decision === "allow" ? { behavior: "allow", updatedInput: entree ?? {} } : { behavior: "deny", message: d.reason });
}
