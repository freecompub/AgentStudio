import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { TaskSessionEntry, TaskSessionStore } from "../protocols/task-sessions.js";

const schema = z.array(z.object({ key: z.string(), sessionId: z.string().min(1) }));

/**
 * Registre des sessions en un fichier JSON, écriture atomique. Les écritures sont mises en file :
 * les lentilles d'une revue ouvrent leurs sessions en même temps, et deux lectures-écritures
 * entrelacées perdraient une inscription — donc une session orpheline.
 */
export function createJsonTaskSessionStore(dir: string): TaskSessionStore {
  const file = join(dir, "sessions.json");
  let attente: Promise<unknown> = Promise.resolve();

  async function lire(): Promise<TaskSessionEntry[]> {
    try {
      const parsed = schema.safeParse(JSON.parse(await readFile(file, "utf8")));
      return parsed.success ? parsed.data : [];
    } catch {
      // Absent ou illisible : rien de connu. Le fichier sera réécrit à la prochaine inscription.
      return [];
    }
  }

  async function ecrire(entries: TaskSessionEntry[]): Promise<void> {
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(entries, null, 2));
    await rename(tmp, file);
  }

  const enFile = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = attente.then(fn);
    attente = p.catch(() => undefined);
    return p;
  };

  return {
    add: (entry) =>
      enFile(async () => {
        const entries = await lire();
        if (entries.some((e) => e.sessionId === entry.sessionId)) return;
        await ecrire([...entries, { key: entry.key, sessionId: entry.sessionId }]);
      }),
    remove: (sessionId) =>
      enFile(async () => {
        const entries = await lire();
        if (!entries.some((e) => e.sessionId === sessionId)) return;
        await ecrire(entries.filter((e) => e.sessionId !== sessionId));
      }),
    list: () => enFile(lire),
  };
}
