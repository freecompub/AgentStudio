import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { APP_IDENTITY } from "../git/cli-git-runner.js";
import type { Checkpoint, CheckpointStore, FileChange, FileChangeStatus, GitRunner } from "../protocols.js";

const CHECKPOINT_REFS = "refs/agent-studio/checkpoints";

/**
 * Fichiers que le système d'exploitation sème tout seul (ADR 0051).
 *
 * Ils entrent dans l'instantané d'un checkpoint quand le dépôt ne les ignore pas — et rien ne
 * garantit qu'il les ignore : c'est une configuration de l'utilisateur, souvent globale à sa
 * machine. Sans exclusion, un run enregistrerait un `.DS_Store` comme artefact « produit par »
 * l'agent, et le même travail rendrait des empreintes différentes selon le poste.
 *
 * Écrit ici parce que le Workspace est le seul service qui touche le disque, et parce que c'est une
 * connaissance de PLATEFORME, pas de langage : elle n'a rien à faire dans un adaptateur de stack.
 */
export const FICHIERS_DU_SYSTEME = [
  ".DS_Store", // macOS, Finder
  "._*", // macOS, AppleDouble sur les systèmes de fichiers étrangers
  ".Spotlight-V100",
  ".Trashes",
  ".fseventsd",
  "Thumbs.db", // Windows, Explorateur
  "ehthumbs.db",
  "desktop.ini",
  "$RECYCLE.BIN",
] as const;

/**
 * Pathspecs visant ces fichiers, à la racine et à tout niveau (`:(glob)x` ne couvre pas `sous/x`).
 *
 * On les retire de l'index APRÈS l'ajout, par `reset HEAD`, et non par exclusion de `git add` :
 * dès qu'un pathspec explicite désigne un fichier ignoré par un `.gitignore`, `git add` échoue —
 * y compris quand ce même fichier est exclu par un autre pathspec.
 *
 * `reset HEAD` a par ailleurs la bonne sémantique aux deux bouts : un fichier absent de HEAD sort
 * de l'index, un fichier DÉJÀ suivi y revient dans sa version de HEAD. On refuse de les
 * enregistrer, on ne les supprime dans le dos de personne.
 */
const PATHSPECS = FICHIERS_DU_SYSTEME.flatMap((m) => [`:(glob)${m}`, `:(glob)**/${m}`]);
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
      await git.run(["reset", "-q", "HEAD", "--", ...PATHSPECS], { env });
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
