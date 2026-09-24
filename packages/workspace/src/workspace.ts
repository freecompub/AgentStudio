import { mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createGitCheckpointStore } from "./checkpoints/git-checkpoint-store.js";
import { createLocalFileStore } from "./files/local-file-store.js";
import { cliGitRunnerFactory, GitError } from "./git/cli-git-runner.js";
import type { GitRunnerFactory, Workspace } from "./protocols.js";
import { createGitRepository } from "./repository/git-repository.js";

export interface WorkspaceDeps {
  git?: GitRunnerFactory;
}

/** Compose un `Workspace` sur un dépôt Git existant. */
export async function openWorkspace(dir: string, deps: WorkspaceDeps = {}): Promise<Workspace> {
  const gitFor = deps.git ?? cliGitRunnerFactory();
  let root: string;
  let gitDir: string;
  try {
    const probe = gitFor(dir);
    root = (await probe.run(["rev-parse", "--show-toplevel"])).trim();
    gitDir = (await probe.run(["rev-parse", "--absolute-git-dir"])).trim();
  } catch (err) {
    if (err instanceof GitError) throw new Error(`${dir} n'est pas un dépôt Git`, { cause: err });
    throw err;
  }
  const git = gitFor(root);
  return {
    root,
    files: createLocalFileStore(root, git),
    checkpoints: createGitCheckpointStore(git, gitDir),
    repo: createGitRepository(git),
  };
}

const ALLOWED_URL = /^(https:\/\/|ssh:\/\/|file:\/\/|git@[\w.-]+:)/;

/** Clone `url` dans `dest` (absent ou vide), puis ouvre l'espace de travail. */
export async function cloneWorkspace(url: string, dest: string, deps: WorkspaceDeps = {}): Promise<Workspace> {
  if (!ALLOWED_URL.test(url)) throw new Error(`URL de dépôt refusée : ${url}`);
  const target = resolve(dest);
  await mkdir(target, { recursive: true });
  if ((await readdir(target)).length > 0) throw new Error(`Le dossier de destination est non vide : ${target}`);
  const gitFor = deps.git ?? cliGitRunnerFactory();
  await gitFor(target).run(["clone", "-q", "--", url, "."], { timeoutMs: 600_000 });
  return openWorkspace(target, deps);
}
