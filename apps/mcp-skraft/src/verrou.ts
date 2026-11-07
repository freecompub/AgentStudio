/**
 * Verrou d'un projet (ADR 0068, point 5) : seul le serveur qui le tient lance ou reprend un run ;
 * les autres restent en consultation. Le fichier porte le PID du détenteur ; un verrou dont le
 * processus est mort, ou illisible, est repris.
 */
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface OptionsVerrou {
  pid: number;
  estVivant(pid: number): boolean;
}

export type Verrou = { ok: true; liberer(): Promise<void> } | { ok: false; pid: number };

export async function prendreVerrou(fichier: string, o: OptionsVerrou): Promise<Verrou> {
  await mkdir(dirname(fichier), { recursive: true });
  // Deux essais : le second après avoir retiré un verrou abandonné.
  for (let essai = 0; essai < 2; essai++) {
    try {
      // `wx` : création exclusive, atomique ; deux serveurs ne peuvent pas la réussir tous les deux.
      await writeFile(fichier, JSON.stringify({ pid: o.pid }), { flag: "wx" });
      return {
        ok: true,
        async liberer() {
          // Seulement s'il est encore à nous : un autre serveur a pu le reprendre.
          if ((await lirePid(fichier)) === o.pid) await unlink(fichier).catch(() => undefined);
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const pid = await lirePid(fichier);
      if (pid !== null && pid !== o.pid && o.estVivant(pid)) return { ok: false, pid };
      await unlink(fichier).catch(() => undefined);
    }
  }
  const pid = await lirePid(fichier);
  return { ok: false, pid: pid ?? -1 };
}

async function lirePid(fichier: string): Promise<number | null> {
  try {
    const v = JSON.parse(await readFile(fichier, "utf8")) as { pid?: unknown };
    return typeof v.pid === "number" ? v.pid : null;
  } catch {
    return null;
  }
}

/** Le processus existe-t-il ? `kill(pid, 0)` n'envoie rien ; `EPERM` : il existe, sous un autre compte. */
export function processusVivant(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
