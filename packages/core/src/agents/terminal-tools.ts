import { z } from "zod";
import type { ToolSpec } from "../protocols/agent-runtime.js";

/**
 * Outils terminaux standard (§6.5, D18) : contrat de sortie structurée entre LLM et code.
 * Leur appel réussi termine le tour ; des arguments invalides sont refusés (le modèle corrige).
 */
export const terminalSchemas = {
  report_phase: z.object({
    summary: z.string().min(1).max(2_000).describe("Ce que tu as fait, en une ou deux phrases"),
    files: z.array(z.string().max(1_000)).max(500).describe("Chemins relatifs des fichiers que tu as modifiés"),
  }),
  submit_plan: z.object({
    steps: z
      .array(
        z.object({
          id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).describe("Identifiant court et unique, ex. s1"),
          behavior: z.string().min(1).max(500).describe("Comportement observable testable par un seul test"),
        }),
      )
      .max(50),
  }),
} as const;

export type TerminalToolName = keyof typeof terminalSchemas;
export type TerminalOutput<N extends TerminalToolName> = z.infer<(typeof terminalSchemas)[N]>;

const DESCRIPTIONS: Record<TerminalToolName, string> = {
  report_phase: "Appelle cet outil quand ta phase est terminée : il clôt ton tour.",
  submit_plan: "Soumets la liste ordonnée des comportements à implémenter : cet appel clôt ton tour.",
};

export function terminalTool<N extends TerminalToolName>(name: N, sink: (output: TerminalOutput<N>) => void): ToolSpec {
  const schema = terminalSchemas[name];
  return {
    name,
    description: DESCRIPTIONS[name],
    parameters: z.toJSONSchema(schema) as Record<string, unknown>,
    terminal: true,
    async handler(args) {
      const parsed = schema.safeParse(args);
      if (!parsed.success)
        throw new Error(`Arguments invalides pour ${name} : ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      sink(parsed.data as TerminalOutput<N>);
      return "Enregistré.";
    },
  };
}
