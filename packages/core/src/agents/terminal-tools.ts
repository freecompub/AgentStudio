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
    // Facultatif, et seulement une PROPOSITION : le code vérifie que ce test existe, qu'il est le
    // bon et qu'il échoue pour une bonne raison avant d'en tenir compte (ADR 0045).
    coveredBy: z
      .string()
      .min(1)
      .max(1_000)
      .optional()
      .describe("Si tu n'écris pas de nouveau test parce qu'un test existant vérifie déjà le comportement demandé : son identifiant exact"),
    // Réponses aux défauts de revue qui te sont transmis (ADR 0046) : une par identifiant.
    responses: z
      .array(
        z.object({
          defect: z.string().min(1).max(100).describe("Identifiant du défaut, tel que donné (ex. cold-reader#2.1)"),
          status: z.enum(["fixed", "contested"]).describe("fixed : corrigé ; contested : tu estimes qu'il ne faut pas le corriger"),
          reason: z.string().max(2_000).optional().describe("Obligatoire pour contested : pourquoi ce n'est pas un défaut"),
        }),
      )
      .max(100)
      .optional()
      .describe("Une réponse par défaut de revue qui t'a été transmis"),
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
  submit_difficulty: z.object({
    level: z.enum(["simple", "medium", "medium-hard", "challenging"]).describe("Niveau retenu"),
    justification: z.string().min(1).max(1_000).describe("Justification courte"),
  }),
  submit_lens_verdict: z.object({
    lens: z.string().min(1).max(60),
    // Enum unique de verdict (défaut C6 de skraft-plugin rendu impossible).
    verdict: z.enum(["APPROVED", "CHANGES_REQUESTED", "REJECTED"]),
    defects: z
      .array(
        z.object({
          severity: z.enum(["blocker", "major", "minor"]),
          // Qui doit corriger (ADR 0046) : un seul sujet par défaut ; scinder un défaut qui touche les deux.
          target: z.enum(["test", "code", "deliverable"]).describe("test : un test à écrire ou corriger ; code : le code de production ; deliverable : un document de la phase"),
          file: z.string().max(1_000).optional(),
          line: z.number().int().min(1).optional(),
          description: z.string().min(1).max(2_000),
        }),
      )
      .max(100),
    // Arbitrage des défauts de tes revues précédentes que l'agent a contestés (ADR 0046).
    rulings: z
      .array(
        z.object({
          defect: z.string().min(1).max(100).describe("Identifiant du défaut contesté"),
          decision: z.enum(["accepted", "maintained"]).describe("accepted : la contestation te convainc, le défaut tombe ; maintained : il doit être corrigé"),
          reason: z.string().max(2_000).describe("Ta raison"),
        }),
      )
      .max(100)
      .optional(),
  }),
  report_blocker: z.object({
    question: z.string().min(1).max(2_000).describe("Question métier ou technique qui bloque"),
    choices: z.array(z.string().min(1).max(300)).max(10).describe("Réponses possibles, si elles sont connues"),
  }),
} as const;

export type TerminalToolName = keyof typeof terminalSchemas;
export type TerminalOutput<N extends TerminalToolName> = z.infer<(typeof terminalSchemas)[N]>;

const DESCRIPTIONS: Record<TerminalToolName, string> = {
  report_phase: "Appelle cet outil quand ta phase est terminée : il clôt ton tour.",
  submit_plan: "Soumets la liste ordonnée des comportements à implémenter : cet appel clôt ton tour.",
  submit_difficulty: "Soumets le niveau de difficulté retenu et sa justification : cet appel clôt ton tour.",
  submit_lens_verdict: "Soumets ton verdict de revue et les défauts trouvés : cet appel clôt ton tour.",
  report_blocker: "Signale une question qui t'empêche de continuer (valeur ou règle manquante) : ta tâche est suspendue jusqu'à la réponse.",
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
