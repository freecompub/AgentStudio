import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { AppSettings, SettingsStore } from "./protocols.js";

/**
 * Toute clé de `AppSettings` doit figurer ici : zod écarte les clés non déclarées, et le
 * contrôleur enregistre par `{ ...(await load()), x }` — une clé absente du schéma serait
 * effacée du fichier à la sauvegarde suivante.
 */
const schema = z.object({
  lastWorkspace: z.string().optional(),
  uiMode: z.enum(["simple", "advanced"]).optional(),
  models: z.record(z.string(), z.string()).optional(),
  modelClasses: z.record(z.string(), z.object({ strong: z.string(), standard: z.string(), light: z.string() }).partial()).optional(),
  authHostname: z.string().optional(),
});

/** Réglages de l'application en JSON, écriture atomique ; un fichier illisible vaut réglages vides. */
export function createJsonSettingsStore(file: string): SettingsStore {
  return {
    async load() {
      try {
        const parsed = schema.safeParse(JSON.parse(await readFile(file, "utf8")));
        return parsed.success ? (JSON.parse(JSON.stringify(parsed.data)) as AppSettings) : {};
      } catch {
        return {};
      }
    },
    async save(settings) {
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, JSON.stringify(settings, null, 2));
      await rename(tmp, file);
    },
  };
}
