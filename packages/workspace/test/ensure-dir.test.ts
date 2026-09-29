/**
 * Création de dossiers par l'orchestrateur (ADR 0037).
 *
 * La trace du 29/09 a montré le chercheur tenter, deux fois :
 *
 *   mkdir -p .skraft/us-2/research/ && ls -la .skraft/us-2/research/
 *
 * Il voulait créer l'arborescence avant d'y écrire — réflexe juste sous shell, et sans objet ici.
 * Plutôt que de le lui expliquer dans un message qu'il peut ne pas suivre, le code crée les
 * dossiers avant de le lancer : la question ne se pose plus.
 *
 * Le confinement est le même que pour l'écriture : rien hors du dépôt, liens symboliques résolus.
 */
import { mkdtemp, symlink, stat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createLocalFileStore } from "../src/files/local-file-store.js";
import { cliGitRunnerFactory } from "../src/git/cli-git-runner.js";

describe("ensureDir", () => {
  let root: string;
  let files: ReturnType<typeof createLocalFileStore>;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ws-ensure-"));
    files = createLocalFileStore(root, cliGitRunnerFactory()(root));
  });

  it("crée l'arborescence demandée, niveaux intermédiaires compris", async () => {
    await files.ensureDir(".skraft/us-2/distill/features");
    expect((await stat(join(root, ".skraft/us-2/distill/features"))).isDirectory()).toBe(true);
  });

  it("ne se plaint pas d'un dossier déjà là", async () => {
    await files.ensureDir(".skraft/us-2");
    await expect(files.ensureDir(".skraft/us-2")).resolves.toBeUndefined();
  });

  it("refuse de sortir du dépôt", async () => {
    for (const p of ["../evade", "/tmp/evade", ".skraft/../../evade"])
      await expect(files.ensureDir(p), p).rejects.toThrow();
  });

  it("refuse de traverser un lien symbolique sortant", async () => {
    // Un lien posé dans le dépôt ne doit pas servir de passage : c'est le défaut trouvé sur
    // l'écriture des canaris, qui se contournait par une vérification purement textuelle.
    await mkdir(join(root, "dedans"), { recursive: true });
    const dehors = await mkdtemp(join(tmpdir(), "ws-dehors-"));
    await symlink(dehors, join(root, "dedans/lien"));
    await expect(files.ensureDir("dedans/lien/cible")).rejects.toThrow();
  });
});
