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
 * Seules les **erreurs de règle** (sévérité 2 et `ruleId` renseigné) valent violation. Un
 * avertissement est un choix du projet, qui n'a pas voulu en faire un échec ; une erreur sans
 * règle — fichier ignoré, erreur d'analyse — veut dire que le fichier n'a pas été examiné, ce
 * que `analyzed` rapporte. Un rapport illisible ne fait pas échouer la porte : elle dira
 * qu'elle n'a rien pu juger, plutôt que de conclure à tort.
 */
export function parseEslintReport(raw: unknown, root: string): LintReport {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { available: false, violations: [] };
  const violations: LintReport["violations"] = [];
  const analyzed: string[] = [];
  for (const fichier of parsed.data) {
    const file = (isAbsolute(fichier.filePath) ? relative(root, fichier.filePath) : fichier.filePath).replaceAll("\\", "/");
    // Fichier ignoré par la configuration, ou que le parser ne sait pas lire : il n'a pas été
    // examiné. Le compter comme propre attesterait une conformité que personne n'a vérifiée ;
    // en faire un motif de rejet demanderait à l'agent de réparer une configuration qui ne lui
    // appartient pas, et ferait boucler le scénario jusqu'à épuisement du budget.
    if (fichier.messages.some((m) => m.ruleId == null && /file ignored|parsing error/i.test(m.message))) continue;
    analyzed.push(file);
    for (const m of fichier.messages) {
      if (m.severity < 2 || m.ruleId == null) continue;
      violations.push({
        file,
        ...(m.line !== undefined ? { line: m.line } : {}),
        rule: m.ruleId,
        message: m.message,
      });
    }
  }
  return { available: true, analyzed, violations };
}
