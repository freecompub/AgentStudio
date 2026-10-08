// Copie de extensions/skraft/src/preselect.ts (2026-10-08) : skraft-workflow est indépendante de skraft
// et n'en importe rien ; une correction de l'une ne se reporte pas seule dans l'autre.
import type { Story } from "./story.js";

const STOP = new Set(
  "alors aussi avec avoir celle celui cette comme dans depuis donc elle elles être fait faire leur leurs mais même nous pour pourquoi quand quel quelle quelles quels sans selon sera seront sont tous tout toute toutes très une votre vous afin entre lorsque dont chaque était ainsi celui-ci patient utilisateur veux voir égale proposée proposé calcul configuré aucun".split(" "),
);

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Termes métier de la story : mots d'au moins quatre lettres, hors mots vides, sans doublon. */
export function keywordsOf(story: Story): string[] {
  const text = `${story.title} ${story.statement} ${story.criteria.map((c) => c.text).join(" ")}`;
  const out: string[] = [];
  for (const w of text.toLowerCase().match(/[a-zà-ÿ]{4,}/g) ?? []) if (!STOP.has(w) && !out.includes(w)) out.push(w);
  return out;
}

const IGNORED = /(^|\/)(\.build|\.git|node_modules|dist|out|build|DerivedData|\.skraft)\//;

/**
 * Présélection des fichiers candidats pour la recherche (§7.1) : score par occurrence des mots-clés
 * dans le chemin (poids fort) puis dans le contenu fourni (poids faible). Vingt fichiers au plus.
 */
export function preselectFiles(story: Story, files: string[], contents: Record<string, string> = {}, limit = 20): string[] {
  const keys = keywordsOf(story).map(norm);
  const scored = files
    .filter((f) => !IGNORED.test(f))
    .map((f) => {
      const path = norm(f);
      const body = norm(contents[f] ?? "");
      const count = (hay: string, k: string) => hay.split(k).length - 1;
      const score = keys.reduce((acc, k) => acc + 10 * count(path, k) + Math.min(5, count(body, k)), 0);
      return { f, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.f.length - b.f.length || a.f.localeCompare(b.f));
  return scored.slice(0, limit).map((x) => x.f);
}
