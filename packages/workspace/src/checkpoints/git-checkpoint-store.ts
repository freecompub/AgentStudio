import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { APP_IDENTITY } from "../git/cli-git-runner.js";
import type { Checkpoint, CheckpointStore, FileChange, FileChangeStatus, GitRunner } from "../protocols.js";

const CHECKPOINT_REFS = "refs/agent-studio/checkpoints";
const CHECKPOINT_ID = /^\d{13,}-[0-9a-f]{8}$/;

export class UnknownCheckpointError extends Error {
  constructor(readonly checkpointId: string) {
    super(`Checkpoint inconnu : ${checkpointId}`);
    this.name = "UnknownCheckpointError";
  }
}

/**
 * Checkpoints par commits instantanés rangés sous `refs/agent-studio/checkpoints/`.
 * Créer un checkpoint ne déplace ni HEAD ni l'index (ADR 0003).
 */
export function createGitCheckpointStore(git: GitRunner, gitDir: string): CheckpointStore {
  /** Écrit l'arbre de travail courant comme objet tree, via un index temporaire. */
  async function snapshotTree(): Promise<string> {
    const env = { GIT_INDEX_FILE: join(gitDir, `agent-studio-index-${randomBytes(4).toString("hex")}`) };
    try {
      await git.run(["read-tree", "HEAD"], { env });
      await git.run(["add", "-A"], { env });
      return (await git.run(["write-tree"], { env })).trim();
    } finally {
      await rm(env.GIT_INDEX_FILE, { force: true });
    }
  }

  async function list(): Promise<Checkpoint[]> {
    const out = await git.run([
      "for-each-ref",
      "--sort=-refname",
      "--format=%(refname:lstrip=3)%00%(objectname)%00%(parent)%00%(contents:subject)",
      CHECKPOINT_REFS,
    ]);
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [id = "", sha = "", head = "", label = ""] = line.split("\0");
        return { id, sha, head, label, createdAt: idToDate(id) };
      });
  }

  async function nextId(): Promise<string> {
    const last = (await list())[0];
    const ts = Math.max(Date.now(), last ? Number(last.id.split("-")[0]) + 1 : 0);
    return `${String(ts).padStart(13, "0")}-${randomBytes(4).toString("hex")}`;
  }

  async function resolve(id: string): Promise<Checkpoint> {
    const found = CHECKPOINT_ID.test(id) ? (await list()).find((c) => c.id === id) : undefined;
    if (!found) throw new UnknownCheckpointError(id);
    return found;
  }

  return {
    list,

    async create(label) {
      const head = (await git.run(["rev-parse", "HEAD"])).trim();
      const tree = await snapshotTree();
      const cleanLabel = label.replace(/\s+/g, " ").trim();
      const sha = (
        await git.run(["commit-tree", tree, "-p", head, "-m", cleanLabel || "checkpoint"], { env: { ...APP_IDENTITY } })
      ).trim();
      const id = await nextId();
      await git.run(["update-ref", `${CHECKPOINT_REFS}/${id}`, sha]);
      return { id, sha, head, label: cleanLabel, createdAt: idToDate(id) };
    },

    async diff(checkpointId) {
      const cp = await resolve(checkpointId);
      const current = await snapshotTree();
      const parts = (await git.run(["diff", "--no-renames", "--name-status", "-z", cp.sha, current]))
        .split("\0")
        .filter(Boolean);
      const files: FileChange[] = [];
      for (let i = 0; i + 1 < parts.length; i += 2) files.push({ path: parts[i + 1]!, status: toStatus(parts[i]!) });
      files.sort((a, b) => a.path.localeCompare(b.path));
      const patch = files.length ? await git.run(["diff", "--no-renames", cp.sha, current]) : "";
      return { files, patch };
    },

    /** Remet arbre de travail, HEAD et branche courante dans l'état du checkpoint ; les fichiers ignorés restent. */
    async rollback(checkpointId) {
      const cp = await resolve(checkpointId);
      await git.run(["read-tree", "--reset", "-u", cp.sha]);
      await git.run(["clean", "-fdq"]);
      await git.run(["reset", "-q", "--mixed", cp.head]);
    },
  };
}

function toStatus(code: string): FileChangeStatus {
  if (code.startsWith("A")) return "added";
  if (code.startsWith("D")) return "deleted";
  return "modified";
}

function idToDate(id: string): string {
  return new Date(Number(id.split("-")[0])).toISOString();
}
