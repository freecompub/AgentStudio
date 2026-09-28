import type { AgentEvent, AgentRuntime, AgentSession, ToolCallGuard, ToolSpec } from "../protocols/agent-runtime.js";
import type {
  ChatMessage,
  Clock,
  ConversationRecord,
  ConversationStore,
  IdGenerator,
  TurnCheckpoints,
} from "../protocols/conversation.js";
import { EnvFailureError, runTurn, TurnBudgetError, TurnContextError, TurnCostError, TurnTimeoutError } from "../turns/run-turn.js";

export interface MainSessionDeps {
  runtime: AgentRuntime;
  store: ConversationStore;
  checkpoints: TurnCheckpoints;
  workspaceRoot: string;
  systemPrompt: string;
  guard: ToolCallGuard;
  clock: Clock;
  ids: IdGenerator;
  tools?: ToolSpec[];
  model?: string;
  /** Seuil d'inactivité du watchdog (D30). */
  idleMs?: number;
  /** Plafond de durée totale d'un tour (ADR 0026). */
  maxMs?: number;
  /** Plafond du cumul des tokens d'entrée d'un tour (ADR 0027, désactivé par défaut depuis 0031). */
  maxInputTokens?: number;
  /** Fraction de la fenêtre de contexte au-delà de laquelle le tour est coupé (ADR 0031). */
  maxContextFraction?: number;
}

export type MainSessionEvent =
  | { type: "messages"; messages: ChatMessage[] }
  | { type: "agent"; event: AgentEvent }
  | { type: "busy"; busy: boolean };

/** Conversation visible par l'utilisateur, persistante et reprise au lancement. */
export interface MainSession {
  readonly busy: boolean;
  start(): Promise<ChatMessage[]>;
  send(text: string): Promise<void>;
  /** Annule le tour `messageId` et tous les suivants : restaure le checkpoint pris avant lui. */
  undo(messageId: string): Promise<void>;
  abort(): Promise<void>;
  /** Consigne un message sans tour d'agent (commande d'extension, message d'extension). */
  record(role: "user" | "notice", text: string, origin?: string): Promise<void>;
  messages(): ChatMessage[];
  onEvent(cb: (e: MainSessionEvent) => void): () => void;
  close(): Promise<void>;
}

