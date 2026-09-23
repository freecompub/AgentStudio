import { isAbsolute, relative, resolve, sep } from "node:path";

export class PathOutsideWorkspaceError extends Error {
  constructor(readonly requested: string) {
    super(`Chemin hors de l'espace de travail : ${requested}`);
    this.name = "PathOutsideWorkspaceError";
  }
}

/**
 * Résout `rel` sous `root` et refuse tout ce qui en sort, la racine elle-même
 * et le dossier `.git` (réservé au service Workspace).
 * Contrôle purement lexical : les liens symboliques sont vérifiés par l'appelant.
 */
export function resolveInside(root: string, rel: string): string {
  if (rel.includes("\0") || isAbsolute(rel)) throw new PathOutsideWorkspaceError(rel);
  const absolute = resolve(root, rel);
  const fromRoot = relative(root, absolute);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))
    throw new PathOutsideWorkspaceError(rel);
  if (fromRoot.split(sep).includes(".git")) throw new PathOutsideWorkspaceError(rel);
  return absolute;
}
