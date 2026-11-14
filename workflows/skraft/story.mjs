// Converti en JavaScript le 2026-10-10 depuis extensions/skraft-workflow/src/story.ts (ADR 0055).
import { sha256Hex } from "./sha256.mjs";
const HEADING = /^#\s+([A-Za-z][\w-]*-\d+)\s*[—–-]\s*(.+?)\s*$/m;
function section(md, title) {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^##\s+/.test(l) && title.test(l));
  if (start === -1)
    return null;
  const end = lines.findIndex((l, i) => i > start && /^##?\s+/.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}
const UNIT = String.raw `(?:\s?(?:%|[A-Za-zµ]{1,4}(?:\/[A-Za-z]{1,4})?)(?![\wÀ-ÿ]))?`;
const NUMBER = new RegExp(String.raw `(?<![\w.,])\d+(?:[.,]\d+)?${UNIT}`, "g");
const QUOTED = /«\s*([^»]+?)\s*»|"([^"]+)"|“([^”]+)”/g;
/** Littéraux d'un texte : chaînes entre guillemets (entières), puis nombres hors de ces chaînes. */
const REFERENCE = /\bADR[\s-]?\d+|#\d+/gi;
export function extractLiterals(text) {
  const found = [];
  const masked = text.replace(QUOTED, (m, a, b, c, offset) => {
    found.push({ at: offset, value: (a ?? b ?? c ?? "").replace(/\s+/g, " ").trim() });
    return " ".repeat(m.length);
  });
  // Une référence (« ADR 0069 », « ADR-069 », « #32 ») n'est pas une valeur à tester (ADR 0080).
  for (const m of masked.replace(REFERENCE, (r) => " ".repeat(r.length)).matchAll(NUMBER)) {
    // Un « à », « de »… n'est pas une unité : seules les suites de lettres courtes suivies d'une frontière comptent.
    const value = m[0].trim();
    const unit = value.replace(/^\d+(?:[.,]\d+)?\s?/, "");
    const keep = unit === "" || /^(%|[A-Zµ][A-Za-z]{0,3}|[a-z]{1,3}(?:\/[A-Za-z]{1,4})|mg|ml|mL|kg|g|h|min|s|ms|km|m|cm|mm)$/.test(unit);
    found.push({ at: m.index ?? 0, value: keep ? value : value.replace(/\s?\D+$/, "") });
  }
  return found.sort((x, y) => x.at - y.at).map((f) => f.value);
}
/** Forme comparable d'un littéral : séparateur décimal « . », espaces normalisés (§7.3). */
export function normalizeLiteral(s) {
  return s
    .replace(/[   ]/g, " ")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/\s+/g, " ")
    .trim();
}
/**
* Slug d'une story (13/11) : le préfixe et le numéro de son identifiant, puis les 8 premiers caractères
* du sha256 de son titre. La même story garde son slug d'un run à l'autre, donc sa branche et son
* dossier : un run relancé les retrouve. Un autre titre est une autre story.
*/
export function slugOf(id, titre) {
  const m = /^(.*?)[^A-Za-z0-9]*(\d+)$/.exec(id.trim());
  const prefixe = (m ? m[1] : id).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const numero = m ? m[2].padStart(2, "0") : "";
  return `${prefixe}${numero}-${sha256Hex(titre.trim().replace(/\s+/g, " ")).slice(0, 8)}`;
}
export function parseStory(md) {
  const errors = [];
  const h = HEADING.exec(md);
  if (!h)
    errors.push("Titre attendu « # <IDENTIFIANT> — <titre> » : identifiant absent (ex. US-12).");
  const criteriaText = section(md, /crit[èe]res d'acceptation/i) ?? "";
  const criteria = [];
  for (const m of criteriaText.matchAll(/^\s*(\d+)\.\s+(.+)$/gm)) {
    const text = m[2].trim();
    criteria.push({ n: Number(m[1]), text, literals: extractLiterals(text) });
  }
  if (criteria.length === 0)
    errors.push("Aucun critère d'acceptation numéroté (section « Critères d'acceptation »).");
  if (errors.length)
    return { ok: false, errors };
  const afterTitle = md.slice((h.index ?? 0) + h[0].length);
  const statement = (afterTitle.split(/^##\s+/m)[0] ?? "").trim();
  const questions = section(md, /questions ouvertes/i) ?? "";
  const openQuestions = [...questions.matchAll(/^\s*[-*]\s+(.+)$/gm)].map((m) => m[1].trim()).filter(Boolean);
  return { ok: true, story: { id: h[1], title: h[2], statement, criteria, openQuestions } };
}
