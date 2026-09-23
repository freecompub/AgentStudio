import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_NOSYSTEM: "1",
};

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, env: GIT_ENV });
  return stdout.trimEnd();
}

export async function tempDir(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), "agent-studio-ws-"));
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}

export async function put(root: string, rel: string, content: string): Promise<void> {
  const file = join(root, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

/** Dépôt initialisé avec un premier commit contenant `files`. */
export async function initRepo(root: string, files: Record<string, string>): Promise<void> {
  await git(root, "init", "-q", "-b", "main");
  for (const [rel, content] of Object.entries(files)) await put(root, rel, content);
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "init");
}
