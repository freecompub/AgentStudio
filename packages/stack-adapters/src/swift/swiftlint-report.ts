import { isAbsolute, relative } from "node:path";
import { z } from "zod";
import type { LintReport } from "../protocols.js";

/** Rapport JSON de SwiftLint : une entrée par violation. */
const schema = z.array(
  z.object({
    file: z.string(),
    line: z.number().optional(),
    severity: z.string(),
    reason: z.string(),
    rule_id: z.string(),
  }),
);

/**
 * Seules les erreurs valent violation : un avertissement est un choix du projet, qui n'a pas
 * voulu en faire un échec. Un rapport illisible laisse la porte sans jugement plutôt que de
 * lui faire conclure à tort.
 */
export function parseSwiftLintReport(raw: unknown, root: string): LintReport {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { available: false, violations: [] };
  return {
    available: true,
    violations: parsed.data
      .filter((v) => v.severity.toLowerCase() === "error")
      .map((v) => ({
        file: (isAbsolute(v.file) ? relative(root, v.file) : v.file).replaceAll("\\", "/"),
        ...(v.line !== undefined ? { line: v.line } : {}),
        rule: v.rule_id,
        message: v.reason,
      })),
  };
}
