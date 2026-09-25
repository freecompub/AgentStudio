/**
 * Copie isolée du projet (`git worktree`), pour `/stack doctor` (SPEC §8.6, point 4).
 *
 * La raison d'être : les canaris écrivent des fichiers de test dans le projet, et l'un d'eux ne
 * compile pas volontairement. Les écrire dans le répertoire de travail de l'utilisateur
 * abîmerait son travail en cours — un `git status` pollué, une compilation cassée pendant qu'il
 * code. La copie est jetable ; ce qu'on y casse ne coûte rien.
 */
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitRepository } from "../src/repository/git-repository.js";
import { createCliGitRunner } from "../src/git/cli-git-runner.js";
import { git, initRepo, tempDir } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
const repo = () => createGitRepository(createCliGitRunner(root));
const existe = (p: string) => access(p).then(() => true, () => false);

beforeEach(async () => {
  ({ path: root, cleanup } = await tempDir());
  await initRepo(root, { "src/a.ts": "export const a = 1;\n", "README.md": "# demo\n" });
});
afterEach(() => cleanup());

describe("Copie isolée du projet", () => {
  it("rend une racine distincte, qui porte le contenu du commit courant", async () => {
    const copie = await repo().worktree();
    try {
      expect(copie.root).not.toBe(root);
      expect(await readFile(join(copie.root, "src/a.ts"), "utf8")).toBe("export const a = 1;\n");
    } finally {
      await copie.dispose();
    }
  });

  it("ce qu'on écrit dans la copie ne touche pas le projet", async () => {
    const copie = await repo().worktree();
    try {
      await writeFile(join(copie.root, "canari.ts"), "syntaxe ::: cassée");
      expect(await existe(join(root, "canari.ts"))).toBe(false);
      // Et le projet reste propre : un `git status` de l'utilisateur ne voit rien.
      expect(await git(root, "status", "--porcelain")).toBe("");
    } finally {
      await copie.dispose();
    }
  });

  it("la copie disparaît entièrement, y compris son enregistrement dans Git", async () => {
    const copie = await repo().worktree();
    const chemin = copie.root;
    await copie.dispose();
    expect(await existe(chemin)).toBe(false);
    // Sans `worktree remove`, Git garderait une référence morte que `git worktree list` affiche
    // et qui empêcherait de réutiliser le chemin.
    expect(await git(root, "worktree", "list")).not.toMatch(/canari|agent-studio-bac/);
  });

  it("libérer deux fois ne casse rien : le nettoyage doit pouvoir se retenter", async () => {
    const copie = await repo().worktree();
    await copie.dispose();
    await expect(copie.dispose()).resolves.toBeUndefined();
  });

  it("deux copies simultanées ne se gênent pas", async () => {
    const [a, b] = await Promise.all([repo().worktree(), repo().worktree()]);
    try {
      expect(a.root).not.toBe(b.root);
      await writeFile(join(a.root, "marque.txt"), "a");
      expect(await existe(join(b.root, "marque.txt"))).toBe(false);
    } finally {
      await Promise.all([a.dispose(), b.dispose()]);
    }
  });

  it("les modifications non validées ne sont PAS reprises : la copie part du dernier commit", async () => {
    // C'est un choix, et il doit être connu : diagnostiquer le travail en cours donnerait des
    // résultats qui changent à chaque frappe. La copie éprouve ce qui est validé.
    await writeFile(join(root, "src/a.ts"), "export const a = 2;\n");
    const copie = await repo().worktree();
    try {
      expect(await readFile(join(copie.root, "src/a.ts"), "utf8")).toBe("export const a = 1;\n");
    } finally {
      await copie.dispose();
    }
  });

  it("un dépôt sans aucun commit ne peut pas fournir de copie, et le dit", async () => {
    const vide = await tempDir();
    try {
      await git(vide.path, "init", "-q", "-b", "main");
      await expect(createGitRepository(createCliGitRunner(vide.path)).worktree()).rejects.toThrow(/commit/i);
    } finally {
      await vide.cleanup();
    }
  });
});
