import { randomBytes } from "node:crypto";
import { access, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeProcessRunner } from "../process/node-process-runner.js";
import type { LintReport, ProcessRunner, StackAdapter } from "../protocols.js";
import { parseMuterReport } from "../swift/muter-report.js";
import { compileBuildErrorSpec, readBuildErrors } from "./build-errors.js";
import { parseCoberturaReport } from "../coverage/cobertura-report.js";
import { lireLint, lireTests } from "./read-report.js";
import { substituer } from "./tokens.js";
import { globToRegExp } from "../glob.js";
import type { StackProfile } from "./stack-profile.js";

/**
 * Adaptateur bâti sur un profil déclaratif (J5). Il ne connaît aucun langage : il exécute les
 * commandes que le projet déclare et confie leur sortie au lecteur nommé.
 *
 * Deux jetons sont substitués dans les arguments, et eux seuls : `{rapport}`, remplacé par un
 * fichier temporaire **hors du projet**, et `{fichiers}`, développé en autant d'arguments que de
 * fichiers. Le reste est passé tel quel, sans shell.
 */
export interface ProfileAdapterDeps {
  runner?: ProcessRunner;
  defaultTimeoutMs?: number;
}

const existe = (p: string) => access(p).then(() => true, () => false);

/**
 * Couverture, si le profil déclare un lecteur. Un rapport absent ou illisible rend `undefined` :
 * la porte doit pouvoir dire « non mesurée » plutôt que de conclure à une couverture nulle.
 */
async function lireCouverture(profile: StackProfile, dossier: string, root: string) {
  if (!profile.tests.coverage || !dossier) return undefined;
  // Le rapport est cherché dans l'arborescence : `dotnet test` le range sous un sous-dossier dont
  // il choisit le nom, `vitest` l'écrit à plat. Le premier fichier lisible fait foi.
  for (const chemin of await fichiersXml(dossier)) {
    const brut = await readFile(chemin, "utf8").catch(() => null);
    const lu = brut === null ? null : parseCoberturaReport(brut, root);
    if (lu) return lu;
  }
  return undefined;
}

/** Fichiers `.xml` du dossier, récursivement. Vide si le dossier n'existe pas : rien n'a été écrit. */
async function fichiersXml(dossier: string): Promise<string[]> {
  const entrees = await readdir(dossier, { withFileTypes: true, recursive: true }).catch(() => []);
  return entrees.filter((e) => e.isFile() && e.name.endsWith(".xml")).map((e) => join(e.parentPath, e.name));
}

/** Erreurs de compilation, si le profil dit comment les lire. Le motif est déjà validé à la lecture. */
function erreursDeCompilation(profile: StackProfile, sortie: string, root: string) {
  if (!profile.buildErrors) return [];
  const compile = compileBuildErrorSpec(profile.buildErrors);
  return "error" in compile ? [] : readBuildErrors(sortie, compile.spec, root);
}

