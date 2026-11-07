import { resolve, sep } from "node:path";
import { defineProject } from "vitest/config";

const WORKFLOWS = resolve(import.meta.dirname, "../../workflows") + sep;
const POUR_LES_SCRIPTS = resolve(import.meta.dirname, "../../packages/workflow/src/hote/pour-les-scripts.ts");

// Les modules d'un workflow importent `@agent-studio/workflow` : dans le processus isolé, c'est la
// bibliothèque fournie par la plateforme. Ici, pour ces seuls modules, le même objet en exports
// nommés ; le banc d'essai, lui, garde la vraie API de la plateforme.
export default defineProject({
  plugins: [
    {
      name: "bibliotheque-des-workflows",
      enforce: "pre",
      resolveId(id, importer) {
        if (id === "@agent-studio/workflow" && importer && resolve(importer).startsWith(WORKFLOWS)) return POUR_LES_SCRIPTS;
        return null;
      },
    },
  ],
  test: { name: "workflow-skraft", include: ["test/**/*.test.ts"], testTimeout: 60_000 },
});
