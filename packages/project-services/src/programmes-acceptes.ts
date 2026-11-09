import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

/**
 * Programmes hors de la liste de l'administrateur que l'utilisateur a acceptés « toujours », par projet
 * (ADR 0075). Gardés hors du dépôt, dans le dossier des tâches : un agent qui écrit dans le projet ne
 * peut pas s'en accorder un. Un fichier illisible n'accepte rien.
 */
export interface ProgrammesAcceptes {
  accepte(root: string, programme: string): Promise<boolean>;
  ajouter(root: string, programme: string): Promise<void>;
}

const forme = z.object({ projets: z.record(z.string(), z.array(z.string())) });

export function createProgrammesAcceptesFichier(fichier: string): ProgrammesAcceptes {
  const lire = async (): Promise<Record<string, string[]>> => {
    try {
      const r = forme.safeParse(JSON.parse(await readFile(fichier, "utf8")));
      return r.success ? r.data.projets : {};
    } catch {
      return {};
    }
  };
  return {
    async accepte(root, programme) {
      const projets = await lire();
      return Object.hasOwn(projets, root) && projets[root]!.includes(programme);
    },
    async ajouter(root, programme) {
      const projets = await lire();
      const avant = Object.hasOwn(projets, root) ? projets[root]! : [];
      if (avant.includes(programme)) return;
      await mkdir(dirname(fichier), { recursive: true });
      const tmp = `${fichier}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify({ projets: { ...projets, [root]: [...avant, programme] } }, null, 2)}\n`);
      await rename(tmp, fichier);
    },
  };
}
