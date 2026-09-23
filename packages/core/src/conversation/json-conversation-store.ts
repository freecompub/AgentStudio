import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ConversationRecord, ConversationStore } from "../protocols/conversation.js";

const chatMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "notice"]),
  text: z.string(),
  createdAt: z.string(),
  checkpointId: z.string().optional(),
  undone: z.boolean().optional(),
  origin: z.string().optional(),
});

const recordSchema = z.object({
  version: z.literal(1),
  workspaceRoot: z.string().min(1),
  runtimeSessionId: z.string().nullable(),
  messages: z.array(chatMessageSchema),
});

/**
 * Conversations en JSON, un fichier par espace de travail, dans le profil utilisateur.
 * Écriture atomique (fichier temporaire + rename). Choix provisoire (O6, ADR 0004).
 */
export function createJsonConversationStore(dir: string): ConversationStore {
  const fileFor = (root: string) =>
    join(dir, `${createHash("sha256").update(root).digest("hex").slice(0, 32)}.json`);

  return {
    async load(workspaceRoot) {
      const file = fileFor(workspaceRoot);
      let raw: string;
      try {
        raw = await readFile(file, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
      let parsed: z.infer<typeof recordSchema>;
      try {
        parsed = recordSchema.parse(JSON.parse(raw));
      } catch {
        await rename(file, `${file}.corrupt-${Date.now()}`);
        return null;
      }
      return stripUndefined(parsed) as ConversationRecord;
    },

    async save(record) {
      await mkdir(dir, { recursive: true });
      const file = fileFor(record.workspaceRoot);
      const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
      await writeFile(tmp, JSON.stringify(recordSchema.parse(record), null, 2));
      await rename(tmp, file);
    },
  };
}

/** Zod peut produire des clés à `undefined` ; `exactOptionalPropertyTypes` les interdit. */
function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
