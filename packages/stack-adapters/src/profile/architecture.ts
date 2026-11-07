import { readdir, readFile, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import { matchesAny } from "../glob.js";
import type { ArchitectureReport, DependencyRule } from "../protocols.js";
import { LIGNE_MAX, LIGNES_MAX } from "./motif-sur.js";

/**
 * Analyse des imports déclarée par un profil (ADR 0072, point 2). Textuelle, donc approximative :
 * un import en commentaire compte. Le motif vient du dépôt : il est compilé par `compilerMotifSur`
 * à la lecture du profil, et appliqué ligne à ligne, lignes et fichiers bornés.
 */
export interface SectionArchitecture {
  fichiers: string[];
  modules: Record<string, string[]>;
}

/** Au-delà, ce n'est pas un fichier de code qu'on écrit à la main : il n'est pas lu. */
const TAILLE_MAX = 1_000_000;
/** Fichiers examinés au plus. */
const FICHIERS_MAX = 20_000;
/** Dépendances installées et dossiers cachés (`.git`, caches) : jamais du code du projet. */
const IGNORES = new Set(["node_modules", "bin", "obj", "target", "dist", "vendor"]);

export async function analyserImports(section: SectionArchitecture, re: RegExp, root: string, rules: DependencyRule[]): Promise<ArchitectureReport> {
  const modules = new Map<string, Set<string>>();
  const violations: ArchitectureReport["violations"] = [];
  for (const fichier of (await fichiersDuProjet(root)).filter((f) => matchesAny(section.fichiers, f)).sort()) {
    const module = Object.entries(section.modules).find(([, globs]) => matchesAny(globs, fichier))?.[0];
    if (!module) continue;
    const imports = modules.get(module) ?? new Set<string>();
    modules.set(module, imports);
    const visees = rules.filter((r) => r.module === module || fichier.startsWith(`${r.module.replace(/\/+$/, "")}/`));
    for (const importe of await importsDe(join(root, fichier), fichier, re)) {
      imports.add(importe);
      if (visees.some((r) => r.forbidden.some((x) => interdit(importe, x)))) violations.push({ module, file: fichier, imported: importe });
    }
  }
  return {
    modules: [...modules].sort(([a], [b]) => a.localeCompare(b)).map(([name, imports]) => ({ name, imports: [...imports].sort() })),
    violations,
  };
}

/**
 * Un import enfreint un interdit s'il lui est égal, s'il commence par lui suivi de `.`, `/` ou `:`,
 * ou si l'un de ses segments lui est égal (`Tarification.Infrastructure.Db` enfreint
 * `Infrastructure`). Jamais par simple sous-chaîne : `Infra` n'est pas `Infrastructure`.
 */
export function interdit(importe: string, x: string): boolean {
  if (importe === x || (importe.startsWith(x) && /^[./:]/.test(importe.slice(x.length)))) return true;
  return importe.split(/[./:\\]+/).includes(x);
}

async function importsDe(absolu: string, fichier: string, re: RegExp): Promise<string[]> {
  const s = await stat(absolu).catch(() => null);
  if (!s?.isFile() || s.size > TAILLE_MAX) return [];
  const out: string[] = [];
  for (const ligne of (await readFile(absolu, "utf8").catch(() => "")).split("\n", LIGNES_MAX)) {
    if (ligne.length > LIGNE_MAX) continue;
    const brut = re.exec(ligne)?.groups?.["module"]?.trim();
    if (!brut) continue;
    // Import relatif : résolu depuis le fichier, pour qu'une règle en chemins (`src/infrastructure`) le voie.
    const importe = brut.startsWith("./") || brut.startsWith("../") ? posix.normalize(posix.join(posix.dirname(fichier), brut)) : brut;
    if (!out.includes(importe)) out.push(importe);
  }
  return out;
}

/** Fichiers du projet, chemins relatifs, sans dépendances installées ni dossiers cachés. */
async function fichiersDuProjet(root: string): Promise<string[]> {
  const out: string[] = [];
  const parcourir = async (rel: string): Promise<void> => {
    const entrees = await readdir(join(root, rel), { withFileTypes: true }).catch(() => []);
    for (const e of entrees) {
      if (out.length >= FICHIERS_MAX) return;
      if (e.name.startsWith(".") || IGNORES.has(e.name)) continue;
      const chemin = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await parcourir(chemin);
      else if (e.isFile()) out.push(chemin);
    }
  };
  await parcourir("");
  return out;
}
