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
          status: z
            .enum(["fixed", "contested", "outOfScope"])
            .describe("fixed : corrigé ; contested : tu estimes qu'il ne faut pas le corriger ; outOfScope : il est juste, mais sa correction n'est pas de ton ressort (ex. un test à écrire alors que tu ne peux écrire que du code)"),
          reason: z.string().max(2_000).optional().describe("Obligatoire pour contested et outOfScope"),
        }),
      )
      .max(100)
      .optional()
      .describe("Une réponse par défaut de revue qui t'a été transmis"),
    // Écarts au plan de test (ADR 0067, PLAN_DEVIATION de skraft-plugin v1.15.1) : déclarés par
    // l'agent, vérifiés et tracés par le code, jugés par la revue.
    planDeviations: z
      .array(
        z.object({
          criterion: z.string().min(1).max(50).describe("Critère concerné, tel que dans la matrice du plan de test (ex. ac-2)"),
          planned: z.string().min(1).max(500).describe("Ce que prévoit sa ligne de la matrice : couche et doublure"),
          actual: z.string().min(1).max(500).describe("Ce que tu as fait à la place : couche et doublure"),
          rule: z.string().min(1).max(1_000).describe("La règle, d'une skill chargée, qui interdit le choix prévu"),
        }),
      )
      .max(20)
      .optional()
      .describe("Seulement si un test s'écarte de la couche ou de la doublure que le plan de test prévoit pour son critère"),
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
          // Pourquoi cette gravité : une gravité gonflée se voit, et se réfute.
          severityReason: z.string().min(1).max(600).describe("Pourquoi ce défaut a cette gravité, en une phrase"),
          // Un défaut qui se répète : un seul défaut, une seule correction.
          occurrences: z
            .array(z.string().regex(/^.+:\d+$/, "chemin:ligne attendu"))
            .max(20)
            .optional()
            .describe("Autres endroits où le même défaut se répète, sous la forme chemin:ligne"),
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
  // Pile proposée par l'agent de découverte (ADR 0076) : le code la vérifie — schéma, programmes,
  // diagnostic, canaris — avant que rien ne soit écrit.
  submit_pile: z.object({
    piles: z
      .array(
        z.object({
          racine: z.string().min(1).max(500).describe("Dossier de la pile, relatif à la racine du projet ; « . » pour le projet entier"),
          nom: z.string().min(1).max(60).optional().describe("Nom du composant, s'il y en a plusieurs"),
          yaml: z.string().min(1).max(20_000).describe("Le profil de pile, en YAML, au format décrit"),
        }),
      )
      .min(1)
      .max(20),
    justification: z.string().min(1).max(2_000).describe("Ce qui, dans le projet, justifie ces choix"),
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
  submit_pile: "Soumets la pile du projet, une par racine : cet appel clôt ton tour, et le code la vérifie.",
  report_blocker: "Signale une question qui t'empêche de continuer (valeur ou règle manquante) : ta tâche est suspendue jusqu'à la réponse.",
};

/**
 * `controle` : le code peut refuser une sortie valide (ADR 0082) ; son motif est rendu à l'agent,
 * qui continue son tour, comme pour des arguments invalides.
 */
export function terminalTool<N extends TerminalToolName>(name: N, sink: (output: TerminalOutput<N>) => void, controle?: (output: TerminalOutput<N>) => Promise<string | null>): ToolSpec {
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
      const refus = controle ? await controle(parsed.data as TerminalOutput<N>) : null;
      if (refus) throw new Error(refus);
      sink(parsed.data as TerminalOutput<N>);
      return "Enregistré.";
    },
  };
}