export function createProfileAdapter(profile: StackProfile, deps: ProfileAdapterDeps = {}): StackAdapter {
  const runner = deps.runner ?? createNodeProcessRunner();
  const fichierTemporaire = (ext: string) => join(tmpdir(), `agent-studio-${profile.id}-${randomBytes(6).toString("hex")}.${ext}`);
  const motifs = (globs: readonly string[]) => globs.map((g) => globToRegExp(g));
  const testGlobs = [...profile.layout.unitTests, ...profile.layout.acceptanceTests];

  return {
    // L'identifiant du port reste fermé tant que d'autres stacks ne sont pas déclarées ailleurs.
    id: profile.id as StackAdapter["id"],
    layout: profile.layout,
    infrastructureModules: profile.infrastructureModules,
    // `[].join("|")` rend la chaîne vide, et `new RegExp("")` reconnaît TOUT. L'extension
    // reconstruit un RegExp depuis ce motif (extension-host) : un motif vide y ferait de chaque
    // fichier un fichier de test, et la garde d'écriture de la phase rouge n'interdirait plus
    // rien. `(?!)` ne reconnaît jamais rien, ce qui est le repli sûr et s'accorde avec
    // `isTestFile` juste en dessous.
    testFilePattern: testGlobs.length === 0 ? "(?!)" : testGlobs.map((g) => globToRegExp(g).source).join("|"),
    isTestFile: (p) => motifs(testGlobs).some((re) => re.test(p.replaceAll("\\", "/"))),

    async detect(root) {
      for (const f of profile.detect) if (await existe(join(root, f))) return true;
      return false;
    },

    async runTests(opts) {
      const rapport = fichierTemporaire(profile.tests.report === "junit-xml" ? "xml" : "json");
      // Même exécution pour les deux : mesurer la couverture ne doit pas coûter un second passage
      // de toute la suite. L'outil écrit où le profil le lui dit, via `{couverture}`.
      const couverture = profile.tests.coverage ? fichierTemporaire("couverture") : "";
      if (couverture) await mkdir(couverture, { recursive: true });
      const args = substituer(profile.tests.command.slice(1), rapport, [], couverture);
      try {
        const r = await runner.run(profile.tests.command[0]!, args, {
          cwd: opts.root,
          timeoutMs: opts.timeoutMs ?? deps.defaultTimeoutMs ?? 10 * 60_000,
          ...(opts.signal ? { signal: opts.signal } : {}),
          ...(opts.onOutput ? { onOutput: opts.onOutput } : {}),
        });
        const output = `${r.stdout}${r.stderr}`.slice(-20_000);
        if (r.timedOut) return { results: [], exitCode: r.exitCode, timedOut: true, output, durationMs: r.durationMs };
        const brut = await readFile(rapport, "utf8").catch(() => null);
        if (brut === null) {
          // Pas de rapport : sur un langage compilé, c'est le cas normal d'un symbole absent — la
          // compilation s'arrête avant d'exécuter quoi que ce soit. Le profil dit comment lire ces
          // erreurs ; sans cette section, le rouge légitime du pas RED n'atteindrait pas la porte.
          const erreurs = erreursDeCompilation(profile, output, opts.root);
          if (erreurs.length > 0) return { results: erreurs, exitCode: r.exitCode, timedOut: false, output, durationMs: r.durationMs };
          throw new Error(
            `Rapport de tests absent (code ${r.exitCode}) : la commande déclarée écrit-elle bien dans {rapport} ?` +
              `${profile.buildErrors ? "" : " Si ce projet est compilé, déclarez `buildErrors` pour que les erreurs de compilation soient lues."}\n${output.slice(-2000)}`,
          );
        }
        const lu = await lireCouverture(profile, couverture, opts.root);
        return {
          results: lireTests(profile.tests.report, brut, opts.root),
          exitCode: r.exitCode,
          timedOut: false,
          output,
          durationMs: r.durationMs,
          ...(lu ? { coverage: lu } : {}),
        };
      } finally {
        await rm(rapport, { force: true });
        if (couverture) await rm(couverture, { recursive: true, force: true });
      }
    },

    ...(profile.lint
      ? {
          async lint(opts): Promise<LintReport> {
            const c = profile.lint!;
            const args = substituer(c.command.slice(1), "", opts.files ?? []);
            const r = await runner
              .run(c.command[0]!, args, {
                cwd: opts.root,
                timeoutMs: opts.timeoutMs ?? 5 * 60_000,
                ...(opts.signal ? { signal: opts.signal } : {}),
              })
              .catch(() => null);
            // Outil absent, en échec ou muet : rien n'a été jugé, et la porte doit le dire.
            if (!r || r.timedOut || !r.stdout.trim()) return { available: false, violations: [] };
            try {
              return { ...lireLint(c.report, JSON.parse(r.stdout), opts.root), tool: c.command[0]! };
            } catch {
              return { available: false, violations: [] };
            }
          },
        }
      : {}),

    ...(profile.mutation
      ? {
          async mutation(opts) {
            const c = profile.mutation!;
            const rapport = fichierTemporaire("json");
            try {
              const r = await runner.run(c.command[0]!, substituer(c.command.slice(1), rapport, []), {
                cwd: opts.root,
                timeoutMs: opts.timeoutMs ?? 60 * 60_000,
                ...(opts.signal ? { signal: opts.signal } : {}),
              });
              if (r.timedOut) throw new Error("L'outil de mutation a dépassé le délai");
              const brut = await readFile(rapport, "utf8").catch(() => r.stdout);
              return parseMuterReport(JSON.parse(brut), opts.root);
            } finally {
              await rm(rapport, { force: true });
            }
          },
        }
      : {}),
  };
}

