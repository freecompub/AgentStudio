import type { TaskRecord, TaskStore } from "../protocols.js";

export class MemoryTaskStore implements TaskStore {
  readonly records = new Map<string, TaskRecord>();
  saves = 0;

  async save(record: TaskRecord): Promise<void> {
    this.saves++;
    this.records.set(record.id, structuredClone(record));
  }

  async load(id: string): Promise<TaskRecord | null> {
    const r = this.records.get(id);
    return r ? structuredClone(r) : null;
  }

  async list(): Promise<TaskRecord[]> {
    return [...this.records.values()].map((r) => structuredClone(r));
  }
}
