import { isAbsolute, relative } from "node:path";
import { z } from "zod";
import type { LintReport } from "../protocols.js";

/** Une violation SwiftLint. Les entrées mal formées sont écartées une à une, pas en bloc. */
const entree = z.object({
  file: z.string(),
  line: z.number().optional(),
  severity: z.string(),
  reason: z.string(),
  rule_id: z.string(),
});

/**
 * Toutes les violations comptent, avertissements compris.
 *
 * SwiftLint met `warning` par défaut sur presque toutes ses règles : chez lui, le choix du
 * projet est d'**activer** la règle, pas d'en régler la gravité. Ne retenir que les erreurs
 * reviendrait à ne rien reprocher à un projet ordinaire, donc à attester sa conformité sans
 * l'avoir vérifiée — l'inverse de ce que cette porte doit faire. ESLint est différent : `warn`
 * y est un niveau choisi règle par règle, et y signifie « ne pas bloquer ».
 *
 * Un rapport illisible laisse la porte sans jugement plutôt que de lui faire conclure à tort.
 */
export function parseSwiftLintReport(raw: unknown, root: string): LintReport {
  if (!Array.isArray(raw)) return { available: false, violations: [] };
  const violations: LintReport["violations"] = [];
  for (const brut of raw) {
    const v = entree.safeParse(brut);
    if (!v.success) continue; // violation non rattachée à un fichier, ou champ manquant
    violations.push({
      file: (isAbsolute(v.data.file) ? relative(root, v.data.file) : v.data.file).replaceAll("\\", "/"),
      ...(v.data.line !== undefined ? { line: v.data.line } : {}),
      rule: v.data.rule_id,
      message: v.data.reason,
    });
  }
  return { available: true, violations };
}
