/**
 * Projet de l'appelant (ADR 0068, point 6). Le serveur tourne sous le compte de l'utilisateur, sans
 * bac à sable, et les demandes de permission du client ne couvrent pas ses écritures : il n'accepte
 * qu'un dépôt Git situé dans un root déclaré par le client ou dans un dossier autorisé par sa
 * configuration. Les chemins sont jugés sur leur cible réelle, liens symboliques résolus.
 */
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface DemandeProjet {
  /** Argument `projet` d'un outil, absolu ou relatif au premier root (sinon au dossier courant). */
  argument?: string;
  /** Roots déclarés par le client MCP, en chemins. */
  roots: readonly string[];
  cwd: string;
  /** Dossiers autorisés par la configuration du serveur. */
  autorises: readonly string[];
}

export type ProjetResolu = { ok: true; root: string } | { ok: false; motif: string };

export async function resoudreProjet(d: DemandeProjet): Promise<ProjetResolu> {
  const base = d.roots[0] ?? d.cwd;
  const demande = d.argument !== undefined ? resolve(base, d.argument) : base;
  const root = await reel(demande);
  if (!root) return { ok: false, motif: `Projet introuvable : ${demande}.` };
  if (!(await existe(resolve(root, ".git"))))
    return { ok: false, motif: `Projet refusé : ${root} n'est pas un dépôt Git (skraft travaille sur une branche, avec des checkpoints).` };
  const bornes = (await Promise.all([...d.roots, ...d.autorises].map(reel))).filter((b): b is string => b !== null);
  if (!bornes.some((b) => dedans(root, b)))
    return {
      ok: false,
      motif: `Projet refusé : ${root} est hors des dossiers ouverts par le client et des dossiers autorisés par la configuration du serveur (« autorises »). Ouvre le projet dans le client, ou ajoute son dossier à la configuration.`,
    };
  return { ok: true, root };
}

async function reel(p: string): Promise<string | null> {
  try {
    return await realpath(p);
  } catch {
    return null;
  }
}

async function existe(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function dedans(chemin: string, borne: string): boolean {
  const r = relative(borne, chemin);
  return r === "" || (!isAbsolute(r) && r !== ".." && !r.startsWith(`..${sep}`));
}
