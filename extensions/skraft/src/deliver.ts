/**
 * Fonctions pures de DELIVER (SPEC-skraft §7.4) : plan des scénarios, séquence rouge puis vert
 * dans les preuves, seuils de mutation par couche, règle de dépendance, Object Calisthenics
 * mesurables. Aucune I/O : les effets leur passent le contenu lu par le code.
 */
import { z } from "zod";
import type { ArchitectureReport, DependencyRule, Evidence, LintReport, MutationReport } from "@agent-studio/extension-api";
import { acOf } from "./distill.js";

export type Granularity = "turn-per-scenario" | "session-per-step";

export interface DeliverScenario {
  id: string;
  ac: number;
  acceptanceTestId: string;
  role: "driver" | "regression";
  status: "pending" | "in_progress" | "done";
  /** Tests unitaires ajoutés pour ce scénario (faits de la revue, §9.1). */
  unitTests?: string[];
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
});
// Les seuils de forme ne figurent plus ici : ils appartiennent à la configuration du linter du
// projet (`.eslintrc`, `.swiftlint.yml`…), seul endroit où ils ne peuvent pas se contredire.

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

// ---------- Qualité de forme : le linter du projet ------------------------------------

/**
 * La qualité de forme — longueur des méthodes, imbrication, nombre d'attributs — est jugée par
 * le linter que le projet a déjà configuré, avec ses propres seuils. Un analyseur maison
 * imposerait une seconde autorité, qui rejetterait du code que la CI du projet accepte, et ne
 * saurait lire que les langages dont on aurait écrit la grammaire.
 *
 * Pas de linter : aucun motif, et la porte le dit au lieu de conclure (voir `deliver-effects`).
 */
export function checkLint(report: LintReport | null): string[] {
  if (!report?.available) return [];
  return report.violations.map(
    (v) => `Lint : ${v.file}${v.line !== undefined ? `:${v.line}` : ""} — ${v.rule} : ${v.message}`,
  );
}
