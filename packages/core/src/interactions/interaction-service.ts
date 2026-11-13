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
  freeText?: boolean;
}

export interface InteractionService {
  request(req: NewInteraction): Promise<string>;
  /** Quiconque peut répondre : aucune demande n'est réservée à un profil (ADR 0087). */
  respond(id: string, option: string, comment?: string): Promise<void>;
  pending(): Promise<InteractionRequest[]>;
  cancelForTask(taskId: string): Promise<void>;
  onChange(cb: (pending: InteractionRequest[]) => void): () => void;
}

/** Demandes d'interaction : jamais d'attente bloquante sur l'humain (D31). */
export function createInteractionService(deps: InteractionServiceDeps): InteractionService {
  const listeners = new Set<(p: InteractionRequest[]) => void>();
  /** Réponses en cours de traitement, pour exclure deux réponses simultanées à la même demande. */
  const enCours = new Set<string>();

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
        ...(req.freeText ? { freeText: true } : {}),
      };
      await deps.store.save(record);
      await notify();
      return record.id;
    },

    async respond(id, option, comment) {
      // Deux réponses simultanées liraient toutes deux « pending » avant que l'une n'écrive :
      // l'état du disque ne les départage pas. Ce verrou le fait — le service vit dans le seul
      // processus principal, qui est aussi le seul à écrire.
      if (enCours.has(id)) throw new Error("Cette demande a déjà été traitée");
      enCours.add(id);
      try {
        await repondre(id, option, comment);
      } finally {
        enCours.delete(id);
      }
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

  async function repondre(id: string, option: string, comment: string | undefined): Promise<void> {
      const req = (await deps.store.list()).find((r) => r.id === id);
      if (!req) throw new Error(`Demande introuvable : ${id}`);
      if (req.status !== "pending") throw new Error("Cette demande a déjà été traitée");
      if (!req.options.some((o) => o.id === option)) throw new Error(`Option non autorisée : ${option}`);
      // La demande est marquée répondue **avant** la livraison : deux réponses concurrentes
      // (double clic, renvoi du renderer) verraient sinon toutes deux « pending » et
      // injecteraient deux fois la décision dans la tâche.
      await deps.store.save({
        ...req,
        status: "answered",
        answer: { option, answeredAt: deps.clock.now().toISOString(), ...(comment ? { comment } : {}) },
      });
      try {
        await deps.deliver(req.taskId, option, comment);
      } catch (err) {
        // Livraison impossible : la demande redevient répondable plutôt que de rester
        // répondue sans effet.
        await deps.store.save(req);
        await notify();
        throw err;
      }
      await notify();
  }
}
