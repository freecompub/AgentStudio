/**
 * ADR du projet cible (SPEC-skraft §6.2, §6.5) : `docs/adr/adr-NNN-<slug>.md`, rédigés uniquement par
 * l'outil `render_adr` (gabarit propre à agent-studio, ADR 0012). Fonctions pures.
 */
export type AdrStatus = "Proposed" | "Accepted" | "Rejected";

export interface AdrInput {
  number?: number;
  title: string;
  status: string;
  context: string;
  decision: string;
  consequences: string;
  alternatives: string;
  supersedes?: string[];
}

export interface ParsedAdr {
  number: number;
  id: string;
  title: string;
  status: string;
  supersedes: string[];
  /** Sections obligatoires absentes. */
  missing: string[];
}

const SECTIONS = ["Contexte", "Décision", "Conséquences", "Alternatives"] as const;
const pad = (n: number) => String(n).padStart(3, "0");
export const adrId = (n: number) => `ADR-${pad(n)}`;

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export const adrPath = (n: number, title: string) => `docs/adr/adr-${pad(n)}-${slugify(title)}.md`;

export function validateAdrInput(i: AdrInput): string[] {
  const errors: string[] = [];
  for (const k of ["title", "context", "decision", "consequences", "alternatives"] as const) if (!i[k]?.trim()) errors.push(`Champ obligatoire vide : ${k}`);
  if (i.status !== "Proposed") errors.push("Un nouvel ADR est toujours au statut Proposed");
  for (const s of i.supersedes ?? []) if (!/^ADR-\d{3,}$/.test(s)) errors.push(`Remplacement mal formé : ${s} (attendu ADR-NNN)`);
  return errors;
}

export function renderAdr(n: number, i: AdrInput, date: string): string {
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

export function parseAdr(md: string): ParsedAdr {
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
export function numeroAdr(path: string, md: string): number {
  const t = /^#\s+ADR[\s_-]*(\d+)\b/im.exec(md);
  const f = /^(?:adr[-_]?)?(\d+)[-_.]/i.exec(path.split("/").at(-1) ?? "");
  return Number(t?.[1] ?? f?.[1] ?? NaN);
}
/** L'ADR suit la convention skraft : nom `adr-NNN-titre.md` et titre « # ADR-NNN — Titre », même numéro. */
export function suitLaConvention(path: string, adr: Pick<ParsedAdr, "id" | "number">): boolean {
  const m = FICHIER_ADR.exec(path);
  return !!adr.id && !!m && Number(m[1]) === adr.number;
}
/** Ce que la convention attend pour le numéro n, à dire à l'architecte. */
export const conventionAdr = (n: number) => `fichier attendu docs/adr/adr-${pad(n)}-<titre>.md, titre attendu « # ${adrId(n)} — <Titre> »`;
export function nextAdrNumber(existing: number[]): number {
  return existing.length ? Math.max(...existing) + 1 : 1;
}

/** Bascule le statut (ratification) : seule la ligne « Statut » change. */
export function setAdrStatus(md: string, status: AdrStatus): string {
  return md.replace(/^(-\s*Statut\s*:\s*)\S+/m, `$1${status}`);
}

/** Ligne du registre des remplacements (`docs/adr/supersessions.md`). */
export const supersessionLine = (by: string, replaced: string) => `- ${by} remplace ${replaced}`;

export function parseSupersessions(md: string): { by: string; replaced: string }[] {
  return [...md.matchAll(/^-\s*(ADR-\d+)\s+remplace\s+(ADR-\d+)\s*$/gm)].map((m) => ({ by: m[1]!, replaced: m[2]! }));
}
