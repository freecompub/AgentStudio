/** Session d'agent ouverte pour une tâche, et la clé de continuité qui l'a ouverte. */
export interface TaskSessionEntry {
  /** Clé de continuité (`<taskId>/<extension>/<rôle>`), ou le rôle seul quand le tour n'en a pas. */
  key: string;
  sessionId: string;
}

/**
 * Registre persisté des sessions ouvertes (ADR 0053).
 *
 * Il ne sert qu'à **supprimer** : au redémarrage, à la fermeture, en fin de tâche. On n'y relit
 * jamais une session pour la reprendre — après un crash, l'agent repart neuf avec son dossier de
 * passation.
 */
export interface TaskSessionStore {
  add(entry: TaskSessionEntry): Promise<void>;
  remove(sessionId: string): Promise<void>;
  list(): Promise<TaskSessionEntry[]>;
}
