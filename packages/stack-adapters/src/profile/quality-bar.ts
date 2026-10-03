/**
 * Barre de qualité du projet (ADR 0049) : `.agent-studio/quality.yaml`. PUR.
 *
 * Elle dit **ce qui est exigé** — seuils de couverture et de mutation par couche, ce qu'est le cœur
 * (domaine, application), si l'on mute, règles de dépendance. `stack.yaml` dit **comment** lancer
 * les outils : une commande y est vérifiée contre les programmes autorisés et son écriture confirmée
 * par l'utilisateur ; la barre ne lance rien. Elle est commune aux extensions (skraft, tdd).
 *
 * Le cœur se définit par des **chemins**, plus par des noms de couches : `Domain` comme segment ne
 * reconnaissait pas `Tarification.Domaine`, et tout le domaine passait au seuil du reste (03/10).
 */
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { matchesAnyIgnoringCase } from "../glob.js";
import type { DependencyRule } from "../protocols.js";

export type Layer = "domain" | "application" | "rest";

export interface QualityBar {
  core: { domain: string[]; application: string[] };
  /** Aucun seuil par défaut : sans déclaration, la couverture est un fait rapporté, pas exigé. */
  coverage: Partial<Record<Layer, number>>;
  mutation: { active: boolean; domain: number; application: number; rest: number; moment: "phase-end" | "scenario" };
  dependencyRules: DependencyRule[];
}

export type QualityBarSource = ".agent-studio/quality.yaml" | ".skraft/quality.json" | "défaut";

/** Noms usuels des couches, français compris, seuls ou préfixés (`Tarification.Domaine`). */
const DEFAULT_CORE = {
  domain: ["**/Domain/**", "**/Domaine/**", "**/*.Domain/**", "**/*.Domaine/**"],
  application: ["**/Application/**", "**/*.Application/**"],
};
const DEFAULT_MUTATION = { active: true, domain: 100, application: 100, rest: 90, moment: "phase-end" as const };

const seuil = z.number().min(0).max(100);
const schema = z
  .object({
    coeur: z.object({ domaine: z.array(z.string().min(1)).optional(), application: z.array(z.string().min(1)).optional() }).strict().optional(),
    couverture: z.object({ domaine: seuil.optional(), application: seuil.optional(), reste: seuil.optional() }).strict().optional(),
    mutation: z
      .object({
        active: z.boolean().optional(),
        domaine: seuil.optional(),
        application: seuil.optional(),
        reste: seuil.optional(),
        moment: z.enum(["fin-de-phase", "scenario"]).optional(),
      })
      .strict()
      .optional(),
    dependances: z.array(z.object({ module: z.string().min(1), interdits: z.array(z.string().min(1)) }).strict()).optional(),
  })
  .strict();

/** Ancien format, `.skraft/quality.json` (SPEC-skraft §7.4), relu le temps de la transition. */
const legacySchema = z.object({
  coverage: z.object({ core: seuil.optional(), edge: seuil.optional() }).optional(),
  mutation: z.object({ coreLayers: z.array(z.string()).optional(), core: seuil.optional(), edge: seuil.optional() }).optional(),
  dependencyRules: z.array(z.object({ module: z.string(), forbidden: z.array(z.string()) })).optional(),
});

const issues = (file: string, e: z.ZodError) => `\`${file}\` invalide : ${e.issues.map((i) => `${i.path.join(".") || "(racine)"} ${i.message}`).join("; ")}`;
/** Seuils déclarés seulement : une clé absente n'est pas exigée, elle ne vaut pas `undefined`. */
const defined = (o: Record<Layer, number | undefined>): Partial<Record<Layer, number>> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<Record<Layer, number>>;

/**
 * Barre du projet : le nouveau fichier s'il existe, sinon l'ancien (converti, avec un avertissement),
 * sinon les valeurs par défaut. Une clé inconnue ou un seuil hors bornes est **refusé**, jamais
 * ignoré : une barre mal écrite qu'on appliquerait à moitié attesterait d'une exigence qu'elle n'a pas.
 */
