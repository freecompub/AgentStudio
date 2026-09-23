import { build } from "esbuild";

/**
 * Construit un bundle ESM autonome pour un processus isolé : tout est inclus sauf les modules
 * Node intégrés ; `require` est fourni pour les dépendances CommonJS.
 */
export async function bundle(entry: string, outfile: string): Promise<void> {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    sourcemap: false,
    logLevel: "silent",
    banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  });
}
