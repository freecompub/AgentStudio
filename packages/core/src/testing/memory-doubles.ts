import type { Evidence, EvidenceStore } from "../protocols/evidence.js";
import type { InteractionRequest, InteractionStore } from "../protocols/interactions.js";
import type {
  Clock,
  ConversationRecord,
  ConversationStore,
  IdGenerator,
  TurnCheckpoints,
} from "../protocols/conversation.js";

export class MemoryConversationStore implements ConversationStore {
  readonly records = new Map<string, ConversationRecord>();
  saves = 0;

  async load(root: string): Promise<ConversationRecord | null> {
    const r = this.records.get(root);
    return r ? structuredClone(r) : null;
  }

  async save(record: ConversationRecord): Promise<void> {
    this.saves++;
    this.records.set(record.workspaceRoot, structuredClone(record));
  }
}

export class RecordingCheckpoints implements TurnCheckpoints {
  readonly created: string[] = [];
  readonly rolledBack: string[] = [];

  async create(label: string): Promise<{ id: string }> {
    this.created.push(label);
    return { id: `cp-${this.created.length}` };
  }

  async rollback(id: string): Promise<void> {
    this.rolledBack.push(id);
  }
}

export function fixedClock(iso = "2026-09-23T10:00:00.000Z"): Clock {
  return { now: () => new Date(iso) };
}

export function sequentialIds(prefix = "m"): IdGenerator {
  let n = 0;
  return { next: () => `${prefix}${++n}` };
}

export class MemoryInteractionStore implements InteractionStore {
  readonly records = new Map<string, InteractionRequest>();

  async save(req: InteractionRequest): Promise<void> {
    this.records.set(req.id, structuredClone(req));
  }

  async list(): Promise<InteractionRequest[]> {
    return [...this.records.values()].map((r) => structuredClone(r));
  }
}

export class MemoryEvidenceStore implements EvidenceStore {
  readonly items: Evidence[] = [];

  async append(e: Evidence): Promise<void> {
    this.items.push(structuredClone(e));
  }

  async list(taskId: string): Promise<Evidence[]> {
    return this.items.filter((e) => e.taskId === taskId).map((e) => structuredClone(e));
  }
}
