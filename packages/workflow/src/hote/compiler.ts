/**
 * Compilation d'un dossier de workflow en un seul code (`docs/11` §3, §8) : le script n'importe que
 * des fichiers de son dossier et `@agent-studio/workflow`. Tout autre import — module Node, paquet,
 * fichier hors du dossier, y compris par `import()` — est refusé avant toute exécution.
 */
import { realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { build, type Message } from "esbuild";

export type Compilation = { ok: true; code: string } | { ok: false; motifs: string[] };

export async function compilerWorkflow(dossier: string): Promise<Compilation> {
  const racine = resolve(dossier);
  const dedans = (p: string) => p === racine || p.startsWith(racine + sep);
  // Chemin réel, liens symboliques résolus : un lien du dossier vers un fichier extérieur ferait
  // entrer dans le script un code que l'empreinte du dossier ne couvre pas (revue de la PR #12).
  const racineReelle = realpathSync(racine);
  const dedansReel = (p: string) => p === racineReelle || p.startsWith(racineReelle + sep);
  try {
    const r = await build({
      entryPoints: [resolve(racine, "workflow.mjs")],
      bundle: true,
      write: false,
      format: "cjs",
      platform: "neutral",
      target: "es2022",
      logLevel: "silent",
      plugins: [
        {
          name: "imports-du-workflow",
          setup(b) {
            b.onResolve({ filter: /.*/ }, (args) => {
              if (args.kind === "entry-point") return undefined;
              if (args.path === "@agent-studio/workflow") return { path: args.path, external: true };
              if (args.path.startsWith("./") || args.path.startsWith("../")) {
                if (!dedans(resolve(args.resolveDir, args.path))) return { errors: [{ text: `import hors du dossier du workflow : ${args.path}` }] };
                return undefined;
              }
              return { errors: [{ text: `import interdit : ${args.path} (seuls les fichiers du dossier et @agent-studio/workflow)` }] };
            });
            b.onLoad({ filter: /.*/ }, (args) => {
              let reel: string;
              try {
                reel = realpathSync(args.path);
              } catch {
                return undefined;
              }
              if (!dedansReel(reel)) return { errors: [{ text: `import hors du dossier du workflow : ${relative(racine, args.path)} (lien vers ${reel})` }] };
              return undefined;
            });
          },
        },
      ],
    });
    return { ok: true, code: r.outputFiles[0]!.text };
  } catch (e) {
    const erreurs = (e as { errors?: Message[] }).errors ?? [];
    if (!erreurs.length) return { ok: false, motifs: [String(e)] };
    return { ok: false, motifs: erreurs.map((x) => `${x.text}${x.location ? ` (${relative(racine, resolve(racine, x.location.file))}:${x.location.line})` : ""}`) };
  }
}
