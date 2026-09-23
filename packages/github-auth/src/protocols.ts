/**
 * Protocoles d'authentification GitHub (D4). Les jetons restent dans le processus
 * principal ; ils ne transitent jamais vers le renderer (§10.2).
 */

/**
 * Nature du jeton de `gh`. Copilot refuse les PAT classiques (`ghp_`) : il faut
 * une connexion OAuth par navigateur (`gho_`) ou un PAT à grain fin autorisé pour Copilot.
 */
export type TokenKind = "oauth" | "classic-pat" | "fine-grained-pat" | "unknown";

export type AuthStatus =
  | { loggedIn: false }
  | { loggedIn: true; user: string; tokenKind: TokenKind; copilotCompatible: boolean };

export interface DeviceCode {
  code: string;
  verificationUrl: string;
}

export interface GitHubAuth {
  status(): Promise<AuthStatus>;
  /** Jeton courant ; échoue si l'utilisateur n'est pas connecté. */
  token(): Promise<string>;
  /** Flux de connexion par code d'appareil ; `onCode` reçoit le code à saisir dans le navigateur. */
  login(onCode: (c: DeviceCode) => void): Promise<AuthStatus>;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Exécution d'une commande non interactive, sans shell. */
export interface CommandRunner {
  run(cmd: string, args: readonly string[]): Promise<CommandResult>;
}

/** Processus interactif (lecture de la sortie, écriture sur l'entrée). */
export interface InteractiveProcess {
  onOutput(cb: (chunk: string) => void): void;
  write(data: string): void;
  readonly exited: Promise<number>;
}

export interface ProcessSpawner {
  spawn(cmd: string, args: readonly string[]): InteractiveProcess;
}
