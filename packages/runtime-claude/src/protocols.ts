/**
 * Lancement de `claude -p`, injectable : le vrai lanceur exécute le CLI, les tests le simulent
 * (ADR 0070). Aucun objet de ce port ne sort du paquet (D10).
 */

export interface ProcessusClaude {
  /** Une ligne de la sortie standard (`stream-json`). */
  surLigne(cb: (ligne: string) => void): void;
  /** Fin du processus : code (null s'il a été tué), et fin de la sortie d'erreur. */
  surFin(cb: (code: number | null, erreur: string) => void): void;
  tuer(): void;
}

export interface LanceurClaude {
  /** `claude --version` ; échoue si le CLI est absent. */
  version(): Promise<string>;
  /**
   * Sortie JSON de `claude auth status` (`loggedIn`, `authMethod`, `projectsDirectory`…) ; échoue si
   * le CLI est absent (`code` `ENOENT`). Aucun secret n'y figure.
   */
  statut(): Promise<unknown>;
  /** Lance un tour : `entree` est écrite sur l'entrée standard, puis fermée. */
  lancer(o: { args: string[]; cwd: string; entree: string }): ProcessusClaude;
}