export function parseQualityBar(files: { yaml?: string | null; legacyJson?: string | null }):
  | {
      bar: QualityBar;
      source: QualityBarSource;
      warnings: string[];
      /** Couches du cœur que le projet a déclarées lui-même ; les noms usuels par défaut n'en font pas partie. */
      declaredCore: ("domaine" | "application")[];
    }
  | { error: string } {
  if (files.yaml != null) {
    let data: unknown;
    try {
      data = parseYaml(files.yaml) ?? {};
    } catch (err) {
      return { error: `\`.agent-studio/quality.yaml\` n'est pas du YAML valide : ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` };
    }
    const r = schema.safeParse(data);
    if (!r.success) return { error: issues(".agent-studio/quality.yaml", r.error) };
    const q = r.data;
    return {
      source: ".agent-studio/quality.yaml",
      warnings: [],
      declaredCore: [...(q.coeur?.domaine ? ["domaine" as const] : []), ...(q.coeur?.application ? ["application" as const] : [])],
      bar: {
        core: { domain: q.coeur?.domaine ?? DEFAULT_CORE.domain, application: q.coeur?.application ?? DEFAULT_CORE.application },
        coverage: defined({ domain: q.couverture?.domaine, application: q.couverture?.application, rest: q.couverture?.reste }),
        mutation: {
          active: q.mutation?.active ?? DEFAULT_MUTATION.active,
          domain: q.mutation?.domaine ?? DEFAULT_MUTATION.domain,
          application: q.mutation?.application ?? DEFAULT_MUTATION.application,
          rest: q.mutation?.reste ?? DEFAULT_MUTATION.rest,
          moment: q.mutation?.moment === "scenario" ? "scenario" : "phase-end",
        },
        dependencyRules: (q.dependances ?? []).map((d) => ({ module: d.module, forbidden: d.interdits })),
      },
    };
  }
  if (files.legacyJson != null) {
    let data: unknown;
    try {
      data = JSON.parse(files.legacyJson);
    } catch {
      return { error: "`.skraft/quality.json` n'est pas du JSON valide." };
    }
    const r = legacySchema.safeParse(data);
    if (!r.success) return { error: issues(".skraft/quality.json", r.error) };
    const q = r.data;
    const layers = q.mutation?.coreLayers;
    const globsOf = (names: string[]) => names.flatMap((n) => [`**/${n}/**`, `**/*.${n}/**`]);
    const core = layers
      ? { domain: globsOf(layers.filter((l) => l.toLowerCase() !== "application")), application: globsOf(layers.filter((l) => l.toLowerCase() === "application")) }
      : DEFAULT_CORE;
    return {
      source: ".skraft/quality.json",
      declaredCore: [],
      warnings: ["Barre de qualité lue à l'ancien emplacement `.skraft/quality.json` : déplacez-la vers `.agent-studio/quality.yaml` (ADR 0049)."],
      bar: {
        core,
        coverage: defined({ domain: q.coverage?.core, application: q.coverage?.core, rest: q.coverage?.edge }),
        mutation: {
          ...DEFAULT_MUTATION,
          ...defined({ domain: q.mutation?.core, application: q.mutation?.core, rest: q.mutation?.edge }),
        },
        dependencyRules: q.dependencyRules ?? [],
      },
    };
  }
  return { source: "défaut", warnings: [], declaredCore: [], bar: { core: DEFAULT_CORE, coverage: {}, mutation: { ...DEFAULT_MUTATION }, dependencyRules: [] } };
}

/** Couche d'un fichier selon la barre ; insensible à la casse, comme l'étaient les noms de couches. */
export function layerOf(path: string, bar: QualityBar): Layer {
  if (matchesAnyIgnoringCase(bar.core.domain, path)) return "domain";
  if (matchesAnyIgnoringCase(bar.core.application, path)) return "application";
  return "rest";
}

/**
 * Couches du cœur dont les chemins ne correspondent à aucun fichier du projet : le seuil du reste
 * s'appliquerait en silence à un code qu'on croit être le cœur. Le dire, c'est tout l'intérêt.
 */
export function coreFilesMissing(
  bar: QualityBar,
  files: readonly string[],
  layers: readonly ("domaine" | "application")[] = ["domaine", "application"],
): ("domaine" | "application")[] {
  const out: ("domaine" | "application")[] = [];
  if (layers.includes("domaine") && bar.core.domain.length && !files.some((f) => matchesAnyIgnoringCase(bar.core.domain, f))) out.push("domaine");
  if (layers.includes("application") && bar.core.application.length && !files.some((f) => matchesAnyIgnoringCase(bar.core.application, f))) out.push("application");
  return out;
}
