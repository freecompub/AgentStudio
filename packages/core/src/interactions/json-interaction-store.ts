import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { InteractionRequest, InteractionStore } from "../protocols/interactions.js";

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

const schema = z.object({
  id: z.string().regex(SAFE_ID),
  taskId: z.string(),
  extensionId: z.string(),
  kind: z.literal("decision"),
  title: z.string(),
  detail: z.string().optional(),
  options: z.array(z.object({ id: z.string(), label: z.string() })),
  freeText: z.boolean().optional(),
  requiredRoles: z.array(z.enum(["testeur", "po", "developpeur", "architecte", "administrateur"])).optional(),
  createdAt: z.string(),
  status: z.enum(["pending", "answered", "cancelled"]),
  answer: z.object({ option: z.string(), comment: z.string().optional(), answeredAt: z.string() }).optional(),
});

/** Demandes d'interaction en JSON, un fichier par demande, écriture atomique : survivent au redémarrage. */
export function createJsonInteractionStore(dir: string): InteractionStore {
  return {
    async save(req) {
      if (!SAFE_ID.test(req.id)) throw new Error(`Identifiant de demande invalide : ${req.id}`);
      await mkdir(dir, { recursive: true });
      const file = join(dir, `${req.id}.json`);
      const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
      await writeFile(tmp, JSON.stringify(schema.parse(req), null, 2));
      await rename(tmp, file);
    },
    async list() {
      let files: string[];
      try {
        files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
      const out: InteractionRequest[] = [];
      for (const f of files) {
        try {
          const parsed = schema.safeParse(JSON.parse(await readFile(join(dir, f), "utf8")));
          if (parsed.success) out.push(JSON.parse(JSON.stringify(parsed.data)) as InteractionRequest);
        } catch {
          // fichier illisible : ignoré
        }
      }
      return out;
    },
  };
}
