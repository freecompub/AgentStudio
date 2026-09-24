import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { TaskRecord, TaskStore } from "../protocols.js";

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

const recordSchema = z.object({
  id: z.string().regex(SAFE_ID),
  name: z.string().min(1),
  state: z.unknown(),
  pending: z.array(z.unknown()),
  inflight: z.object({ effect: z.unknown(), checkpointId: z.string().nullable(), startedAt: z.string() }).nullable(),
  status: z.enum(["running", "waiting", "finished"]),
  phase: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Tâches en JSON, un fichier par tâche, écriture atomique. Choix provisoire (O6, ADR 0006) :
 * interchangeable avec SQLite derrière `TaskStore`.
 */
export function createJsonTaskStore(dir: string): TaskStore {
  const fileFor = (id: string) => {
    if (!SAFE_ID.test(id)) throw new Error(`Identifiant de tâche invalide : ${id}`);
    return join(dir, `${id}.json`);
  };

  async function read(file: string): Promise<TaskRecord | null> {
    try {
      const parsed = recordSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
      return parsed.success ? (parsed.data as TaskRecord) : null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (err instanceof SyntaxError) return null;
      throw err;
    }
  }

  return {
    async save(record) {
      await mkdir(dir, { recursive: true });
      const file = fileFor(record.id);
      const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
      await writeFile(tmp, JSON.stringify(record, null, 2));
      await rename(tmp, file);
    },
    load: async (id) => read(fileFor(id)),
    async list() {
      let files: string[];
      try {
        files = await readdir(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
      const records = await Promise.all(files.filter((f) => f.endsWith(".json")).map((f) => read(join(dir, f))));
      return records.filter((r): r is TaskRecord => r !== null);
    },
  };
}
