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
      { path: "README.md", status: "deleted" },
      { path: "src/a.ts", status: "modified" },
      { path: "src/b.ts", status: "added" },
    ]);
    expect(diff.patch).toContain("-a1");
    expect(diff.patch).toContain("+a2");
  });

  it("diff vide quand rien n'a changé", async () => {
    const cp = await ws.checkpoints.create("départ");
    expect(await ws.checkpoints.diff(cp.id)).toEqual({ files: [], patch: "" });
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
});
