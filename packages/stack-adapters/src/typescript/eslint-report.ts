import { isAbsolute, relative } from "node:path";
import { z } from "zod";
import type { LintReport } from "../protocols.js";

/** Rapport JSON d'ESLint : un objet par fichier examiné. */
const schema = z.array(
  z.object({
    filePath: z.string(),
    messages: z.array(
      z.object({
        ruleId: z.string().nullable().optional(),
        severity: z.number(),
        message: z.string(),
        line: z.number().optional(),
      }),
    ),
  }),
);

/**
 * Seules les **erreurs** (sévérité 2) valent violation : un avertissement est un choix du
 * projet, qui n'a pas voulu en faire un échec. Un rapport illisible ne fait pas échouer la
 * porte — elle dira qu'elle n'a rien pu juger, plutôt que de conclure à tort.
 */
export function parseEslintReport(raw: unknown, root: string): LintReport {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { available: false, violations: [] };
  const violations: LintReport["violations"] = [];
  for (const fichier of parsed.data) {
    const file = (isAbsolute(fichier.filePath) ? relative(root, fichier.filePath) : fichier.filePath).replaceAll("\\", "/");
    for (const m of fichier.messages) {
      if (m.severity < 2) continue;
      violations.push({
        file,
        ...(m.line !== undefined ? { line: m.line } : {}),
        rule: m.ruleId ?? "erreur d'analyse",
        message: m.message,
      });
    }
  }
  return { available: true, violations };
}
