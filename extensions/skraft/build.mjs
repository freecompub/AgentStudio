// Construit dist/index.mjs, l'entrée autonome chargée par l'hôte d'extension isolé.
import { build } from "esbuild";

await build({
  entryPoints: ["src/entry.ts"],
  outfile: "dist/index.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "info",
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
});
