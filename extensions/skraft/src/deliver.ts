/**
 * Fonctions pures de DELIVER (SPEC-skraft §7.4) : plan des scénarios, séquence rouge puis vert
 * dans les preuves, seuils de mutation par couche, règle de dépendance, Object Calisthenics
 * mesurables. Aucune I/O : les effets leur passent le contenu lu par le code.
 */
import { z } from "zod";
import type { ArchitectureReport, DependencyRule, Evidence, MutationReport } from "@agent-studio/extension-api";
import { acOf } from "./distill.js";

export type Granularity = "turn-per-scenario" | "session-per-step";

export interface DeliverScenario {
  id: string;
  ac: number;
  acceptanceTestId: string;
  role: "driver" | "regression";
  status: "pending" | "in_progress" | "done";
}

/**
 * Scénarios de DELIVER : un par test d'acceptance, dans l'ordre de `impl-plan.md` (première mention
 * de `ac-<n>`), puis les critères non cités par numéro croissant. Les tests requalifiés en
 * non-régression sont déjà faits : ils doivent seulement rester verts.
 */
export function planScenarios(input: { implPlan: string; acceptanceTestIds: string[]; regressions: string[] }): DeliverScenario[] {
  const order: number[] = [];
  for (const m of input.implPlan.matchAll(/@?\bac-(\d+)\b/gi)) {
    const n = Number(m[1]);
    if (!order.includes(n)) order.push(n);
  }
  const rank = (n: number) => (order.includes(n) ? order.indexOf(n) : order.length + n);
  const tests = input.acceptanceTestIds
    .map((id) => ({ id, ac: acOf(id) }))
    .filter((t): t is { id: string; ac: number } => t.ac !== null)
    .sort((a, b) => rank(a.ac) - rank(b.ac) || a.id.localeCompare(b.id));
  const seen = new Map<number, number>();
  return tests.map((t) => {
    const k = (seen.get(t.ac) ?? 0) + 1;
    seen.set(t.ac, k);
    const regression = input.regressions.includes(t.id);
    return {
      id: k === 1 ? `ac-${t.ac}` : `ac-${t.ac}#${k}`,
      ac: t.ac,
      acceptanceTestId: t.id,
      role: regression ? "regression" : "driver",
      status: regression ? "done" : "pending",
    };
  });
}

/** Un résultat désigne-t-il ce test ? (un fichier qui ne compile plus apparaît sous son seul nom). */
export const concerns = (resultId: string, testId: string) => resultId === testId || testId.startsWith(`${resultId} > `) || resultId.startsWith(`${testId} > `);

/** Porte de fin de scénario : au moins un rouge (bonne raison) puis un vert par test unitaire ajouté. */
export function checkRedGreenSequence(evidence: Evidence[], unitTests: string[]): string[] {
  const reasons: string[] = [];
  for (const t of unitTests) {
    const red = evidence.findIndex((e) => e.failing.some((f) => concerns(f.id, t) && (f.failureKind === "assertion" || f.failureKind === "missing_symbol")));
    if (red === -1) {
      reasons.push(`Aucune exécution rouge du test unitaire « ${t} » dans les preuves.`);
      continue;
    }
    const green = evidence.slice(red + 1).some((e) => !e.timedOut && e.testIds.some((id) => concerns(id, t)) && !e.failing.some((f) => concerns(f.id, t)));
    if (!green) reasons.push(`Aucune exécution verte du test unitaire « ${t} » après son rouge dans les preuves.`);
  }
  return reasons;
}

// ---------- barre de qualité (configurable par projet) ---------------------------------

