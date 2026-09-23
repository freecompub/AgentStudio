import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UsageDelta, UsageRecorder, UsageRow } from "../protocols/usage.js";

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const KEYS = ["requests", "inputTokens", "outputTokens", "retries", "durationMs", "effects"] as const;

const empty = (phase: string): UsageRow => ({ phase, requests: 0, inputTokens: 0, outputTokens: 0, retries: 0, durationMs: 0, effects: 0 });

export function sumUsage(rows: UsageRow[]): UsageRow {
  const total = empty("total");
  for (const r of rows) for (const k of KEYS) total[k] += r[k];
  return total;
}

/** Usage persisté en JSON, un fichier par tâche ; ajouts sérialisés par tâche. */
export function createUsageRecorder(dir: string): UsageRecorder {
  const chains = new Map<string, Promise<unknown>>();
  const listeners = new Set<(taskId: string, rows: UsageRow[]) => void>();
  const fileFor = (taskId: string) => {
    if (!SAFE_ID.test(taskId)) throw new Error(`Identifiant de tâche invalide : ${taskId}`);
    return join(dir, `${taskId}.json`);
  };

  async function read(taskId: string): Promise<UsageRow[]> {
    try {
      const raw = JSON.parse(await readFile(fileFor(taskId), "utf8")) as unknown;
      return Array.isArray(raw) ? (raw as UsageRow[]) : [];
    } catch {
      return [];
    }
  }

  return {
    add(taskId, phase, delta: UsageDelta) {
      const next = (chains.get(taskId) ?? Promise.resolve()).then(async () => {
        const rows = await read(taskId);
        let row = rows.find((r) => r.phase === phase);
        if (!row) rows.push((row = empty(phase)));
        for (const k of KEYS) row[k] += delta[k] ?? 0;
        await mkdir(dir, { recursive: true });
        const file = fileFor(taskId);
        await writeFile(`${file}.tmp`, JSON.stringify(rows));
        await rename(`${file}.tmp`, file);
        for (const l of [...listeners]) l(taskId, structuredClone(rows));
      });
      chains.set(taskId, next.catch(() => undefined));
      return next;
    },
    async report(taskId) {
      await chains.get(taskId);
      return read(taskId);
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
