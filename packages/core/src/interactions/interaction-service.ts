import type { Clock, IdGenerator } from "../protocols/conversation.js";
import type { InteractionOption, InteractionRequest, InteractionStore } from "../protocols/interactions.js";

export interface InteractionServiceDeps {
  store: InteractionStore;
  clock: Clock;
  ids: IdGenerator;
  /** Livre la décision à la tâche (moteur : `HUMAN_DECISION`). */
  deliver(taskId: string, option: string, comment?: string): Promise<void>;
}

export interface NewInteraction {
  taskId: string;
  extensionId: string;
  title: string;
  detail?: string;
  options: InteractionOption[];
}

export interface InteractionService {
  request(req: NewInteraction): Promise<string>;
  respond(id: string, option: string, comment?: string): Promise<void>;
  pending(): Promise<InteractionRequest[]>;
  cancelForTask(taskId: string): Promise<void>;
  onChange(cb: (pending: InteractionRequest[]) => void): () => void;
}

/** Demandes d'interaction : jamais d'attente bloquante sur l'humain (D31). */
export function createInteractionService(deps: InteractionServiceDeps): InteractionService {
  const listeners = new Set<(p: InteractionRequest[]) => void>();

  async function pending(): Promise<InteractionRequest[]> {
    return (await deps.store.list()).filter((r) => r.status === "pending").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async function notify(): Promise<void> {
    const p = await pending();
    for (const l of [...listeners]) l(p);
  }

  return {
    pending,

    async request(req) {
      const record: InteractionRequest = {
        id: deps.ids.next(),
        kind: "decision",
        status: "pending",
        createdAt: deps.clock.now().toISOString(),
        taskId: req.taskId,
        extensionId: req.extensionId,
        title: req.title,
        options: req.options,
        ...(req.detail ? { detail: req.detail } : {}),
      };
      await deps.store.save(record);
      await notify();
      return record.id;
    },

    async respond(id, option, comment) {
      const req = (await deps.store.list()).find((r) => r.id === id);
      if (!req) throw new Error(`Demande introuvable : ${id}`);
      if (req.status !== "pending") throw new Error("Cette demande a déjà été traitée");
      if (!req.options.some((o) => o.id === option)) throw new Error(`Option non autorisée : ${option}`);
      await deps.deliver(req.taskId, option, comment);
      await deps.store.save({
        ...req,
        status: "answered",
        answer: { option, answeredAt: deps.clock.now().toISOString(), ...(comment ? { comment } : {}) },
      });
      await notify();
    },

    async cancelForTask(taskId) {
      for (const r of await pending()) if (r.taskId === taskId) await deps.store.save({ ...r, status: "cancelled" });
      await notify();
    },

    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
