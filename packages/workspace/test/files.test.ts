import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PathOutsideWorkspaceError } from "../src/files/paths.js";
import { openWorkspace } from "../src/workspace.js";
import type { Workspace } from "../src/protocols.js";
import { initRepo, put, tempDir } from "./helpers.js";

describe("Workspace — fichiers", () => {
  let root: string;
  let outside: string;
  let cleanups: (() => Promise<void>)[];
  let ws: Workspace;

  beforeEach(async () => {
    const a = await tempDir();
    const b = await tempDir();
    root = a.path;
    outside = b.path;
    cleanups = [a.cleanup, b.cleanup];
    await initRepo(root, { "src/a.ts": "a\n" });
    await put(outside, "secret.txt", "secret\n");
    ws = await openWorkspace(root);
  });
  afterEach(() => Promise.all(cleanups.map((c) => c())));

  it("lit et écrit sous la racine, en créant les dossiers", async () => {
    await ws.files.write("tests/deep/b.test.ts", "b\n");
    expect(await ws.files.read("tests/deep/b.test.ts")).toBe("b\n");
    expect(await ws.files.read("src/a.ts")).toBe("a\n");
  });

  it("refuse la lecture et l'écriture hors de la racine", async () => {
    await expect(ws.files.read("../x")).rejects.toThrow(PathOutsideWorkspaceError);
    await expect(ws.files.write(".git/config", "x")).rejects.toThrow(PathOutsideWorkspaceError);
  });

  it("refuse de suivre un lien symbolique qui sort de la racine", async () => {
    await symlink(outside, join(root, "evasion"));
    await expect(ws.files.read("evasion/secret.txt")).rejects.toThrow(PathOutsideWorkspaceError);
    await expect(ws.files.write("evasion/nouveau.txt", "x")).rejects.toThrow(PathOutsideWorkspaceError);
  });

  it("liste les fichiers suivis et non suivis, hors fichiers ignorés", async () => {
    await put(root, ".gitignore", "dist/\n");
    await put(root, "dist/out.js", "x");
    await put(root, "notes.md", "n");
    expect(await ws.files.list()).toEqual([".gitignore", "notes.md", "src/a.ts"]);
  });
});
