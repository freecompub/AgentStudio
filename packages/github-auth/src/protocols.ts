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

/**
 * Réserve de requêtes premium Copilot. C'est la grandeur que Copilot facture — les complétions et
 * le chat sont illimités, les appels d'agent non. `restantes` est le seul chiffre qui dit si une
 * tâche peut aller au bout : le 29/09, une tâche a été lancée avec 28 requêtes en réserve pour une
 * phase qui en demande des dizaines.
 */
export interface CopilotQuota {
  /** Enveloppe du mois. */
  total: number;
  utilisees: number;
  restantes: number;
  /** Part restante, en pourcentage, telle que GitHub la calcule. */
  pourcentageRestant: number;
  /** Faux : une fois à zéro, les appels sont refusés, pas facturés en plus. */
  depassementAutorise: boolean;
  /** Date de remise à zéro, au format `AAAA-MM-JJ`. */
  remiseAZero: string;
}

export interface GitHubAuth {
  status(): Promise<AuthStatus>;
  /**
   * Réserve de requêtes premium, ou `null` si elle n'a pas pu être lue — `gh` absent, utilisateur
   * déconnecté, point d'accès changé. C'est une information de confort : elle ne doit jamais
   * empêcher de travailler, seulement éviter de lancer une tâche vouée à s'interrompre.
   */
  copilotQuota(): Promise<CopilotQuota | null>;
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
