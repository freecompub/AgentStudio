/** Journalisation structurée (§16) : identifiants de tâche, session, extension en champs. */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** Journal dérivé qui ajoute `fields` à chaque entrée. */
  child(fields: LogFields): Logger;
}
