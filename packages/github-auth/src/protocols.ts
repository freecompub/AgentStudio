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
  | { loggedIn: false; hostname: string }
  | { loggedIn: true; user: string; tokenKind: TokenKind; copilotCompatible: boolean; hostname: string };

export interface DeviceCode {
  code: string;
  verificationUrl: string;
}

export interface GitHubAuth {
  status(): Promise<AuthStatus>;
  /** Jeton courant ; échoue si l'utilisateur n'est pas connecté. */
  token(): Promise<string>;
  /**
   * Flux de connexion par code d'appareil ; `onCode` reçoit le code à saisir dans le navigateur.
   * `hostname` vise une instance GitHub Enterprise ; l'hôte choisi devient l'hôte courant.
   */
  login(onCode: (c: DeviceCode) => void, opts?: { hostname?: string }): Promise<AuthStatus>;
  /** Déconnecte `gh` de l'hôte courant. Ne se plaint pas si personne n'était connecté. */
  logout(): Promise<void>;
  /** Hôte courant : `github.com` ou une instance Enterprise. */
  hostname(): string;
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
  /** Interrompt le processus (connexion abandonnée). Facultatif : les doubles peuvent l'omettre. */
  kill?(): void;
  readonly exited: Promise<number>;
}

export interface ProcessSpawner {
  spawn(cmd: string, args: readonly string[]): InteractiveProcess;
}
