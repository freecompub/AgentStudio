/**
 * Contrat des données qu'un projet expose : cartes de tâche et demandes d'interaction. Partagé par
 * l'application de bureau (contrat IPC, `apps/desktop/src/shared/ipc-contract.ts`) et le serveur MCP
 * (ADR 0068). Uniquement des schémas zod : importable par le renderer sans rien de Node.
 */
import { z } from "zod";

export const roleSchema = z.enum(["testeur", "po", "developpeur", "architecte", "administrateur"]);

export const usageRowSchema = z.object({
  phase: z.string(),
  label: z.string(),
  requests: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  retries: z.number(),
  durationMs: z.number(),
});
export type UsageRowDto = z.infer<typeof usageRowSchema>;

export const taskCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  phase: z.string(),
  phaseLabel: z.string(),
  status: z.enum(["running", "waiting", "finished"]),
  alert: z.boolean(),
  milestone: z.boolean(),
  step: z.object({ index: z.number(), total: z.number(), behavior: z.string() }).optional(),
  feedback: z.string().optional(),
  /** Usage par état (D37), dans l'unité du fournisseur. */
  usage: z.object({ unit: z.enum(["requests", "tokens"]), rows: z.array(usageRowSchema), total: usageRowSchema }).optional(),
  updatedAt: z.string(),
});
export type TaskCardDto = z.infer<typeof taskCardSchema>;

export const interactionSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  extensionId: z.string(),
  title: z.string(),
  detail: z.string().optional(),
  options: z.array(z.object({ id: z.string(), label: z.string() })),
  requiredRoles: z.array(roleSchema).optional(),
  freeText: z.boolean().optional(),
  createdAt: z.string(),
});
export type InteractionDto = z.infer<typeof interactionSchema>;