export function createMainSession(deps: MainSessionDeps): MainSession {
  const listeners = new Set<(e: MainSessionEvent) => void>();
  let record: ConversationRecord = {
    version: 1,
    workspaceRoot: deps.workspaceRoot,
    runtimeSessionId: null,
    messages: [],
  };
  let session: AgentSession | null = null;
  let busy = false;
  /** Tours annulés dont l'agent n'a pas encore été informé. */
  let pendingUndoNote: string[] = [];

  const sessionConfig = () => ({
    role: "main",
    workingDirectory: deps.workspaceRoot,
    systemPrompt: deps.systemPrompt,
    tools: deps.tools ?? [],
    guard: deps.guard,
    ...(deps.model ? { model: deps.model } : {}),
  });

  const emit = (e: MainSessionEvent) => {
    for (const l of [...listeners]) l(e);
  };

  function append(role: ChatMessage["role"], text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
    const msg: ChatMessage = { id: deps.ids.next(), role, text, createdAt: deps.clock.now().toISOString(), ...extra };
    record.messages.push(msg);
    return msg;
  }

  /** Sauvegardes sérialisées : une écriture ancienne n'écrase jamais une plus récente. */
  let saving: Promise<void> = Promise.resolve();
  function persist(): Promise<void> {
    const snapshot = structuredClone(record);
    saving = saving.catch(() => undefined).then(() => deps.store.save(snapshot));
    emit({ type: "messages", messages: structuredClone(snapshot.messages) });
    return saving;
  }

  function setBusy(value: boolean): void {
    busy = value;
    emit({ type: "busy", busy: value });
  }

  function requireSession(): AgentSession {
    if (!session) throw new Error("La session principale n'est pas démarrée");
    return session;
  }

  return {
    get busy() {
      return busy;
    },

    messages: () => structuredClone(record.messages),

    onEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    async start() {
      const saved = await deps.store.load(deps.workspaceRoot);
      if (saved) record = saved;
      if (record.runtimeSessionId) {
        try {
          session = await deps.runtime.resumeSession(record.runtimeSessionId, sessionConfig());
        } catch {
          append("notice", "La conversation précédente n'a pas pu être reprise par l'agent : une nouvelle session a été ouverte. L'historique affiché est conservé, mais l'agent ne s'en souvient plus.");
        }
      }
      if (!session) {
        session = await deps.runtime.openSession(sessionConfig());
        record.runtimeSessionId = session.id;
      }
      await persist();
      return structuredClone(record.messages);
    },

    async send(text) {
      const s = requireSession();
      const prompt = text.trim();
      if (!prompt) throw new Error("Message vide");
      if (busy) throw new Error("Un tour est déjà en cours");
      setBusy(true);
      try {
        const cp = await deps.checkpoints.create(`Avant : ${prompt.slice(0, 80)}`);
        append("user", prompt, { checkpointId: cp.id });
        await persist();

        const note = pendingUndoNote.length
          ? `[Note de l'application : l'utilisateur a annulé ${pendingUndoNote.map((t) => `« ${t} »`).join(", ")} ; les fichiers sont revenus à leur état antérieur à ces demandes.]\n\n`
          : "";
        pendingUndoNote = [];

        try {
          await runTurn(s, note + prompt, {
            ...(deps.idleMs !== undefined ? { idleMs: deps.idleMs } : {}),
            ...(deps.maxMs !== undefined ? { maxMs: deps.maxMs } : {}),
            ...(deps.maxInputTokens !== undefined ? { maxInputTokens: deps.maxInputTokens } : {}),
            ...(deps.maxContextFraction !== undefined ? { maxContextFraction: deps.maxContextFraction } : {}),
            onEvent: (event) => {
              emit({ type: "agent", event });
              if (event.type === "message" && event.text.trim()) {
                append("assistant", event.text);
                void persist();
              }
            },
          });
        } catch (err) {
          if (err instanceof TurnContextError)
            append("notice", `${err.message}. Le tour a été interrompu : repartez d'une conversation neuve, ou demandez moins à la fois.`);
          else if (err instanceof TurnCostError)
            append("notice", `Le tour a dépassé son plafond de ${Math.round(err.maxInputTokens / 1000)} k tokens d'entrée et a été interrompu. Découpez la demande : chaque appel renvoie tout le contexte, donc la facture monte au carré.`);
          else if (err instanceof TurnBudgetError)
            append("notice", `L'agent travaillait encore, mais le tour a dépassé son plafond de ${Math.round(err.maxMs / 60_000)} min : il a été interrompu. Reformulez en demandant moins à la fois.`);
          else if (err instanceof TurnTimeoutError)
            append("notice", "L'agent ne répond plus : le tour a été interrompu. Vous pouvez reformuler ou annuler ce tour.");
          else if (err instanceof EnvFailureError) append("notice", `L'agent a rencontré une erreur : ${err.message}`);
          else append("notice", `Erreur inattendue : ${err instanceof Error ? err.message : String(err)}`);
        }
        await persist();
      } finally {
        setBusy(false);
      }
    },

    async undo(messageId) {
      if (busy) throw new Error("Impossible d'annuler pendant un tour en cours");
      const index = record.messages.findIndex((m) => m.id === messageId && m.role === "user");
      const target = record.messages[index];
      if (!target?.checkpointId) throw new Error(`Tour introuvable : ${messageId}`);
      if (target.undone) throw new Error("Ce tour est déjà annulé");

      setBusy(true);
      try {
        await deps.checkpoints.rollback(target.checkpointId);
        const undone = record.messages.slice(index).filter((m) => m.role === "user" && !m.undone);
        for (const m of undone) m.undone = true;
        pendingUndoNote.push(...undone.map((m) => m.text));
        append("notice", `Modifications annulées : les fichiers sont revenus à leur état d'avant « ${target.text.slice(0, 80)} ».`);
        await persist();
      } finally {
        setBusy(false);
      }
    },

    async abort() {
      await session?.abort();
    },

    async record(role, text, origin) {
      append(role, text, origin ? { origin } : {});
      await persist();
    },

    async close() {
      listeners.clear();
      await session?.close();
      session = null;
    },
  };
}
