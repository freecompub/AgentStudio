import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TraceEntry, TraceStore } from "../protocols/trace.js";

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Au-delà, un texte est coupé. Un tour d'architecte compte des dizaines d'appels : sans limite, la
 * trace pèserait des centaines de mégaoctets et deviendrait illisible, donc inutile.
 */
export const LIMITE_TEXTE = 8_000;

/**
 * Coupe un texte trop long **en disant ce qu'il a perdu**. Une troncature muette ferait lire un
 * texte amputé comme s'il était entier — c'est la même faute que de taire ce qu'on n'a pas mesuré.
 */
export function tronquer<T>(valeur: T): T {
  if (typeof valeur !== "string" || valeur.length <= LIMITE_TEXTE) return valeur;
  return `${valeur.slice(0, LIMITE_TEXTE)} [... ${valeur.length - LIMITE_TEXTE} caractères coupés]` as unknown as T;
}

const tronquerEntree = (e: TraceEntry): TraceEntry =>
  Object.fromEntries(Object.entries(e).map(([k, v]) => [k, tronquer(v)])) as TraceEntry;

/**
 * Trace en JSON Lines, un fichier par tâche ; écritures sérialisées par fichier.
 *
 * Même forme que le journal de preuves, pour une raison différente : la preuve atteste, la trace
 * raconte. Une porte ne doit jamais s'appuyer sur une trace.
 */
export function createJsonlTraceStore(dir: string): TraceStore {
  const chains = new Map<string, Promise<void>>();
  const fileFor = (taskId: string) => {
    if (!SAFE_ID.test(taskId)) throw new Error(`Identifiant de tâche invalide : ${taskId}`);
    return join(dir, `${taskId}.jsonl`);
  };
  return {
    append(e) {
      // Jamais d'exception synchrone : `append` est déclarée `Promise<void>`, et un appelant qui
      // fait `.catch()` doit pouvoir s'y fier. Une trace ne doit sous aucun prétexte faire tomber
      // la tâche qu'elle observe.
      let file: string;
      try {
        file = fileFor(e.taskId);
      } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
      const next = (chains.get(file) ?? Promise.resolve()).then(async () => {
        await mkdir(dir, { recursive: true });
        await appendFile(file, `${JSON.stringify(tronquerEntree(e))}\n`);
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
      const out: TraceEntry[] = [];
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          out.push(JSON.parse(line) as TraceEntry);
        } catch {
          // ligne tronquée par un arrêt brutal : ignorée, les autres restent lisibles
        }
      }
      return out;
    },
  };
}
