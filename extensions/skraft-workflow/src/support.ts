// Repris de extensions/skraft/src/effects.ts et config.ts (2026-10-08) : skraft-workflow est
// indépendante de skraft et n'en importe rien.
import { createHash } from "node:crypto";
import type { W } from "@agent-studio/workflow";
import type { Difficulty, RepositoryShape } from "./difficulty.js";

/** Empreinte d'un contenu : déterministe, donc permise dans le script. */
export const sha256 = (texte: string): string => createHash("sha256").update(texte).digest("hex");

/** Recrée l'arborescence de la story (ADR 0037) : Git ne suit pas les dossiers vides. */
export async function creerDossiers(w: W, slug: string): Promise<void> {
  for (const d of dossiersDeLaStory(slug)) await w.creerDossier(d);
}

export type Phase = "RESEARCH" | "DESIGN" | "DISTILL" | "DELIVER";

export const LEVEL_LABELS: Record<Difficulty, string> = {
  simple: "Simple",
  medium: "Moyenne",
  "medium-hard": "Assez difficile",
  challenging: "Difficile",
};

/** Forme du dépôt pour les indicateurs de difficulté : modules = dossiers de `Sources/`, `src/` ou `packages/`. */
export function repositoryShape(files: string[]): RepositoryShape {
  const modules = new Map<string, Set<string>>();
  for (const f of files) {
    const m = /^(?:Sources|src|packages)\/([^/]+)\//.exec(f);
    if (!m) continue;
    const words = modules.get(m[1]!) ?? new Set<string>();
    const base = f.split("/").at(-1)!.replace(/\.[^.]+$/, "");
    for (const w of base.split(/(?=[A-Z])|[-_]/)) if (w.length > 3) words.add(w.toLowerCase());
    modules.set(m[1]!, words);
  }
  return { modules: [...modules.keys()], files, keywords: Object.fromEntries([...modules].map(([k, v]) => [k, [...v]])) };
}

/**
 * Fichiers qu'aucun agent n'écrit, quel que soit son périmètre : la barre de qualité sur laquelle
 * le travail est jugé (ADR 0049). Un agent ne doit pas pouvoir abaisser son propre critère.
 */
export const GELÉS = [".skraft/quality.json", ".agent-studio/quality.yaml"] as const;

/** Dossiers où les agents et le code déposent les livrables d'une story (ADR 0037). */
export const dossiersDeLaStory = (slug: string): string[] => [
  `.skraft/${slug}/research`,
  `.skraft/${slug}/design`,
  `.skraft/${slug}/distill/features`,
  `.skraft/${slug}/reviews`,
];

/** Message de commit d'une phase. */
export const commitMessage = (phase: Phase, slug: string): string =>
  phase === "DELIVER" ? `feat(${slug}): livraison de la story` : `docs(skraft): ${phase.toLowerCase()} de ${slug}`;
