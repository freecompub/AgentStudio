/**
 * Un seul fichier de projet (ADR 0071) : `.agent-studio/projet.yaml`, section `pile` (comment lancer
 * les outils, schéma du profil de pile) et section `qualite` (ce qui est exigé, schéma de la barre).
 * Ici, on ne fait que séparer : chaque section est rendue en YAML à son propre validateur. PUR.
 */
import { parse as parseYaml, stringify } from "yaml";

export const FICHIER_PROJET = ".agent-studio/projet.yaml";
const SECTIONS = ["pile", "qualite"] as const;

export function lireFichierProjet(raw: string): { pile?: string; qualite?: string } | { error: string } {
  let data: unknown;
  try {
    data = parseYaml(raw) ?? {};
  } catch (err) {
    return { error: `\`${FICHIER_PROJET}\` n'est pas du YAML valide : ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` };
  }
  if (typeof data !== "object" || Array.isArray(data)) return { error: `\`${FICHIER_PROJET}\` doit contenir les sections ${SECTIONS.join(", ")}.` };
  const inconnues = Object.keys(data as object).filter((k) => !(SECTIONS as readonly string[]).includes(k));
  if (inconnues.length) return { error: `\`${FICHIER_PROJET}\` : section inconnue ${inconnues.map((k) => `« ${k} »`).join(", ")} ; sections permises : ${SECTIONS.join(", ")}.` };
  const d = data as Record<string, unknown>;
  return {
    ...(d["pile"] != null ? { pile: stringify(d["pile"]) } : {}),
    ...(d["qualite"] != null ? { qualite: stringify(d["qualite"]) } : {}),
  };
}
