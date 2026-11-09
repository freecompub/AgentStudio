import { delimiter, join } from "node:path";
import type { StackProfile } from "./stack-profile.js";

/**
 * Les outils du projet (`outils`, ADR 0075 point 1) : ses dossiers où vivent des programmes (un
 * environnement virtuel, par exemple), mis en tête du PATH de chaque commande du profil, comme s'il
 * était activé. Le programme reste jugé par son nom contre la liste de l'administrateur ; seul
 * l'endroit où on le trouve change. Rien sans `outils`.
 */
export function envDesOutils(profile: Pick<StackProfile, "outils">, cwd: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  if (!profile.outils?.length) return {};
  // Windows écrit souvent `Path` : une seconde variable `PATH` serait ambiguë pour le processus lancé.
  const nom = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const avant = env[nom];
  return { [nom]: [...profile.outils.map((d) => join(cwd, d)), ...(avant ? [avant] : [])].join(delimiter) };
}
