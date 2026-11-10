/**
 * Les commandes `/skraft-…` partagées entre Copilot CLI et Claude Code (10/11) : une seule source,
 * `skills/`, et des liens symboliques vers elle. Une correction d'un skill vaut alors pour les deux
 * clients. Personnel : `~/.claude/skills` (Claude) et `~/.copilot/skills` (Copilot) ; projet :
 * `<projet>/.claude/skills`, que les deux lisent. Rien qui ne vienne de nous n'est remplacé.
 */
import { lstat, mkdir, mkdtemp, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installerCommandes } from "../scripts/installer-commandes.mjs";

const SOURCE = join(import.meta.dirname, "../skills");
let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "commandes-"));
});
afterEach(() => rm(home, { recursive: true, force: true }));

describe("installerCommandes", () => {
  it("personnel : un lien par skill, pour Claude et pour Copilot", async () => {
    const r = await installerCommandes({ source: SOURCE, home, env: {} });
    for (const dossier of [join(home, ".claude", "skills"), join(home, ".copilot", "skills")]) {
      expect((await lstat(join(dossier, "skraft-etat"))).isSymbolicLink()).toBe(true);
      expect(await readlink(join(dossier, "skraft-etat"))).toBe(join(SOURCE, "skraft-etat"));
    }
    expect(r.poses).toHaveLength(18);
    expect(r.refuses).toEqual([]);
  });

  it("CLAUDE_CONFIG_DIR et COPILOT_HOME déplacent la configuration de chaque client : les liens y vont", async () => {
    const env = { CLAUDE_CONFIG_DIR: join(home, "conf-claude"), COPILOT_HOME: join(home, "conf-copilot") };
    await installerCommandes({ source: SOURCE, home, env });
    expect(await readlink(join(home, "conf-claude", "skills", "skraft-etat"))).toBe(join(SOURCE, "skraft-etat"));
    expect(await readlink(join(home, "conf-copilot", "skills", "skraft-etat"))).toBe(join(SOURCE, "skraft-etat"));
  });

  it("projet : un lien par skill dans <projet>/.claude/skills, que les deux clients lisent", async () => {
    const projet = join(home, "projet");
    const r = await installerCommandes({ source: SOURCE, home, projet, env: {} });
    expect(await readlink(join(projet, ".claude", "skills", "skraft-pile"))).toBe(join(SOURCE, "skraft-pile"));
    expect(r.poses).toHaveLength(9);
  });

  it("relancé : nos liens sont remplacés sans bruit ; un skill qui n'est pas à nous n'est jamais touché", async () => {
    const dossier = join(home, ".claude", "skills");
    await mkdir(join(dossier, "skraft-etat"), { recursive: true });
    await writeFile(join(dossier, "skraft-etat", "SKILL.md"), "le mien");
    await symlink("/ailleurs/skraft-pile", join(dossier, "skraft-pile"));
    await installerCommandes({ source: SOURCE, home, env: {} });
    const r = await installerCommandes({ source: SOURCE, home, env: {} });
    expect(r.refuses).toEqual([
      expect.stringMatching(/skraft-etat.*existe déjà et n'est pas un lien/),
      expect.stringMatching(/skraft-pile.*pointe ailleurs/),
    ]);
    expect((await lstat(join(dossier, "skraft-etat"))).isDirectory()).toBe(true);
    expect(await readlink(join(dossier, "skraft-pile"))).toBe("/ailleurs/skraft-pile");
    expect(await readlink(join(home, ".copilot", "skills", "skraft-etat"))).toBe(join(SOURCE, "skraft-etat"));
  });

  it("retirer : seuls nos liens partent", async () => {
    await installerCommandes({ source: SOURCE, home, env: {} });
    await writeFile(join(home, ".claude", "skills", "autre"), "x");
    const r = await installerCommandes({ source: SOURCE, home, retirer: true, env: {} });
    expect(r.retires).toHaveLength(18);
    await expect(lstat(join(home, ".claude", "skills", "skraft-etat"))).rejects.toThrow();
    expect((await lstat(join(home, ".claude", "skills", "autre"))).isFile()).toBe(true);
  });
});
