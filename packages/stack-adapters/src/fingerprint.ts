import { createHash } from "node:crypto";

export interface ReadableFiles {
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
}

/**
 * Empreinte SHA-256 d'un ensemble de fichiers (chemins et contenus, triés). Sert à geler
 * les tests après RED : toute modification, ajout ou suppression la change (D21).
 */
export async function fingerprintFiles(files: ReadableFiles, include: (path: string) => boolean): Promise<string> {
  const paths = (await files.list()).filter(include).sort();
  const hash = createHash("sha256");
  for (const p of paths) {
    const content = await files.read(p);
    hash.update(`${p.length}:${p}\0${Buffer.byteLength(content)}:`).update(content).update("\0");
  }
  return hash.digest("hex");
}
