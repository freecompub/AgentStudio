import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { manifest } from "../src/manifest.js";

const RACINE = resolve(import.meta.dirname, "..");

async function fichiersTs(dossier: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dossier, { withFileTypes: true })) {
    const p = join(dossier, e.name);
    if (e.isDirectory()) out.push(...(await fichiersTs(p)));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** skraft-workflow et skraft sont deux extensions totalement indépendantes. */
describe("Indépendance vis-à-vis de l'extension skraft", () => {
  it("aucun fichier n'importe skraft, ni par son paquet ni par un chemin relatif", async () => {
    const fautifs: string[] = [];
    for (const f of [...(await fichiersTs(join(RACINE, "src"))), ...(await fichiersTs(join(RACINE, "test")))]) {
      const texte = await readFile(f, "utf8");
      if (/from\s+["'](@agent-studio\/ext-skraft["'/]|[./]*\/skraft\/)/.test(texte)) fautifs.push(f);
    }
    expect(fautifs).toEqual([]);
  });

  it("le paquet ne dépend pas de skraft", async () => {
    const pkg = JSON.parse(await readFile(join(RACINE, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    const deps = Object.keys({ ...pkg["dependencies"], ...pkg["devDependencies"] });
    expect(deps).not.toContain("@agent-studio/ext-skraft");
  });

  it("identifiant propre : ses agents et ses tâches ne se confondent pas avec ceux de skraft", () => {
    expect(manifest.id).toBe("agent-studio.skraft-workflow");
  });
});
