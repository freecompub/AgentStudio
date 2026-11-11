// Converti en JavaScript le 2026-10-10 depuis extensions/skraft-workflow/src/adr.ts (ADR 0055).
const SECTIONS = ["Contexte", "Décision", "Conséquences", "Alternatives"];
const pad = (n) => String(n).padStart(3, "0");
export const adrId = (n) => `ADR-${pad(n)}`;
export function slugify(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
export const adrPath = (n, title) => `docs/adr/adr-${pad(n)}-${slugify(title)}.md`;
export function validateAdrInput(i) {
  const errors = [];
  for (const k of ["title", "context", "decision", "consequences", "alternatives"])
    if (!i[k]?.trim())
      errors.push(`Champ obligatoire vide : ${k}`);
  if (i.status !== "Proposed")
    errors.push("Un nouvel ADR est toujours au statut Proposed");
  for (const s of i.supersedes ?? [])
    if (!/^ADR-\d{3,}$/.test(s))
      errors.push(`Remplacement mal formé : ${s} (attendu ADR-NNN)`);
  return errors;
}
export function renderAdr(n, i, date) {
  return [
    `# ${adrId(n)} — ${i.title.trim()}`,
    "",
    `- Statut : ${i.status}`,
    `- Date : ${date}`,
    ...(i.supersedes?.length ? [`- Remplace : ${i.supersedes.join(", ")}`] : []),
    "",
    "## Contexte",
    "",
    i.context.trim(),
    "",
    "## Décision",
    "",
    i.decision.trim(),
    "",
    "## Conséquences",
    "",
    i.consequences.trim(),
    "",
    "## Alternatives",
    "",
    i.alternatives.trim(),
    "",
  ].join("\n");
}
export function parseAdr(md) {
  const h = /^#\s+ADR-(\d+)\s*[—–:-]\s*(.+?)\s*$/m.exec(md);
  const status = /^-\s*Statut\s*:\s*(\S+)/m.exec(md)?.[1] ?? "";
  const supersedes = (/^-\s*Remplace\s*:\s*(.+)$/m.exec(md)?.[1] ?? "").split(/[,\s]+/).filter((x) => /^ADR-\d+$/.test(x));
  const missing = SECTIONS.filter((s) => !new RegExp(`^##\\s+${s}\\s*$`, "m").test(md));
  const number = h ? Number(h[1]) : NaN;
  return { number, id: h ? adrId(number) : "", title: h?.[2] ?? "", status, supersedes, missing };
}
/** Nom de fichier d'un ADR selon la convention skraft : `docs/adr/adr-NNN-titre.md`. */
const FICHIER_ADR = /^docs\/adr\/adr-(\d{3,})-[^/]+\.md$/;
/**
 * Le numéro d'un ADR, même hors convention skraft : titre « # ADR-NNN — », « # ADR NNNN — », ou nom
 * de fichier `NNNN-titre.md` (les ADR d'un projet qui a sa propre convention). NaN s'il n'en porte pas.
 */
export function numeroAdr(path, md) {
  const t = /^#\s+ADR[\s_-]*(\d+)\b/im.exec(md);
  const f = /^(?:adr[-_]?)?(\d+)[-_.]/i.exec(path.split("/").at(-1) ?? "");
  return Number(t?.[1] ?? f?.[1] ?? NaN);
}
/** L'ADR suit la convention skraft : nom `adr-NNN-titre.md` et titre « # ADR-NNN — Titre », même numéro. */
export function suitLaConvention(path, adr) {
  const m = FICHIER_ADR.exec(path);
  return !!adr.id && !!m && Number(m[1]) === adr.number;
}
/** Ce que la convention attend pour le numéro n, à dire à l'architecte. */
export const conventionAdr = (n) => `fichier attendu docs/adr/adr-${pad(n)}-<titre>.md, titre attendu « # ${adrId(n)} — <Titre> »`;
/**
 * Numérotation des ADR, calculée par le code (11/11) : le prochain numéro suit tous les ADR de
 * `docs/adr/`, quel que soit leur format ; les numéros « pris » sont ceux des ADR qui ne sont pas
 * de cette story, que l'architecte ne doit pas réécrire.
 */
export function numerotationAdrs(adrs, slug) {
  const avecNumero = adrs.map((a) => ({ ...a, n: numeroAdr(a.path, a.md) })).filter((a) => Number.isFinite(a.n));
  const pris = [...new Set(avecNumero.filter((a) => storyDe(a.md) !== slug).map((a) => a.n))].sort((x, y) => x - y);
  return { prochain: nextAdrNumber(avecNumero.map((a) => a.n)), pris };
}
/** La ligne du dossier de passation de l'architecte qui décide. */
export function ligneNumerotation({ prochain, pris }) {
  const ligne = `Numérotation des ADR, calculée par le code : ton prochain ADR est ${adrId(prochain)} (docs/adr/adr-${pad(prochain)}-<titre>.md), puis ${adrId(prochain + 1)}, et ainsi de suite.`;
  return pris.length ? `${ligne} Les numéros des autres ADR du projet (${pris.length}, jusqu'à ${adrId(pris.at(-1))}) sont pris : tu ne peux pas les écrire.` : ligne;
}
/** Les numéros pris, en motifs interdits en écriture pendant le tour de l'architecte. */
export const motifsNumerosPris = (pris) => pris.map((n) => `docs/adr/adr-${pad(n)}-*.md`);
export function nextAdrNumber(existing) {
  return existing.length ? Math.max(...existing) + 1 : 1;
}
/** Bascule le statut (ratification) : seule la ligne « Statut » change. */
export function setAdrStatus(md, status) {
  return md.replace(/^(-\s*Statut\s*:\s*)\S+/m, `$1${status}`);
}
/** Ligne du registre des remplacements (`docs/adr/supersessions.md`). */
export const supersessionLine = (by, replaced) => `- ${by} remplace ${replaced}`;
export function parseSupersessions(md) {
  return [...md.matchAll(/^-\s*(ADR-\d+)\s+remplace\s+(ADR-\d+)\s*$/gm)].map((m) => ({ by: m[1], replaced: m[2] }));
}
/** Registre des remplacements d'ADR, tenu par l'architecte. */
export const SUPERSESSIONS = "docs/adr/supersessions.md";
/**
 * Rattachement d'un ADR à sa story (ADR 0055, point 7) : une ligne `- Story : <slug>` dans
 * l'en-tête, écrite par le code, jamais par l'agent. Elle tient après un arrêt et une reprise,
 * puisqu'elle se lit dans le fichier.
 */
export function storyDe(md) {
  return /^-\s*Story\s*:\s*(\S+)\s*$/m.exec(md)?.[1] ?? null;
}
/** Ajoute la ligne `Story` après les autres lignes de l'en-tête (Statut, Date, Remplace…). */
export function avecStory(md, slug) {
  if (storyDe(md) !== null) return md;
  const lignes = md.split("\n");
  let i = lignes.findIndex((l) => /^-\s*Statut\s*:/.test(l));
  if (i < 0) return md;
  while (i + 1 < lignes.length && /^-\s*\S/.test(lignes[i + 1])) i++;
  lignes.splice(i + 1, 0, `- Story : ${slug}`);
  return lignes.join("\n");
}

