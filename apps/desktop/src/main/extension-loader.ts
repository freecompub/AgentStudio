import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IsolatedExtension } from "@agent-studio/extension-host";
import { validateManifest } from "@agent-studio/extension-manifest";

export interface LoadResult {
  loaded: IsolatedExtension[];
  rejected: { directory: string; errors: string[] }[];
}

/**
 * Lit les extensions d'un dossier (une par sous-dossier, `manifest.json` + entrée compilée) et
 * valide chaque manifeste au démarrage (§5.1, §5.3) : une extension invalide n'est pas activée.
 */
export async function loadExtensions(dir: string, app: { appApi: string }): Promise<LoadResult> {
  const result: LoadResult = { loaded: [], rejected: [] };
  let entries: string[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return result;
  }
  for (const name of entries) {
    const directory = join(dir, name);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    } catch {
      result.rejected.push({ directory, errors: ["manifest.json absent ou illisible"] });
      continue;
    }
    const v = validateManifest(raw, app);
    if (!v.ok) {
      result.rejected.push({ directory, errors: v.errors });
      continue;
    }
    if (!v.manifest.main) {
      result.rejected.push({ directory, errors: ["main : entrée compilée obligatoire pour une extension isolée"] });
      continue;
    }
    const entry = join(directory, v.manifest.main);
    try {
      await access(entry);
    } catch {
      result.rejected.push({ directory, errors: [`Entrée introuvable : ${v.manifest.main}`] });
      continue;
    }
    if (result.loaded.some((e) => e.manifest.id === v.manifest.id)) {
      result.rejected.push({ directory, errors: [`Extension ${v.manifest.id} déjà chargée`] });
      continue;
    }
    result.loaded.push({ manifest: v.manifest, directory, entry });
  }
  return result;
}
