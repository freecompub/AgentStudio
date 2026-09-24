import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ArchitectureReport, DependencyRule } from "../protocols.js";

/** Modules importés par un fichier Swift (commentaires et chaînes ignorés). */
export function parseSwiftImports(source: string): string[] {
  const clean = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
  const out: string[] = [];
  const re = /^\s*(?:@\w+\s+)*import\s+(?:(?:typealias|struct|class|enum|protocol|let|var|func)\s+)?([A-Za-z_]\w*)/gm;
  for (let m = re.exec(clean); m; m = re.exec(clean)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

async function swiftFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await swiftFiles(p)));
    else if (e.name.endsWith(".swift")) out.push(p);
  }
  return out;
}

/** Analyse des imports entre modules (dossiers de `Sources/`) et contrôle des règles (§9.7). */
export async function analyzeSwiftImports(root: string, rules: DependencyRule[]): Promise<ArchitectureReport> {
  const sources = join(root, "Sources");
  let moduleDirs: string[];
  try {
    moduleDirs = (await readdir(sources, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return { modules: [], violations: [] };
  }
  const report: ArchitectureReport = { modules: [], violations: [] };
  for (const name of moduleDirs) {
    const imports = new Set<string>();
    const forbidden = new Set(rules.filter((r) => r.module === name).flatMap((r) => r.forbidden));
    for (const file of (await swiftFiles(join(sources, name))).sort()) {
      for (const imported of parseSwiftImports(await readFile(file, "utf8"))) {
        imports.add(imported);
        if (forbidden.has(imported)) report.violations.push({ module: name, file: relative(root, file).replaceAll("\\", "/"), imported });
      }
    }
    report.modules.push({ name, imports: [...imports].sort() });
  }
  return report;
}
