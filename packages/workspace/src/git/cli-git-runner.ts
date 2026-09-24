import { execFile } from "node:child_process";
import type { GitRunner, GitRunnerFactory } from "../protocols.js";

export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(`git ${args[0] ?? ""} a échoué (${exitCode ?? "signal"}) : ${stderr.trim()}`);
    this.name = "GitError";
  }
}

/** Identité utilisée pour les objets créés par l'application (checkpoints, commits). */
export const APP_IDENTITY: Readonly<Record<string, string>> = {
  GIT_AUTHOR_NAME: "agent-studio",
  GIT_AUTHOR_EMAIL: "agent-studio@localhost",
  GIT_COMMITTER_NAME: "agent-studio",
  GIT_COMMITTER_EMAIL: "agent-studio@localhost",
};

export interface CliGitOptions {
  /** Variables ajoutées à chaque appel (ex. assistant d'identifiants). */
  env?: Record<string, string>;
  /** Options `-c clé=valeur` ajoutées à chaque appel. */
  config?: Record<string, string>;
  defaultTimeoutMs?: number;
}

/** `GitRunner` fondé sur le binaire git, non interactif et sans shell. */
export function createCliGitRunner(cwd: string, options: CliGitOptions = {}): GitRunner {
  const configArgs = Object.entries(options.config ?? {}).flatMap(([k, v]) => ["-c", `${k}=${v}`]);
  return {
    run(args, opts = {}) {
      const fullArgs = [...configArgs, ...args];
      return new Promise((resolve, reject) => {
        execFile(
          "git",
          fullArgs,
          {
            cwd,
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", ...options.env, ...opts.env },
            timeout: opts.timeoutMs ?? options.defaultTimeoutMs ?? 120_000,
            maxBuffer: 64 * 1024 * 1024,
            encoding: "utf8",
          },
          (err, stdout, stderr) => {
            if (err) reject(new GitError(args, typeof err.code === "number" ? err.code : null, stderr || err.message));
            else resolve(stdout);
          },
        );
      });
    },
  };
}

export function cliGitRunnerFactory(options: CliGitOptions = {}): GitRunnerFactory {
  return (cwd) => createCliGitRunner(cwd, options);
}
