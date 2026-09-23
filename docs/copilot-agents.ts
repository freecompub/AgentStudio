// ============================================================================
// Interface LLM de l'orchestrateur TDD : implémente planner / testAgent / devAgent
// de `Deps` avec le Copilot SDK (@github/copilot-sdk).
//
// Principe : chaque appel d'agent = une session neuve et isolée qui
//   1. reçoit un rôle (system message) et une consigne (prompt),
//   2. ne peut écrire que dans son périmètre (hook onPreToolUse),
//   3. termine son tour en appelant un outil "terminal" (report_phase / submit_plan)
//      dont les arguments structurés remontent à l'orchestrateur.
// ============================================================================

import { CopilotClient, CopilotSession, defineTool, approveAll } from "@github/copilot-sdk";
import type { SessionHooks } from "@github/copilot-sdk";
import type { Deps, Step } from "./tdd-orchestrator.js";

type PreToolUseHandler = NonNullable<SessionHooks["onPreToolUse"]>;
import * as path from "node:path";

const AGENT_TIMEOUT_MS = 15 * 60_000; // sendAndWait vaut 60 s par défaut : trop court pour un agent

// ---------- Rôles ----------------------------------------------------------------

const ROLES = {
  planner: `Tu es l'architecte d'un cycle TDD. Découpe la fonctionnalité demandée en
comportements atomiques, chacun testable par UN seul test. Ordonne-les du plus simple
au plus complexe. N'écris aucun fichier. Termine en appelant submit_plan.`,

  test: `Tu es l'agent TEST d'un cycle TDD (phase RED).
- Écris exactement UN nouveau test pour le comportement demandé, dans tests/.
- Le test doit échouer sur une assertion, parce que le comportement n'existe pas encore.
- Ne modifie jamais le code de production, ne touche pas à git.
- Termine en appelant report_phase.`,

  dev: `Tu es l'agent DEV d'un cycle TDD.
- Phase GREEN : écris le code MINIMAL dans src/ pour faire passer le test indiqué.
- Phase REFACTOR : améliore la lisibilité sans changer le comportement.
- Ne modifie jamais les tests, ne touche pas à git.
- Termine en appelant report_phase.`,
};

// ---------- Garde de périmètre (hook) -----------------------------------------------

const WRITE_TOOLS = new Set(["edit", "create", "write"]);
const SHELL_TOOLS = new Set(["bash", "powershell", "shell"]);

function pathGuard(root: string, allowed: RegExp | null) {
  const guard: PreToolUseHandler = async (input) => {
    const args = (input.toolArgs ?? {}) as Record<string, unknown>;

    if (WRITE_TOOLS.has(input.toolName)) {
      const raw = String(args.path ?? args.file_path ?? "");
      const rel = path.relative(root, path.resolve(root, raw)).replaceAll("\\", "/");
      if (!allowed || rel.startsWith("..") || !allowed.test(rel))
        return { permissionDecision: "deny",
                 permissionDecisionReason: `Écriture interdite hors de ton périmètre : ${rel}` };
    }
    if (SHELL_TOOLS.has(input.toolName)) {
      const cmd = String(args.command ?? "");
      if (/\bgit\s+(commit|reset|checkout|stash|rebase|push|restore)\b/.test(cmd))
        return { permissionDecision: "deny",
                 permissionDecisionReason: "Git est réservé à l'orchestrateur." };
      // Empêche le contournement par redirection shell vers des fichiers
      if (/(>|\btee\b|\bsed\s+-i\b|\bmv\b|\bcp\b|\brm\b)/.test(cmd) && !/^\s*(npm|npx|pnpm|yarn)\s+(test|run test|vitest|jest)/.test(cmd))
        return { permissionDecision: "deny",
                 permissionDecisionReason: "Utilise les outils d'édition, pas le shell, pour modifier des fichiers." };
    }
    return { permissionDecision: "allow" };
  };
  return guard;
}

// ---------- Outils terminaux (le "contrat" LLM -> code) ----------------------------

interface PhaseReport { summary: string; files: string[] }

function reportTool(sink: (r: PhaseReport) => void) {
  return defineTool<PhaseReport>("report_phase", {
    description: "Appelle cet outil quand ta phase est terminée.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Ce que tu as fait, en une phrase" },
        files: { type: "array", items: { type: "string" }, description: "Fichiers modifiés" },
      },
      required: ["summary", "files"],
    },
    skipPermission: true,
    isTerminal: true,               // un appel réussi termine le tour de l'agent
    handler: async (args) => { sink(args); return "Phase enregistrée."; },
  });
}

