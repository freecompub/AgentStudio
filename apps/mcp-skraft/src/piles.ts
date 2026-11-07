/**
 * Piles fournies par le client (ADR 0068, point 8), gardées par le serveur, **hors du dépôt** : une
 * reprise du run, par ce serveur ou un autre, retrouve la même pile sans qu'on la redonne.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface Piles {
  lire(root: string): Promise<string | null>;
  ecrire(root: string, yaml: string): Promise<void>;
}

export function createPilesFichiers(dossier: string): Piles {
  const fichier = (root: string) => join(dossier, `${createHash("sha256").update(root).digest("hex").slice(0, 16)}.yaml`);
  return {
    async lire(root) {
      try {
        return await readFile(fichier(root), "utf8");
      } catch {
        return null;
      }
    },
    async ecrire(root, yaml) {
      await mkdir(dossier, { recursive: true });
      const tmp = `${fichier(root)}.${process.pid}.tmp`;
      await writeFile(tmp, yaml);
      await rename(tmp, fichier(root));
    },
  };
}
