/**
 * Profils (D6, §10.3). Attribués par un administrateur (mécanisme : O5 ouvert, hypothèse
 * provisoire : fichier de configuration géré par l'administrateur). L'utilisateur ne peut pas
 * modifier son propre profil.
 */
export type Role = "testeur" | "po" | "developpeur" | "architecte" | "administrateur";

export interface Profile {
  role: Role;
  /** Mode d'affichage par défaut (§11). */
  defaultMode: "simple" | "advanced";
  /** Politique de permissions par défaut : prudente (tout demander) ou souple (tests autorisés). */
  permissionPolicy: "prudente" | "souple";
}

export const ROLE_LABELS: Record<Role, string> = {
  testeur: "Testeur",
  po: "PO / BA",
  developpeur: "Développeur",
  architecte: "Architecte",
  administrateur: "Administrateur",
};

/** Valeurs par défaut d'un rôle ; l'administrateur peut les surcharger. */
export function profileFor(role: Role, over: Partial<Omit<Profile, "role">> = {}): Profile {
  const technical = role === "developpeur" || role === "architecte" || role === "administrateur";
  return { role, defaultMode: technical ? "advanced" : "simple", permissionPolicy: technical ? "souple" : "prudente", ...over };
}
