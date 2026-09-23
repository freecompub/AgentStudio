import { APP_IDENTITY } from "../git/cli-git-runner.js";
import type { GitRunner, Repository } from "../protocols.js";

export class DivergedBranchError extends Error {
  constructor(readonly ahead: number, readonly behind: number) {
    super(`La branche locale a divergé de l'amont (${ahead} en avance, ${behind} en retard) : synchronisation impossible sans intervention`);
    this.name = "DivergedBranchError";
  }
}

/** Opérations Git simplifiées pour des utilisateurs qui ne connaissent pas Git (D7). */
export function createGitRepository(git: GitRunner): Repository {
  const head = async () => (await git.run(["rev-parse", "HEAD"])).trim();

  return {
    head,

    async commit(message) {
      await git.run(["add", "-A"]);
      const staged = await git.run(["diff", "--cached", "--name-only"]);
      if (!staged.trim()) return null;
      // Si l'utilisateur n'a pas d'identité Git configurée, on signe avec celle de l'application.
      const hasIdentity = await git.run(["config", "user.email"]).then(
        (v) => v.trim() !== "",
        () => false,
      );
      await git.run(["commit", "-q", "--no-verify", "-m", message], hasIdentity ? {} : { env: { ...APP_IDENTITY } });
      return head();
    },

    async sync() {
      await git.run(["fetch", "-q", "--prune"], { timeoutMs: 300_000 });
      const [ahead = 0, behind = 0] = (await git.run(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]))
        .trim()
        .split(/\s+/)
        .map(Number);
      if (ahead > 0 && behind > 0) throw new DivergedBranchError(ahead, behind);
      if (behind > 0) await git.run(["merge", "-q", "--ff-only", "@{upstream}"]);
      if (ahead > 0) await git.run(["push", "-q"], { timeoutMs: 300_000 });
      return { pulled: behind, pushed: ahead };
    },
  };
}
