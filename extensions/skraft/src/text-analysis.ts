/** Analyses de texte utilisées par les portes : citations (§7.1) et identifiants de conception (§7.2). */
export interface PathCitation {
  path: string;
  start?: number;
  end?: number;
}

const PATH = /(?<![\w/.:-])((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,9})(?::(\d+)(?:-(\d+))?)?(?![\w/])/g;
const URL_RE = /\bhttps?:\/\/[^\s)`>\]]+/g;

/** Chemins cités (`chemin/fichier.ext` ou `chemin:12-40`) et URL d'un document de recherche. */
export function parseCitations(md: string): { paths: PathCitation[]; urls: string[] } {
  const urls = [...md.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;:]+$/, ""));
  const withoutUrls = md.replace(URL_RE, " ");
  const paths: PathCitation[] = [];
  const seen = new Set<string>();
  for (const m of withoutUrls.matchAll(PATH)) {
    const path = m[1]!;
    if (/^\d+(\.\d+)+$/.test(path)) continue; // numéro de version
    if (!/[A-Za-z]/.test(path.split(".").at(-1) ?? "")) continue;
    const c: PathCitation = { path };
    if (m[2]) {
      c.start = Number(m[2]);
      c.end = Number(m[3] ?? m[2]);
    }
    const key = `${c.path}:${c.start ?? ""}-${c.end ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(c);
  }
  return { paths, urls };
}

const PASCAL = /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b/g;

/**
 * Identifiants `PascalCase` présents **n'importe où dans du code** : blocs délimités par ```, et
 * segments entre backticks quel que soit leur contenu (`Taux.AppliqueA(x)`). Sert à savoir quels
 * noms un document DÉFINIT : un modèle déclare ses méthodes en signatures et en appels, pas en
 * noms isolés. N'en tirer que les `Nom` seuls a fait rejeter trois fois une conception correcte.
 */
export function extractCodeIdentifiers(md: string): string[] {
  const out = new Set<string>();
  const fences = /```[^\n]*\n([\s\S]*?)```/g;
  for (const m of md.matchAll(fences)) for (const id of m[1]!.match(PASCAL) ?? []) out.add(id);
  for (const m of md.replace(fences, "").matchAll(/`([^`\n]+)`/g)) for (const id of m[1]!.match(PASCAL) ?? []) out.add(id);
  return [...out];
}

/**
 * Identifiants `PascalCase` des seuls blocs délimités par ``` : les signatures qu'un contrat
 * déclare, sans les noms cités en passant dans le texte ou entre backticks (ADR 0047).
 */
export function fencedIdentifiers(md: string): string[] {
  const out = new Set<string>();
  // Tout identifiant capitalisé, d'un seul mot compris (`Montant`, `Soustrait`) : PASCAL, qui exige
  // un mot composé, laisserait passer exactement les noms qu'une correction supprimerait.
  for (const m of md.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) for (const id of m[1]!.match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? []) out.add(id);
  return [...out];
}

/** Identifiants `PascalCase` entre backticks (convention imposée aux documents de conception). */
export function extractPascalIdentifiers(md: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(/`([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+)`/g)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}
