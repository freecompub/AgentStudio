import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";
import type { FileStore, GitRunner } from "../protocols.js";
import { PathOutsideWorkspaceError, resolveInside } from "./paths.js";

/**
 * `FileStore` sur le disque local. Double contrôle : lexical (`resolveInside`)
 * puis physique (le plus proche ancêtre existant, liens résolus, doit rester sous la racine).
 */
export function createLocalFileStore(root: string, git: GitRunner): FileStore {
  const realRoot = realpath(root);

  async function guard(rel: string): Promise<string> {
    const absolute = resolveInside(root, rel);
    let probe = absolute;
    for (;;) {
      try {
        const real = await realpath(probe);
        const fromRoot = relative(await realRoot, real);
        if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || fromRoot.startsWith(sep))
          throw new PathOutsideWorkspaceError(rel);
        return absolute;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        probe = dirname(probe);
      }
    }
  }

  return {
    async read(rel) {
      return readFile(await guard(rel), "utf8");
    },
    async write(rel, content) {
      const file = await guard(rel);
      await mkdir(dirname(file), { recursive: true });
      await guard(rel); // revérifie après création des dossiers intermédiaires
      await writeFile(file, content);
    },
    async list() {
      const out = await git.run(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
      return [...new Set(out.split("\0").filter(Boolean))].sort();
    },
  };
}
