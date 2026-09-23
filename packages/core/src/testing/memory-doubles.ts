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