const qualitySchema = z.object({
  mutation: z
    .object({
      /** Couches cœur (seuil strict) : un segment du chemin porte l'un de ces noms. */
      coreLayers: z.array(z.string()).default(["Domain", "Application"]),
      core: z.number().min(0).max(100).default(100),
      edge: z.number().min(0).max(100).default(90),
    })
    .prefault({}),
  dependencyRules: z
    .array(z.object({ module: z.string(), forbidden: z.array(z.string()) }))
    .default([{ module: "Domain", forbidden: ["Infrastructure", "Interface", "UI", "API", "SwiftUI", "UIKit", "AppKit"] }]),
  calisthenics: z
    .object({
      maxMethodLines: z.number().int().min(1).default(20),
      maxIndentation: z.number().int().min(0).default(2),
      maxAttributes: z.number().int().min(0).default(3),
    })
    .prefault({}),
});

export type QualityBar = z.infer<typeof qualitySchema>;

/** Barre de qualité : `.skraft/quality.json` du projet, sinon les valeurs par défaut (§7.4). */
export function parseQualityBar(raw: string | null): { bar: QualityBar } | { error: string } {
  let json: unknown = {};
  if (raw !== null) {
    try {
      json = JSON.parse(raw);
    } catch {
      return { error: "`.skraft/quality.json` n'est pas du JSON valide." };
    }
  }
  const r = qualitySchema.safeParse(json);
  if (!r.success) return { error: `\`.skraft/quality.json\` invalide : ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  return { bar: r.data };
}

const isCore = (path: string, bar: QualityBar) => path.split("/").some((seg) => bar.mutation.coreLayers.some((l) => l.toLowerCase() === seg.toLowerCase()));

/** Seuils de mutation sur les fichiers de production du scénario : 100 % cœur, 90 % bords (par défaut). */
export function checkMutation(report: MutationReport, sources: string[], bar: QualityBar): string[] {
  const reasons: string[] = [];
  for (const path of sources) {
    const f = report.files.find((x) => x.file === path || path.endsWith(`/${x.file}`));
    if (!f) continue; // aucun mutant applicable dans ce fichier
    const threshold = isCore(path, bar) ? bar.mutation.core : bar.mutation.edge;
    if (f.score + 1e-9 < threshold) {
      const survivors = f.survived.map((s) => `ligne ${s.line} (${s.operator})`).join(", ");
      reasons.push(`Mutation : ${path} à ${round(f.score)} % (minimum ${threshold} %)${survivors ? ` ; mutants survivants : ${survivors}` : ""}.`);
    }
  }
  return reasons;
}

const round = (n: number) => Math.round(n * 10) / 10;

export function checkDependencies(report: ArchitectureReport): string[] {
  return report.violations.map((v) => `Règle de dépendance : ${v.file} (module ${v.module}) importe ${v.imported}.`);
}

export const dependencyRules = (bar: QualityBar): DependencyRule[] => bar.dependencyRules;

// ---------- Object Calisthenics mesurables -------------------------------------------

/** Remplace commentaires et chaînes par des espaces, en gardant les retours à la ligne. */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, (m) => m.replace(/[^\n]/g, " "));
}

function matchingBrace(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Profondeur maximale d'accolades à l'intérieur d'un corps (le corps lui-même n'en compte pas). */
function maxDepth(body: string): number {
  let depth = 0;
  let max = 0;
  for (const c of body) {
    if (c === "{") max = Math.max(max, ++depth);
    else if (c === "}") depth--;
  }
  return max;
}

const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "guard", "return", "else", "do", "repeat", "function"]);

interface Unit {
  name: string;
  open: number;
}

function functionsOf(code: string, swift: boolean): Unit[] {
  const out: Unit[] = [];
  const re = swift
    ? /\b(?:func\s+([A-Za-z_]\w*)|(init|deinit))\b[^{};]*?\{/g
    : /(?:\bfunction\s*([A-Za-z_$][\w$]*)?\s*\([^)]*\)[^{;]*?\{|^[ \t]*(?:(?:public|private|protected|static|async|readonly|override|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{;=]+)?\{|=>\s*\{)/gm;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const name = m[1] ?? m[2] ?? "(fonction anonyme)";
    if (KEYWORDS.has(name)) continue;
    // Déclaration sans corps (protocole) : l'accolade trouvée appartient à autre chose.
    if (swift && /\n\s*\n|\bfunc\b|\bvar\b|\blet\b/.test(m[0].slice(4))) continue;
    out.push({ name, open: m.index + m[0].length - 1 });
  }
  return out;
}

function typesOf(code: string, swift: boolean): Unit[] {
  const re = swift ? /\b(?:class|struct|actor)\s+([A-Za-z_]\w*)[^{;]*\{/g : /\bclass\s+([A-Za-z_$][\w$]*)[^{;]*\{/g;
  const out: Unit[] = [];
  for (let m = re.exec(code); m; m = re.exec(code)) out.push({ name: m[1]!, open: m.index + m[0].length - 1 });
  return out;
}

/** Lignes du corps d'un type au premier niveau (hors corps des méthodes et blocs imbriqués). */
function topLevelLines(body: string): string[] {
  const lines: string[] = [];
  let depth = 0;
  let current = "";
  for (const c of body) {
    if (c === "\n") {
      if (depth === 0) lines.push(current);
      current = "";
      continue;
    }
    if (c === "{") {
      if (depth === 0) current += "{";
      depth++;
    } else if (c === "}") depth--;
    else if (depth === 0) current += c;
  }
  if (depth === 0) lines.push(current);
  return lines;
}

function attributesOf(body: string, swift: boolean): number {
  let n = 0;
  for (const line of topLevelLines(body)) {
    const l = line.trim();
    if (swift) {
      // Propriété stockée : `let`/`var` d'instance, sans corps (propriété calculée) ni `static`.
      if (/^(?:@\w+\s+)*(?:(?:public|private|fileprivate|internal|open|final|weak|unowned|lazy)(?:\(set\))?\s+)*(?:let|var)\s+\w+/.test(l) && !/\bstatic\b|\bclass\s+var\b/.test(l) && !l.includes("{"))
        n++;
    } else {
      if (/^(?:(?:public|private|protected|readonly|declare|override)\s+)*#?[A-Za-z_$][\w$]*\s*[?!]?\s*[:=]/.test(l) && !/^\s*static\b/.test(l) && !/^[\w$#]+\s*\(/.test(l)) n++;
      const ctor = /constructor\s*\(([^)]*)\)/.exec(l);
      if (ctor) n += (ctor[1]!.match(/\b(?:public|private|protected|readonly)\s+[A-Za-z_$]/g) ?? []).length;
    }
  }
  return n;
}

/** Object Calisthenics mesurables : longueur des méthodes, niveaux d'indentation, attributs par type. */
export function checkCalisthenics(path: string, source: string, bar: QualityBar): string[] {
  const swift = path.endsWith(".swift");
  if (!swift && !/\.[cm]?tsx?$/.test(path)) return [];
  const { maxMethodLines, maxIndentation, maxAttributes } = bar.calisthenics;
  const code = strip(source);
  const reasons: string[] = [];
  for (const f of functionsOf(code, swift)) {
    const close = matchingBrace(code, f.open);
    if (close === -1) continue;
    const body = code.slice(f.open + 1, close);
    const lines = body.split("\n").filter((l) => l.trim()).length;
    if (lines > maxMethodLines) reasons.push(`${path} : méthode « ${f.name} » de ${lines} lignes (maximum ${maxMethodLines}).`);
    const depth = maxDepth(body);
    if (depth > maxIndentation) reasons.push(`${path} : méthode « ${f.name} » à ${depth} niveaux d'indentation (maximum ${maxIndentation}).`);
  }
  for (const t of typesOf(code, swift)) {
    const close = matchingBrace(code, t.open);
    if (close === -1) continue;
    const count = attributesOf(code.slice(t.open + 1, close), swift);
    if (count > maxAttributes) reasons.push(`${path} : type « ${t.name} » à ${count} attributs (maximum ${maxAttributes}).`);
  }
  return reasons;
}
