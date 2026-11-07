export function lireModelesRoles(value: string): Map<string, string> {
  const roles = new Map<string, string>();
  if (!value) return roles;
  for (const paire of value.split(",")) {
    const morceaux = paire.split(":");
    const [role, modele] = morceaux;
    if (morceaux.length !== 2 || !role?.trim() || !modele?.trim() || roles.has(role.trim()))
      throw new Error(`Association rôle/modèle invalide ou dupliquée : ${paire}`);
    roles.set(role.trim(), modele.trim());
  }
  return roles;
}

export function modelePourRole(roles: Map<string, string>, role: string): string | undefined {
  if (!roles.size) return undefined;
  const nom = role.split("/").at(-1)!;
  const modele = roles.get(nom);
  if (!modele) throw new Error(`Modèle non fixé pour le rôle ${role} ; Auto interdit pour ce run.`);
  return modele;
}
