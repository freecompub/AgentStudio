// Construit, dans out/, le runtime des hôtes d'extension et les extensions internes
// (entrée compilée + manifest.json) chargées dans des processus isolés (J4).
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const here = import.meta.dirname;
const repo = resolve(here, "../../..");
const out = resolve(here, "../out");
const banner = { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' };
const common = { bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "warning", banner };

// Extensions livrées avec l'application. `skraft` n'en fait plus partie : elle se distribue en
// paquet `.asx` et s'installe depuis un fichier (`pnpm ext:build` puis `pnpm ext:pack`).
const BUILT_IN = [{ dir: "extensions/tdd", entry: "src/entry.ts", manifest: "src/manifest.ts", exportName: "manifest" }];

await build({ ...common, entryPoints: [join(repo, "packages/extension-host/src/child/entry.ts")], outfile: join(out, "extension-host/extension-child.mjs") });

const tmp = await mkdtemp(join(tmpdir(), "agent-studio-manifests-"));
try {
  for (const ext of BUILT_IN) {
    const manifestModule = join(tmp, `${ext.dir.replaceAll("/", "_")}.mjs`);
    await build({ ...common, entryPoints: [join(repo, ext.dir, ext.manifest)], outfile: manifestModule });
    const manifest = (await import(pathToFileURL(manifestModule).href))[ext.exportName];
    const target = join(out, "extensions", manifest.id);
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    await build({ ...common, entryPoints: [join(repo, ext.dir, ext.entry)], outfile: join(target, manifest.main) });
    await writeFile(join(target, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`extension construite : ${manifest.id} → ${target}`);
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}
