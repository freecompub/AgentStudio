/**
 * Vocabulaire commun des diagnostics de profil (`/stack doctor`, §8.6).
 *
 * Trois gravités, et la frontière entre elles est décidée par une seule question : *la porte
 * peut-elle encore juger ?* Un `probleme` veut dire qu'une porte rendra un verdict faux ou
 * refusera un travail correct. Un `avertissement` signale une imprécision qui ne trompe aucune
 * porte. Les `ok` sont conservés pour que le rapport se lise autrement que comme une liste de
 * reproches.
 */
export type Gravite = "ok" | "avertissement" | "probleme";

export interface Constat {
  gravite: Gravite;
  message: string;
}
