// Construit le serveur MCP skraft dans dist/ (ADR 0068) : les paquets internes exportent du
// TypeScript (ADR 0001) et sont donc intégrés au bundle ; restent dehors ce qui ne s'y intègre pas
// (binaires natifs, CLI Copilot), déclaré en dépendances du paquet.
import { cp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const here = import.meta.dirname;
const racine = resolve(here, "..");
const repo = resolve(racine, "../..");
const dist = join(racine, "dist");
const pkg = JSON.parse(await readFile(join(racine, "package.json"), "utf8"));
const EXTERNES = ["@github/copilot-sdk", "esbuild"];
const banner = { js: '#!/usr/bin/env node\nimport { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' };
const commun = { bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "warning", external: EXTERNES };

await rm(dist, { recursive: true, force: true });
await build({ ...commun, banner, entryPoints: [join(racine, "src/main.ts")], outfile: join(dist, "main.mjs"), define: { __VERSION__: JSON.stringify(pkg.version) } });
// Processus isolé qui rejoue un workflow, comme celui de l'application (WORKFLOW_RUNTIME). Rien
// d'externe : sous --permission, il ne peut lire que son propre fichier, pas node_modules.
await build({ ...commun, external: [], banner: { js: banner.js.split("\n")[1] }, entryPoints: [join(repo, "packages/workflow/src/hote/enfant-entree.ts")], outfile: join(dist, "workflow-child.mjs") });
// Le workflow, livré en sources (GPL-3.0-or-later : sources et LICENSE fournies).
await cp(join(repo, "workflows/skraft"), join(dist, "workflows/skraft"), {
  recursive: true,
  filter: (src) => !src.includes(`${join("workflows", "skraft", "node_modules")}`),
});
