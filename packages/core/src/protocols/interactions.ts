import type { Role } from "./profile.js";

/**
 * Demandes d'interaction persistées (§7.1, D31) : décisions longues sans attente bloquante.
 * La réponse est validée puis injectée dans la tâche comme `HUMAN_DECISION`.
 */
export interface InteractionOption {
  id: string;
  label: string;
}

export interface InteractionRequest {
  id: string;
  taskId: string;
  extensionId: string;
  kind: "decision";
  title: string;
  detail?: string;
  options: InteractionOption[];
  /** Profils autorisés à répondre (ex. seul un architecte ratifie un ADR, §10.3) ; absent = tous. */
  requiredRoles?: Role[];
  createdAt: string;
  status: "pending" | "answered" | "cancelled";
  answer?: { option: string; comment?: string; answeredAt: string };
}

export interface InteractionStore {
  save(req: InteractionRequest): Promise<void>;
  list(): Promise<InteractionRequest[]>;
}
