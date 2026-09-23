import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cloneWorkspace } from "../src/workspace.js";
import { git, put, tempDir } from "./helpers.js";

describe("Workspace — clonage, commit, synchronisation", () => {
  let base: string;
  let cleanup: () => Promise<void>;
  let remote: string;
  let upstream: string;

  beforeEach(async () => {
    ({ path: base, cleanup } = await tempDir());
    upstream = join(base, "upstream");
    remote = join(base, "remote.git");
    await git(base, "init", "-q", "--bare", "-b", "main", remote);
    await git(base, "init", "-q", "-b", "main", upstream);
    await initRepoIn(upstream);
    await git(upstream, "remote", "add", "origin", remote);
    await git(upstream, "push", "-q", "origin", "main");
  });
  afterEach(() => cleanup());

  async function initRepoIn(dir: string) {
    await put(dir, "README.md", "v1\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "init");
  }

  it("clone un dépôt distant et l'ouvre comme espace de travail", async () => {
    const ws = await cloneWorkspace(`file://${remote}`, join(base, "clone"));
    expect(ws.root).toBe(join(base, "clone"));
    expect(await readFile(join(ws.root, "README.md"), "utf8")).toBe("v1\n");
  });

  it("refuse de cloner dans un dossier non vide", async () => {
    await put(base, "occupe/x.txt", "x");
    await expect(cloneWorkspace(`file://${remote}`, join(base, "occupe"))).rejects.toThrow(/non vide/);
  });

  it("refuse les URL de clonage qui ressemblent à des options", async () => {
    await expect(cloneWorkspace("--upload-pack=touch /tmp/pwn", join(base, "c"))).rejects.toThrow(/URL de dépôt refusée/);
  });

  it("commit tous les changements avec le message donné", async () => {
    const ws = await cloneWorkspace(`file://${remote}`, join(base, "clone"));
    await put(ws.root, "a.txt", "a\n");
    const sha = await ws.repo.commit("feat: a");
    expect(sha).toBe(await ws.repo.head());
    expect(await git(ws.root, "log", "-1", "--format=%s")).toBe("feat: a");
    expect(await git(ws.root, "status", "--porcelain")).toBe("");
  });

  it("commit limité à des chemins : le reste reste en attente", async () => {
    const ws = await cloneWorkspace(`file://${remote}`, join(base, "clone"));
    await put(ws.root, "tests/a.test.ts", "t\n");
    await put(ws.root, "src/a.ts", "s\n");
    await ws.repo.commit("test: a", { paths: ["tests/a.test.ts"] });
    expect(await git(ws.root, "show", "--name-only", "--format=%s", "HEAD")).toBe("test: a\n\ntests/a.test.ts");
    expect(await git(ws.root, "status", "--porcelain")).toBe("?? src/");
    await ws.repo.commit("feat: a");
    expect(await git(ws.root, "status", "--porcelain")).toBe("");
  });

  it("commit sans changement ne crée rien et renvoie null", async () => {
    const ws = await cloneWorkspace(`file://${remote}`, join(base, "clone"));
    expect(await ws.repo.commit("rien")).toBeNull();
  });

  it("branche : créée depuis HEAD puis réutilisée, modifications conservées ; nom dangereux refusé", async () => {
    const ws = await cloneWorkspace(`file://${remote}`, join(base, "clone"));
    await put(ws.root, "wip.txt", "en cours\n");
    await ws.repo.switchBranch("skraft/us-12");
    expect(await git(ws.root, "branch", "--show-current")).toBe("skraft/us-12");
    expect(await git(ws.root, "status", "--porcelain")).toBe("?? wip.txt");
    await git(ws.root, "switch", "-q", "main");
    await ws.repo.switchBranch("skraft/us-12");
    expect(await git(ws.root, "branch", "--show-current")).toBe("skraft/us-12");
    await expect(ws.repo.switchBranch("--orphan")).rejects.toThrow(/refusé/);
  });

  it("sync : déjà à jour", async () => {
    const ws = await cloneWorkspace(`file://${remote}`, join(base, "clone"));
    expect(await ws.repo.sync()).toEqual({ pulled: 0, pushed: 0 });
  });

  it("sync : récupère les commits distants en avance rapide", async () => {
    const ws = await cloneWorkspace(`file://${remote}`, join(base, "clone"));
    await put(upstream, "README.md", "v2\n");
    await git(upstream, "commit", "-qam", "v2");
    await git(upstream, "push", "-q", "origin", "main");

    expect(await ws.repo.sync()).toEqual({ pulled: 1, pushed: 0 });
    expect(await readFile(join(ws.root, "README.md"), "utf8")).toBe("v2\n");
  });

  it("sync : pousse les commits locaux", async () => {
    const ws = await cloneWorkspace(`file://${remote}`, join(base, "clone"));
    await put(ws.root, "a.txt", "a\n");
    await ws.repo.commit("feat: a");

    expect(await ws.repo.sync()).toEqual({ pulled: 0, pushed: 1 });
    expect(await git(remote, "log", "-1", "--format=%s", "main")).toBe("feat: a");
  });

  it("sync : signale une divergence sans rien modifier", async () => {
    const ws = await cloneWorkspace(`file://${remote}`, join(base, "clone"));
    await put(upstream, "README.md", "distant\n");
    await git(upstream, "commit", "-qam", "distant");
    await git(upstream, "push", "-q", "origin", "main");
    await put(ws.root, "a.txt", "local\n");
    await ws.repo.commit("local");
    const head = await ws.repo.head();

    await expect(ws.repo.sync()).rejects.toThrow(/diverg/);
    expect(await ws.repo.head()).toBe(head);
  });
});
