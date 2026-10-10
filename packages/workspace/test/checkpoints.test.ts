import { readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openWorkspace } from "../src/workspace.js";
import type { Workspace } from "../src/protocols.js";
import { git, initRepo, put, tempDir } from "./helpers.js";

describe("Workspace — checkpoints, diff, rollback", () => {
  let root: string;
  let cleanup: () => Promise<void>;
  let ws: Workspace;

  beforeEach(async () => {
    ({ path: root, cleanup } = await tempDir());
    await initRepo(root, { "src/a.ts": "a1\n", "README.md": "demo\n", ".gitignore": "node_modules/\n" });
    ws = await openWorkspace(root);
  });
  afterEach(() => cleanup());

  const read = (rel: string) => readFile(join(root, rel), "utf8");

  it("refuse d'ouvrir un dossier qui n'est pas un dépôt Git", async () => {
    const other = await tempDir();
    await expect(openWorkspace(other.path)).rejects.toThrow(/dépôt Git/);
    await other.cleanup();
  });

  it("un checkpoint ne déplace ni HEAD ni l'index et ne modifie aucun fichier", async () => {
    await put(root, "src/a.ts", "a2\n");
    await put(root, "notes.txt", "brouillon\n");
    const headBefore = await git(root, "rev-parse", "HEAD");
    const statusBefore = await git(root, "status", "--porcelain");

    const cp = await ws.checkpoints.create("avant l'effet");

    expect(cp.head).toBe(headBefore);
    expect(cp.label).toBe("avant l'effet");
    expect(await git(root, "rev-parse", "HEAD")).toBe(headBefore);
    expect(await git(root, "status", "--porcelain")).toBe(statusBefore);
    expect(await read("src/a.ts")).toBe("a2\n");
  });

  it("liste les checkpoints du plus récent au plus ancien", async () => {
    const c1 = await ws.checkpoints.create("un");
    await put(root, "src/a.ts", "a2\n");
    const c2 = await ws.checkpoints.create("deux");
    const list = await ws.checkpoints.list();
    expect(list.map((c) => c.id)).toEqual([c2.id, c1.id]);
    expect(list[0]).toEqual(c2);
  });

  it("diff depuis un checkpoint : fichiers ajoutés, modifiés, supprimés", async () => {
    await put(root, "notes.txt", "déjà là\n");
    const cp = await ws.checkpoints.create("départ");
    await put(root, "src/a.ts", "a2\n");
    await put(root, "src/b.ts", "b\n");
    await rm(join(root, "README.md"));
    await put(root, "node_modules/x/index.js", "ignoré\n");

    const diff = await ws.checkpoints.diff(cp.id);

    expect(diff.files).toEqual([
      { path: "README.md", status: "deleted", lines: [] },
      { path: "src/a.ts", status: "modified", lines: [1] },
      { path: "src/b.ts", status: "added", lines: [1] },
    ]);
    expect(diff.patch).toContain("-a1");
    expect(diff.patch).toContain("+a2");
  });

  it("diff vide quand rien n'a changé", async () => {
    const cp = await ws.checkpoints.create("départ");
    expect(await ws.checkpoints.diff(cp.id)).toEqual({ files: [], patch: "" });
  });

  it("les lignes du diff sont celles du nouvel arbre, y compris les fichiers non suivis et les espaces dans les chemins", async () => {
    await put(root, "src/avec espace.ts", "ancien\nstable\nsupprimer\n");
    const cp = await ws.checkpoints.create("départ");
    await put(root, "src/avec espace.ts", "nouveau\nstable\najout\nfin\n");
    await put(root, "src/neuf.ts", "un\ndeux\n");
    const diff = await ws.checkpoints.diff(cp.id);
    expect(diff.files).toEqual([
      { path: "src/avec espace.ts", status: "modified", lines: [1, 3, 4] },
      { path: "src/neuf.ts", status: "added", lines: [1, 2] },
    ]);
  });

  it("rollback restaure exactement l'arbre de travail du checkpoint", async () => {
    await put(root, "src/a.ts", "a-local\n");
    await put(root, "notes.txt", "non suivi avant\n");
    await put(root, "node_modules/x/index.js", "ignoré\n");
    const cp = await ws.checkpoints.create("départ");

    await put(root, "src/a.ts", "cassé\n");
    await put(root, "src/nouveau.ts", "nouveau\n");
    await rm(join(root, "README.md"));
    await rm(join(root, "notes.txt"));

    await ws.checkpoints.rollback(cp.id);

    expect(await read("src/a.ts")).toBe("a-local\n");
    expect(await read("README.md")).toBe("demo\n");
    expect(await read("notes.txt")).toBe("non suivi avant\n");
    expect(existsSync(join(root, "src/nouveau.ts"))).toBe(false);
    expect(await read("node_modules/x/index.js")).toBe("ignoré\n");
    // L'état Git redevient celui d'avant : modification non indexée, fichier non suivi.
    expect(await git(root, "status", "--porcelain")).toBe(" M src/a.ts\n?? notes.txt");
  });

  it("rollback annule aussi les commits faits après le checkpoint", async () => {
    const cp = await ws.checkpoints.create("départ");
    await put(root, "src/a.ts", "a2\n");
    await git(root, "add", "-A");
    await git(root, "commit", "-q", "-m", "feat: a2");

    await ws.checkpoints.rollback(cp.id);

    expect(await git(root, "rev-parse", "HEAD")).toBe(cp.head);
    expect(await read("src/a.ts")).toBe("a1\n");
    expect(await git(root, "status", "--porcelain")).toBe("");
  });

  it("rollback puis diff : plus aucune différence", async () => {
    const cp = await ws.checkpoints.create("départ");
    await put(root, "src/a.ts", "a2\n");
    await ws.checkpoints.rollback(cp.id);
    expect((await ws.checkpoints.diff(cp.id)).files).toEqual([]);
  });

  it("refuse un identifiant de checkpoint inconnu", async () => {
    await expect(ws.checkpoints.rollback("inexistant")).rejects.toThrow(/Checkpoint inconnu/);
    await expect(ws.checkpoints.diff("../../HEAD")).rejects.toThrow(/Checkpoint inconnu/);
  });

  it("fonctionne sans identité Git configurée", async () => {
    await git(root, "config", "user.name", "");
    await expect(ws.checkpoints.create("x")).resolves.toBeDefined();
  });

  /**
   * Les fichiers que le système sème n'entrent pas dans un checkpoint (ADR 0051).
   *
   * Observé le 29/09 : des `.DS_Store` apparaissent dans `.skraft/<slug>/` pendant un run, créés par
   * macOS et non par l'agent. Sur le poste de développement ils étaient invisibles — un
   * `~/.gitignore_global` les couvrait — mais rien ne garantit cette configuration : sur un poste
   * neuf, en CI, ou sous Windows avec `Thumbs.db` et `desktop.ini`, ils entreraient dans l'instantané.
   * La porte les enregistrerait alors comme artefacts « produits par » l'agent, et le même travail
   * rendrait des empreintes différentes selon la machine.
   *
   * Le dépôt de ce test n'ignore RIEN de tout ça : c'est la condition qui rend le défaut visible.
   */
  describe("Un checkpoint ignore ce que le système d'exploitation sème", () => {
    const bruits = [".DS_Store", "sous/.DS_Store", "Thumbs.db", "sous/desktop.ini", "._resource"];

    it("ni dans le diff, ni dans les changements rapportés", async () => {
      const cp = await ws.checkpoints.create("avant");
      for (const b of bruits) await put(root, b, "bruit du système");
      await put(root, "src/vrai.ts", "un vrai changement\n");

      const { files } = await ws.checkpoints.diff(cp.id);
      expect(files.map((f) => f.path)).toEqual(["src/vrai.ts"]);
    });

    it("le fichier reste bien sur le disque : on refuse de l'enregistrer, pas de le supprimer", async () => {
      const cp = await ws.checkpoints.create("avant");
      await put(root, ".DS_Store", "bruit");
      await ws.checkpoints.diff(cp.id);
      expect(existsSync(join(root, ".DS_Store"))).toBe(true);
    });

    it("un fichier de même nom DÉJÀ suivi n'est pas retiré dans le dos de l'utilisateur", async () => {
      // Quelqu'un a commité un `desktop.ini` volontairement : l'exclure de l'ajout laisse la version
      // de HEAD dans l'index, donc le diff ne le voit pas disparaître.
      await put(root, "desktop.ini", "contenu voulu\n");
      await git(root, "add", "-f", "desktop.ini");
      await git(root, "commit", "-m", "desktop.ini volontaire");
      const cp = await ws.checkpoints.create("avant");
      await put(root, "src/b.ts", "b\n");
      const { files } = await ws.checkpoints.diff(cp.id);
      expect(files.map((f) => f.path)).toEqual(["src/b.ts"]);
      expect(await read("desktop.ini")).toBe("contenu voulu\n");
    });
  });
});
