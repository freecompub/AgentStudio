import { join } from "node:path";
import { globToRegExp } from "./glob.js";
import type { ArchitectureReport, FormatReport, LintReport, MutationReport, StackAdapter, StackLayout, TestRun } from "./protocols.js";

/**
 * Adaptateur composé (ADR 0074) : les composants d'un projet — une API .NET et un front React, par
 * exemple — derrière le même port `StackAdapter`. Les portes de l'extension et du workflow n'en
 * savent rien. Chaque composant travaille dans sa racine, avec ses chemins à lui ; d'ici, tout est
 * ramené à la racine du projet, et les identifiants de tests sont préfixés par la racine du composant
 * pour qu'ils ne se confondent pas d'un composant à l'autre.
 */
export interface Composant {
  nom: string;
  /** Relative à la racine du projet, sans `./` ni `/` final ; `.` pour la racine elle-même. */
  racine: string;
  adapter: StackAdapter;
}

export function createComposedAdapter(composants: readonly Composant[]): StackAdapter {
  const vers = (c: Composant, p: string) => (c.racine === "." ? p : `${c.racine}/${p}`);
  const depuis = (c: Composant, p: string) => (c.racine === "." ? p : p.startsWith(`${c.racine}/`) ? p.slice(c.racine.length + 1) : null);
  const racineDe = (root: string, c: Composant) => (c.racine === "." ? root : join(root, c.racine));
  /** Le composant qui contient ce chemin, et le chemin relatif à sa racine ; hors de tout composant, null. */
  const contenant = (p: string): { c: Composant; rel: string } | null => {
    for (const c of composants) {
      const rel = depuis(c, p);
      if (rel !== null) return { c, rel };
    }
    return null;
  };
  /** Fichiers demandés, répartis par composant, relatifs à sa racine ; ceux hors de tout composant sont écartés. */
  const parComposant = (files: readonly string[] | undefined) =>
    composants.map((c) => ({ c, files: (files ?? []).map((f) => depuis(c, f)).filter((f): f is string => f !== null) }));
  const avec = <K extends "lint" | "format" | "mutation" | "architecture">(k: K) => composants.filter((c) => c.adapter[k]);
  const reunir = (cle: keyof StackLayout) => composants.flatMap((c) => c.adapter.layout[cle].map((g) => vers(c, g)));
  const layout: StackLayout = { acceptanceTests: reunir("acceptanceTests"), unitTests: reunir("unitTests"), sources: reunir("sources") };
  const motifsDeTests = [...layout.unitTests, ...layout.acceptanceTests];

  return {
    // L'identifiant du port reste fermé : celui du premier composant, comme le fait un profil.
    id: composants[0]!.adapter.id,
    layout,
    // Couples BDD des composants (ADR 0074), ramenés à la racine du projet.
    ...(composants.some((c) => c.adapter.bdd)
      ? { bdd: composants.flatMap((c) => (c.adapter.bdd ?? []).map((b) => ({ ...b, features: vers(c, b.features), etapes: vers(c, b.etapes) }))) }
      : {}),
    ...(composants.some((c) => c.adapter.bddNonDecide) ? { bddNonDecide: composants.flatMap((c) => (c.adapter.bddNonDecide ?? []).map((r) => (r === "." ? c.racine : vers(c, r)))) } : {}),
    infrastructureModules: [...new Set(composants.flatMap((c) => c.adapter.infrastructureModules))],
    async detect(root) {
      for (const c of composants) if (await c.adapter.detect(racineDe(root, c))) return true;
      return false;
    },
    isTestFile(p) {
      const k = contenant(p);
      return k ? k.c.adapter.isTestFile(k.rel) : false;
    },
    // Transmis à un autre processus : tiré des emplacements de tests, ramenés à la racine du projet.
    testFilePattern: motifsDeTests.length ? motifsDeTests.map((g) => globToRegExp(g).source).join("|") : "(?!)",

    async runTests(opts) {
      const runs: TestRun[] = [];
      for (const c of composants) runs.push(await c.adapter.runTests({ ...opts, root: racineDe(opts.root, c) }));
      const prefixe = (c: Composant) => (c.racine === "." ? "" : `${c.racine}: `);
      const exitCodes = runs.map((r) => r.exitCode);
      const couverture = runs.flatMap((r, i) => (r.coverage?.files ?? []).map((f) => ({ ...f, file: vers(composants[i]!, f.file) })));
      return {
        results: runs.flatMap((r, i) => r.results.map((x) => ({ ...x, id: `${prefixe(composants[i]!)}${x.id}`, file: vers(composants[i]!, x.file) }))),
        exitCode: exitCodes.includes(null) ? null : (exitCodes.find((x) => x !== 0) ?? 0),
        timedOut: runs.some((r) => r.timedOut),
        output: runs.map((r, i) => `── ${composants[i]!.nom} ──\n${r.output}`).join("\n"),
        durationMs: runs.reduce((n, r) => n + r.durationMs, 0),
        ...(runs.some((r) => r.coverage) ? { coverage: { files: couverture } } : {}),
      };
    },

    ...(avec("lint").length
      ? {
          async lint(opts): Promise<LintReport> {
            const rapports: { c: Composant; r: LintReport }[] = [];
            for (const { c, files } of parComposant(opts.files)) {
              if (!files.length || !c.adapter.lint) continue;
              rapports.push({ c, r: await c.adapter.lint({ ...opts, root: racineDe(opts.root, c), files }) });
            }
            const dispo = rapports.filter((x) => x.r.available);
            if (!dispo.length) return { available: false, violations: [] };
            return {
              available: true,
              tool: [...new Set(dispo.map((x) => x.r.tool).filter(Boolean))].join(", "),
              analyzed: dispo.flatMap(({ c, r }) => (r.analyzed ?? []).map((f) => vers(c, f))),
              violations: dispo.flatMap(({ c, r }) => r.violations.map((v) => ({ ...v, file: vers(c, v.file) }))),
            };
          },
        }
      : {}),

    ...(avec("format").length
      ? {
          // Tous les composants touchés doivent avoir vérifié leur mise en forme ; sinon, rien n'est attesté.
          async format(opts): Promise<FormatReport> {
            const touches = parComposant(opts.files).filter((x) => x.files.length);
            if (!touches.length || touches.some((x) => !x.c.adapter.format)) return { available: false, ok: false };
            const rapports = [];
            for (const { c, files } of touches) rapports.push({ c, r: await c.adapter.format!({ ...opts, root: racineDe(opts.root, c), files }) });
            if (rapports.some((x) => !x.r.available)) return { available: false, ok: false };
            const echecs = rapports.filter((x) => !x.r.ok);
            const sortie = echecs.map(({ c, r }) => `── ${c.nom} ──\n${r.sortie ?? ""}`).join("\n").trim();
            return { available: true, ok: echecs.length === 0, tool: [...new Set(rapports.map((x) => x.r.tool).filter(Boolean))].join(", "), ...(sortie ? { sortie } : {}) };
          },
        }
      : {}),

    ...(avec("mutation").length
      ? {
          async mutation(opts): Promise<MutationReport> {
            const rapports: { c: Composant; r: MutationReport }[] = [];
            for (const c of avec("mutation")) rapports.push({ c, r: await c.adapter.mutation!({ ...opts, root: racineDe(opts.root, c) }) });
            const files = rapports.flatMap(({ c, r }) => r.files.map((f) => ({ ...f, file: vers(c, f.file) })));
            const poids = rapports.reduce((n, x) => n + Math.max(1, x.r.files.length), 0);
            return { score: rapports.reduce((n, x) => n + x.r.score * Math.max(1, x.r.files.length), 0) / poids, files };
          },
        }
      : {}),

    ...(avec("architecture").length
      ? {
          // Une règle en chemins (`services/api/src/domaine`) est ramenée à la racine de son composant.
          async architecture({ root, rules }): Promise<ArchitectureReport> {
            const rapports: { c: Composant; r: ArchitectureReport }[] = [];
            for (const c of avec("architecture")) {
              const siennes = rules.map((r) => ({ ...r, module: depuis(c, r.module) ?? r.module }));
              rapports.push({ c, r: await c.adapter.architecture!({ root: racineDe(root, c), rules: siennes }) });
            }
            return {
              modules: rapports.flatMap((x) => x.r.modules),
              violations: rapports.flatMap(({ c, r }) => r.violations.map((v) => ({ ...v, file: vers(c, v.file) }))),
            };
          },
        }
      : {}),
  };
}
