import { isAbsolute, relative } from "node:path";
import { z } from "zod";
import { relatifDepuis } from "../chemin-relatif.js";
import type { MutationReport } from "../protocols.js";

/**
 * Rapport JSON de Muter. Forme reprise de sa documentation, **à vérifier** sur la version
 * installée (§15) : seuls les champs utiles sont lus, le reste est ignoré.
 */
const schema = z.object({
  globalMutationScore: z.number(),
  fileReports: z.array(
    z.object({
      path: z.string().optional(),
      fileName: z.string(),
      mutationScore: z.number(),
      appliedOperators: z.array(
        z.object({
          mutationPoint: z.object({ mutationOperatorId: z.string(), position: z.object({ line: z.number() }) }),
          testSuiteOutcome: z.string(),
        }),
      ),
    }),
  ),
});

export function parseMuterReport(raw: unknown, root: string): MutationReport {
  const r = schema.safeParse(raw);
  if (!r.success) throw new Error("Rapport Muter illisible (format JSON attendu)");
  return {
    score: r.data.globalMutationScore,
    files: r.data.fileReports.map((f) => ({
      file: f.path ? relatifDepuis(root, f.path) : f.fileName,
      score: f.mutationScore,
      // Un mutant survit quand la suite reste verte malgré la mutation.
      survived: f.appliedOperators
        .filter((o) => o.testSuiteOutcome === "passed")
        .map((o) => ({ line: o.mutationPoint.position.line, operator: o.mutationPoint.mutationOperatorId })),
    })),
  };
}
