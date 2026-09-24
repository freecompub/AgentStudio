import { realpathSync } from "node:fs";
import type { MessageChannelLike } from "../rpc/protocol.js";

/** Processus hôte d'une extension, vu du principal. */
export interface ChildHandle {
  readonly channel: MessageChannelLike;
  readonly pid: number | undefined;
  onExit(cb: (code: number | null) => void): void;
  kill(): void;
}

export interface LaunchOptions {
  /** Script du runtime enfant (bundle ESM). */
  entry: string;
  /** Seuls chemins lisibles par l'enfant (modèle de permissions Node) ; aucune écriture, aucun sous-processus. */
  readPaths: string[];
  /** Budget mémoire du tas V8, en Mo. */
  maxOldSpaceMb?: number;
}

/** Lance un hôte d'extension isolé : `utilityProcess.fork` dans Electron, `child_process.fork` sinon. */
export interface ProcessLauncher {
  launch(opts: LaunchOptions): ChildHandle;
}

/**
 * Chemin réel, liens symboliques résolus. Le modèle de permissions de Node compare les chemins
 * réels : `--allow-fs-read=/var/…` n'autorise rien quand `/var` pointe vers `/private/var`
 * (macOS). Un chemin encore inexistant est gardé tel quel, pour ne pas empêcher le lancement.
 */
export function cheminReel(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Options Node communes : modèle de permissions (§4.1, §10.1) et budget mémoire. */
export function isolationExecArgv(opts: LaunchOptions): string[] {
  return [
    "--permission",
    ...opts.readPaths.map((p) => `--allow-fs-read=${cheminReel(p)}`),
    `--max-old-space-size=${opts.maxOldSpaceMb ?? 256}`,
  ];
}