type PlanArgs = { steps: { id: string; behavior: string }[] };

function planTool(sink: (p: PlanArgs) => void) {
  return defineTool<PlanArgs>("submit_plan", {
    description: "Soumet la liste ordonnée des comportements à implémenter.",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" }, behavior: { type: "string" } },
            required: ["id", "behavior"],
          },
        },
      },
      required: ["steps"],
    },
    skipPermission: true,
    isTerminal: true,
    handler: async (args) => { sink(args); return "Plan reçu."; },
  });
}

// ---------- Exécution d'un tour d'agent --------------------------------------------

interface RunOpts {
  role: string;
  prompt: string;
  writable: RegExp | null;          // null = lecture seule
  terminal: ReturnType<typeof reportTool> | ReturnType<typeof planTool>;
  wasCalled: () => boolean;
  onEvent?: (text: string) => void; // flux vers le chat / panneau de ton app
}

export class CopilotAgents {
  constructor(private client: CopilotClient, private root: string, private model?: string) {}

  private async turn(o: RunOpts): Promise<void> {
    const session: CopilotSession = await this.client.createSession({
      model: this.model,
      workingDirectory: this.root,
      systemMessage: { mode: "append", content: o.role },
      tools: [o.terminal],
      hooks: { onPreToolUse: pathGuard(this.root, o.writable) },
      onPermissionRequest: approveAll, // le filtrage réel est fait par le hook ci-dessus
    });

    const off = session.on((ev) => {
      if (ev.type === "assistant.message") o.onEvent?.(ev.data.content);
      if (ev.type === "tool.execution_start") o.onEvent?.(`🔧 ${ev.data.toolName}`);
    });

    try {
      await session.sendAndWait({ prompt: o.prompt }, AGENT_TIMEOUT_MS);
      // Si l'agent a oublié l'outil terminal, une seule relance ciblée.
      if (!o.wasCalled())
        await session.sendAndWait(
          { prompt: "Tu n'as pas appelé l'outil de fin de phase. Termine maintenant en l'appelant." },
          AGENT_TIMEOUT_MS);
      if (!o.wasCalled()) throw new Error("L'agent n'a pas clôturé sa phase.");
    } finally {
      off();
      await session.disconnect();
    }
  }

  // ---- implémentations de Deps ----

  planner: Deps["planner"] = {
    plan: async (feature, feedback) => {
      let plan: PlanArgs | undefined;
      await this.turn({
        role: ROLES.planner,
        prompt: `Fonctionnalité : ${feature}` +
          (feedback ? `\n\nTon plan précédent a été refusé : ${feedback}` : ""),
        writable: null,
        terminal: planTool(p => (plan = p)),
        wasCalled: () => !!plan,
      });
      return plan!.steps;
    },
  };

  testAgent: Deps["testAgent"] = {
    run: async (step: Step, feedback?: string) => {
      let report: PhaseReport | undefined;
      await this.turn({
        role: ROLES.test,
        prompt: `Comportement à tester : ${step.behavior}` +
          (feedback ? `\n\nTa tentative précédente a été rejetée par le vérificateur : ${feedback}` : ""),
        writable: /^tests\//,
        terminal: reportTool(r => (report = r)),
        wasCalled: () => !!report,
      });
    },
  };

  devAgent: Deps["devAgent"] = {
    run: async (mode, step, testIds, feedback) => {
      let report: PhaseReport | undefined;
      const task = mode === "green"
        ? `Phase GREEN. Fais passer le(s) test(s) : ${testIds.join(", ")}\nComportement : ${step.behavior}`
        : `Phase REFACTOR. Améliore le code écrit pour : ${step.behavior}. Tous les tests doivent rester verts.`;
      await this.turn({
        role: ROLES.dev,
        prompt: task + (feedback ? `\n\nRejet précédent du vérificateur : ${feedback}` : ""),
        writable: /^src\//,
        terminal: reportTool(r => (report = r)),
        wasCalled: () => !!report,
      });
    },
  };
}

// ---------- Câblage -------------------------------------------------------------------
//
//   const client = new CopilotClient();
//   await client.start();
//   const agents = new CopilotAgents(client, "/chemin/du/projet");
//
//   const orch = new TddOrchestrator({
//     planner: agents.planner,
//     testAgent: agents.testAgent,
//     devAgent: agents.devAgent,
//     tests, git, human, onState, persist,         // implémentations côté harnais
//     paths: { tests: /^tests\//, src: /^src\// },
//   });
//   await orch.start("Calcul du bolus avec plafond de sécurité");
