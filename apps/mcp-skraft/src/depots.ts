/**
 * Dépôts que l'utilisateur a acceptés « toujours » (ADR 0075), gardés par le serveur **hors des
 * dépôts** : un agent qui écrit dans un projet ne peut pas s'en ouvrir un autre. Un fichier illisible
 * n'accepte rien.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

export interface Depots {
  liste(): Promise<string[]>;
  ajouter(root: string): Promise<void>;
}

const forme = z.object({ depots: z.array(z.string()) });

export function createDepotsFichier(fichier: string): Depots {
  const liste = async () => {
    try {
      const r = forme.safeParse(JSON.parse(await readFile(fichier, "utf8")));
      return r.success ? r.data.depots : [];
    } catch {
      return [];
    }
  };
  return {
    liste,
    async ajouter(root) {
      const avant = await liste();
      if (avant.includes(root)) return;
      await mkdir(dirname(fichier), { recursive: true });
      const tmp = `${fichier}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify({ depots: [...avant, root] }, null, 2)}\n`);
      await rename(tmp, fichier);
    },
  };
}
