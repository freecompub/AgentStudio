/** Formulation en langage clair d'une permission, pour l'écran d'installation (§5.3, §11). */
export function describePermission(p: string): string {
  if (p === "fs:read") return "Lire les fichiers du projet";
  if (p.startsWith("fs:write:")) return `Modifier les fichiers du projet correspondant à « ${p.slice(9)} »`;
  if (p === "shell:test") return "Lancer les tests et le linter du projet";
  if (p.startsWith("shell:")) return `Exécuter les commandes : ${p.slice(6).split(",").join(", ")}`;
  if (p === "git:commit") return "Enregistrer des modifications dans l'historique (commits)";
  if (p === "git:branch") return "Créer ou changer de branche";
  if (p === "git:revert") return "Revenir à un état antérieur du projet";
  if (p === "copilot:sessions") return "Lancer des agents avec votre abonnement Copilot (consomme votre quota)";
  if (p === "net:none") return "Aucun accès à Internet";
  if (p.startsWith("net:")) return `Accéder à Internet : ${p.slice(4).split(",").join(", ")}`;
  return p;
}
