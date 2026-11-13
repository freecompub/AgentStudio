import { randomBytes } from "node:crypto";
import { realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

    async worktree() {
      // Le HEAD est résolu d'abord : sur un dépôt sans commit, `git worktree add` échouerait par
      // un message obscur, alors que la cause est simple et mérite d'être dite.
      const sha = await head().catch(() => {
        throw new Error("Ce dépôt n'a aucun commit : impossible d'en ouvrir une copie isolée.");
      });
      // Hors du projet : une copie posée dedans se retrouverait dans les listages de fichiers,
      // dans les motifs de `layout`, et dans le prochain `git add -A`.
      const chemin = join(await realpath(tmpdir()), `agent-studio-bac-${randomBytes(8).toString("hex")}`);
      // `--detach` : pas de branche créée, donc rien à nettoyer côté références.
      await git.run(["worktree", "add", "--detach", "--quiet", chemin, sha]);

      let libere = false;
      return {
        root: chemin,
        async dispose() {
          if (libere) return; // le nettoyage doit pouvoir se retenter sans casser
          libere = true;
          // `--force` : la copie porte des fichiers non suivis (les canaris), que Git refuserait
          // sinon de retirer. C'est une copie jetable, il n'y a rien à y préserver.
          await git.run(["worktree", "remove", "--force", chemin]).catch(async () => {
            // La copie a pu être effacée à la main, ou le disque monté ailleurs : on retire au
            // moins l'enregistrement, sinon Git garde une référence morte sur ce chemin.
            await rm(chemin, { recursive: true, force: true }).catch(() => {});
            await git.run(["worktree", "prune"]).catch(() => {});
          });
        },
      };
    },

    async commit(message, opts = {}) {
      await git.run(opts.paths?.length ? ["add", "-A", "--", ...opts.paths] : ["add", "-A"]);
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

    async switchBranch(name, opts = {}) {
      if (!/^[A-Za-z0-9._/-]{1,100}$/.test(name) || name.startsWith("-") || name.includes("..")) throw new Error(`Nom de branche refusé : ${name}`);
      if (opts.ecraser) {
        const depuis = await git.run(["rev-parse", "--verify", "--quiet", `${opts.depuis ?? "HEAD"}^{commit}`]).then((s) => s.trim(), () => null);
        if (!depuis) throw new Error(`Commit inconnu : ${opts.depuis}`);
        // Le travail en cours appartient à la session écrasée : il part avec elle.
        await git.run(["reset", "-q", "--hard"]);
        await git.run(["switch", "-q", "-C", name, depuis]);
        return;
      }
      const exists = await git.run(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]).then(
        () => true,
        () => false,
      );
      await git.run(exists ? ["switch", "-q", name] : ["switch", "-q", "-c", name]);
    },

    async log() {
      const sortie = await git.run(["log", "-n", "200", "--format=%H%x1f%s"]);
      return sortie.split("\n").filter(Boolean).map((l) => {
        const [sha, subject] = l.split("\x1f");
        return { sha: sha!, subject: subject ?? "" };
      });
    },

    async resetTo(sha) {
      if (!/^[0-9a-f]{7,64}$/.test(sha)) throw new Error(`Commit refusé : ${sha}`);
      // Seulement vers un ancêtre de HEAD : revenir en arrière sur cette branche, jamais sauter ailleurs.
      const ancetre = await git.run(["merge-base", "--is-ancestor", sha, "HEAD"]).then(() => true, () => false);
      if (!ancetre) throw new Error(`Le commit ${sha.slice(0, 12)} n'est pas dans l'historique de la branche : rien n'a changé.`);
      await git.run(["reset", "-q", "--hard", sha]);
      const nonSuivis = (await git.run(["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
      return { nonSuivis };
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
