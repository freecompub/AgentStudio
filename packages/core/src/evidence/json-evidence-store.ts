import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Evidence, EvidenceStore } from "../protocols/evidence.js";

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Journal de preuves en JSON Lines, un fichier par tâche ; écritures sérialisées par fichier. */
export function createJsonEvidenceStore(dir: string): EvidenceStore {
  const chains = new Map<string, Promise<void>>();
  const fileFor = (taskId: string) => {
    if (!SAFE_ID.test(taskId)) throw new Error(`Identifiant de tâche invalide : ${taskId}`);
    return join(dir, `${taskId}.jsonl`);
  };
  return {
    append(e) {
      const file = fileFor(e.taskId);
      const next = (chains.get(file) ?? Promise.resolve()).then(async () => {
        await mkdir(dir, { recursive: true });
        await appendFile(file, `${JSON.stringify(e)}\n`);
      });
      chains.set(file, next.catch(() => undefined));
      return next;
    },
    async list(taskId) {
      let raw: string;
      try {
        raw = await readFile(fileFor(taskId), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
      const out: Evidence[] = [];
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          out.push(JSON.parse(line) as Evidence);
        } catch {
          // ligne tronquée par un arrêt brutal : ignorée
        }
      }
      return out;
    },
  };
}
