import type { AgentEvent, AgentRuntime, AgentSession, ToolCallGuard, ToolSpec } from "../protocols/agent-runtime.js";
import type { Logger } from "../protocols/logger.js";
import type { UsageDelta } from "../protocols/usage.js";
import { createTaskAgentGuard } from "../guards/task-agent-guard.js";
import { composeGuards } from "../guards/compose-guards.js";
import { createHeartbeat, EnvFailureError, runTurn, WorkDefectError } from "../turns/run-turn.js";
import { terminalTool, type TerminalOutput, type TerminalToolName } from "./terminal-tools.js";

export interface TaskAgentSpec<N extends TerminalToolName = TerminalToolName> {
  role: string;
  systemPrompt: string;
  /** Périmètre d'écriture (globs) ; vide = lecture seule. */
  writable: string[];
  /** Outil terminal qui porte la sortie du rôle. */
  output: N;
  model?: string;
}

export interface TaskAgentRunOptions {
  signal?: AbortSignal;
  onEvent?: (e: AgentEvent) => void;
  /** Outils supplémentaires fournis par notre code ; `beat` signale une activité (outil long, §6.4). */
  tools?: (beat: () => void) => ToolSpec[];
  /** Gardes supplémentaires, appliquées après la garde du rôle (D28). */
  guards?: ToolCallGuard[];
  /** Usage de chaque tour : une requête par prompt envoyé (× multiplicateur du modèle), tokens (D37). */
  onUsage?: (delta: UsageDelta) => void;
}

export interface TaskAgentRunner {
  run<N extends TerminalToolName>(spec: TaskAgentSpec<N>, prompt: string, opts?: TaskAgentRunOptions): Promise<{ output: TerminalOutput<N> }>;
}

export interface TaskAgentRunnerDeps {
  runtime: AgentRuntime;
  root: string;
  idleMs?: number;
  logger?: Logger;
}

/**
 * Exécute un rôle dans une session neuve (D17) : garde de périmètre, outil terminal,
 * une relance ciblée si la sortie manque, puis fermeture et suppression de la session.
 * Ne renvoie qu'un résultat sérialisé, jamais la session (D10).
 */
export function createTaskAgentRunner(deps: TaskAgentRunnerDeps): TaskAgentRunner {
  return {
    async run(spec, prompt, opts = {}) {
      let output: TerminalOutput<typeof spec.output> | undefined;
      let session: AgentSession | undefined;
      const heartbeat = createHeartbeat();
      const turn = async (text: string) => {
        let multiplier: number | undefined;
        let inputTokens = 0;
        let outputTokens = 0;
        try {
          await runTurn(session!, text, {
            heartbeat,
            ...(deps.idleMs !== undefined ? { idleMs: deps.idleMs } : {}),
            onEvent: (e) => {
              if (e.type === "usage") {
                multiplier ??= e.multiplier;
                inputTokens += e.inputTokens ?? 0;
                outputTokens += e.outputTokens ?? 0;
              }
              opts.onEvent?.(e);
            },
          });
        } finally {
          opts.onUsage?.({ requests: multiplier ?? 1, inputTokens, outputTokens });
        }
      };
      const onAbort = () => void session?.abort();
      try {
        if (opts.signal?.aborted) throw new Error("Annulé");
        session = await deps.runtime
          .openSession({
            role: spec.role,
            workingDirectory: deps.root,
            systemPrompt: spec.systemPrompt,
            tools: [terminalTool(spec.output, (o) => void (output = o)), ...(opts.tools?.(() => heartbeat.beat()) ?? [])],
            guard: composeGuards([createTaskAgentGuard({ root: deps.root, writable: spec.writable }), ...(opts.guards ?? [])]),
            ...(spec.model ? { model: spec.model } : {}),
          })
          .catch((err: unknown) => {
            throw new EnvFailureError(`Ouverture de session impossible : ${err instanceof Error ? err.message : String(err)}`, { cause: err });
          });
        opts.signal?.addEventListener("abort", onAbort, { once: true });
        deps.logger?.info("agent de tâche lancé", { role: spec.role, sessionId: session.id });

        await turn(prompt);
        if (!output && !opts.signal?.aborted)
          await turn(`Tu n'as pas appelé l'outil ${spec.output}. Termine maintenant ta phase en l'appelant avec des arguments valides.`);
        if (opts.signal?.aborted) throw new Error("Annulé");
        if (!output) throw new WorkDefectError(`L'agent ${spec.role} n'a pas clôturé sa phase par ${spec.output}.`);
        return { output };
      } finally {
        opts.signal?.removeEventListener("abort", onAbort);
        if (session) {
          const id = session.id;
          await session.close().catch(() => undefined);
          await deps.runtime.deleteSession(id).catch((err: unknown) => deps.logger?.warn("suppression de session impossible", { sessionId: id, error: String(err) }));
        }
      }
    },
  };
}
