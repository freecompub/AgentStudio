import type { ToolSpec } from "@agent-studio/core";
import type { LintReport } from "@agent-studio/stack-adapters";

/**
 * Outil `run_lint` : le linter **du projet**, accessible à l'agent pendant son travail.
 *
 * `StackAdapter.lint()` existait, mais n'était lu qu'après coup par la porte `deliver` (ADR 0022) :
 * l'agent découvrait le refus quand la porte le recalait. Même mesure, même source de vérité,
 * seulement plus tôt. Ce n'est pas une preuve : la porte relance le linter elle-même, sinon
 * l'agent choisirait le moment de la mesure.
 */

const VIOLATIONS_MAX = 30;

/**
 * Résumé lisible par l'agent. Il distingue trois états que l'on confond facilement, et dont deux
 * ne valent surtout pas « conforme » : **pas de linter**, **linter qui n'a rien examiné**, et
 * **fichiers examinés sans violation**. Le second est le défaut réintroduit trois fois en S6 —
 * un outil qui tourne, rend zéro violation, et n'a rien jugé.
 */
export function summarizeLint(r: LintReport): string {
  if (!r.available) return "Le projet n'a aucun linter configuré. Rien n'a donc été mesuré : cela ne vaut pas conformité, ne t'en prévaux pas.";

  const analyzed = r.analyzed ?? [];
  if (analyzed.length === 0)
    return `Le linter${r.tool ? ` (${r.tool})` : ""} n'a examiné aucun fichier — configuration, exclusions, ou filtre de sévérité. Rien n'a été mesuré : cela ne vaut pas conformité.`;

  const tete = `Linter${r.tool ? ` (${r.tool})` : ""} : ${analyzed.length} fichier(s) examiné(s).`;
  if (r.violations.length === 0) return `${tete} Aucune violation.`;

  const lines = [`${tete} ${r.violations.length} violation(s) :`];
  for (const v of r.violations.slice(0, VIOLATIONS_MAX))
    lines.push(`- ${v.file}${v.line === undefined ? "" : `:${v.line}`} [${v.rule}] ${v.message.split("\n")[0]?.slice(0, 300) ?? ""}`);
  if (r.violations.length > VIOLATIONS_MAX) lines.push(`… et ${r.violations.length - VIOLATIONS_MAX} autre(s), non listée(s).`);
  return lines.join("\n");
}

export interface LintSource {
  lint(opts: { files?: string[] }): Promise<LintReport | null>;
}

/** Outil `run_lint` : handler = notre code, comme `run_tests`. Chaque appel réarme le watchdog. */
export function runLintTool(source: LintSource, opts: { beat: () => void }): ToolSpec {
  return {
    name: "run_lint",
    description:
      "Lance le linter du projet, avec les règles que le projet a lui-même choisies, et renvoie ce qu'il a mesuré. C'est la seule façon de connaître l'avis de l'analyse statique.",
    parameters: {
      type: "object",
      properties: { files: { type: "array", items: { type: "string" }, description: "Fichiers à examiner ; tout le projet si absent." } },
      additionalProperties: false,
    },
    async handler(args) {
      opts.beat();
      const files = (args as { files?: unknown } | null)?.files;
      const report = await source.lint(Array.isArray(files) && files.every((f) => typeof f === "string") ? { files: files as string[] } : {});
      opts.beat();
      return report === null ? "Cette stack ne propose pas de linter : rien n'a été mesuré, cela ne vaut pas conformité." : summarizeLint(report);
    },
  };
}
