/**
 * Garde de la frontière de licence (ADR 0023). Fonction pure : elle reçoit un `package.json`
 * déjà lu et rend les dépendances interdites qu'il déclare.
 *
 * Les dépendances de développement comptent autant que les autres : elles finissent dans l'arbre
 * installé, et c'est l'arbre qui est distribué, pas l'intention de celui qui l'a déclaré.
 */
const CHAMPS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

export function dependancesInterdites(packageJson: Record<string, unknown>, interdits: readonly string[]): string[] {
  const declarees = new Set<string>();
  for (const champ of CHAMPS) {
    const bloc = packageJson[champ];
    if (bloc && typeof bloc === "object") for (const nom of Object.keys(bloc)) declarees.add(nom);
  }
  return interdits.filter((nom) => declarees.has(nom));
}
