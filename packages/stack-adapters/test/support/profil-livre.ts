/**
 * Lecture d'un exemple livré dans `profiles/` : un `projet.yaml` complet (ADR 0071), dont on tire
 * la section `pile` validée contre les programmes autorisés par défaut.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lireFichierProjet } from "../../src/profile/fichier-projet.js";
import { parseStackProfile } from "../../src/profile/stack-profile.js";
import { DEFAULT_ALLOWED_PROGRAMS_FOR_TESTS } from "./programmes.js";

const RACINE = join(import.meta.dirname, "../../../..", "profiles");

/** Le fichier tel qu'un utilisateur le copie. */
export const lireExempleLivre = (nom: string) => readFileSync(join(RACINE, `${nom}.yaml`), "utf8");

/** Le profil de la section `pile` ; une erreur nomme l'exemple fautif. */
export function profilLivre(nom: string) {
  const projet = lireFichierProjet(lireExempleLivre(nom));
  if ("error" in projet) throw new Error(`profiles/${nom}.yaml : ${projet.error}`);
  if (!projet.pile) throw new Error(`profiles/${nom}.yaml : pas de section pile`);
  const r = parseStackProfile(projet.pile, { allowedPrograms: DEFAULT_ALLOWED_PROGRAMS_FOR_TESTS });
  if ("error" in r) throw new Error(`profiles/${nom}.yaml : ${r.error}`);
  return r.profile;
}
