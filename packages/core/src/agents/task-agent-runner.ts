import type { AgentEvent, AgentRuntime, AgentSession, ToolCallGuard, ToolSpec } from "../protocols/agent-runtime.js";
import type { Logger } from "../protocols/logger.js";
import type { UsageDelta } from "../protocols/usage.js";
import { createTaskAgentGuard } from "../guards/task-agent-guard.js";
import { composeGuards } from "../guards/compose-guards.js";
import { createHeartbeat, EnvFailureError, runTurn, TurnTimeoutError, WorkDefectError } from "../turns/run-turn.js";
import { terminalTool, type TerminalOutput, type TerminalToolName } from "./terminal-tools.js";

export interface TaskAgentSpec<N extends TerminalToolName = TerminalToolName> {
  role: string;
  systemPrompt: string;
  /** Périmètre d'écriture (globs) ; vide = lecture seule. */
  writable: string[];
  /** Outil terminal qui porte la sortie du rôle. */
  output: N;
  /** Le rôle peut suspendre sa tâche par `report_blocker` (D31). */
  blocker?: boolean;
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
  /**
   * Identité de continuité du tour (ADR 0030), typiquement `<taskId>/<rôle>`. Deux exécutions qui
   * la partagent sont deux tentatives du **même** travail : si la première a été interrompue sans
   * que le contexte soit en cause, la seconde reprend sa session au lieu d'en ouvrir une neuve.
   * Absente, rien n'est mémorisé — c'est le comportement d'avant.
   */
  resumeKey?: string;
}

/** Sortie structurée du rôle, ou blocage signalé par `report_blocker`. */
export type TaskAgentResult<N extends TerminalToolName> =
  | { output: TerminalOutput<N>; blocker?: undefined }
  | { output?: undefined; blocker: TerminalOutput<"report_blocker"> };

export interface TaskAgentRunner {
  run<N extends TerminalToolName>(spec: TaskAgentSpec<N>, prompt: string, opts?: TaskAgentRunOptions): Promise<TaskAgentResult<N>>;
}

export interface TaskAgentRunnerDeps {
  runtime: AgentRuntime;
  root: string;
  idleMs?: number;
  /** Plafond de durée totale d'un tour (ADR 0026). */
  maxMs?: number;
  /** Plafond du cumul des tokens d'entrée d'un tour (ADR 0027). */
  maxInputTokens?: number;
  logger?: Logger;
}

/**
 * Exécute un rôle dans une session neuve (D17) : garde de périmètre, outil terminal,
 * une relance ciblée si la sortie manque, puis fermeture et suppression de la session.
 * Ne renvoie qu'un résultat sérialisé, jamais la session (D10).
 */
export function createTaskAgentRunner(deps: TaskAgentRunnerDeps): TaskAgentRunner {
  /**
   * Sessions qu'un tour interrompu a laissées reprenables (ADR 0030), par clé de continuité.
   *
   * N'y entrent que les interruptions dont le contexte n'est pas la cause : le modèle n'a pas
   * répondu (`EnvFailureError`), ou l'agent s'est tu (`TurnTimeoutError`). Un tour coupé par un
   * plafond de durée ou de coût n'y entre **jamais** : son contexte est précisément ce qui a
   * déclenché la coupure, et le renvoyer retaperait le plafond aussitôt.
   */
  const reprenables = new Map<string, string>();

  return {
    async run(spec, prompt, opts = {}) {
      let output: TerminalOutput<typeof spec.output> | undefined;
      let blocker: TerminalOutput<"report_blocker"> | undefined;
      let session: AgentSession | undefined;
      /** Session laissée en vie pour que le tour suivant la reprenne (ADR 0030). */
      let garder = false;
      const heartbeat = createHeartbeat();
      const turn = async (text: string) => {
        let multiplier: number | undefined;
        let inputTokens = 0;
        let outputTokens = 0;
        try {
          await runTurn(session!, text, {
            heartbeat,
            ...(deps.idleMs !== undefined ? { idleMs: deps.idleMs } : {}),
            ...(deps.maxMs !== undefined ? { maxMs: deps.maxMs } : {}),
            ...(deps.maxInputTokens !== undefined ? { maxInputTokens: deps.maxInputTokens } : {}),
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
        const config = {
          role: spec.role,
          workingDirectory: deps.root,
          systemPrompt: spec.systemPrompt,
          tools: [
            terminalTool(spec.output, (o) => void (output = o)),
            ...(spec.blocker ? [terminalTool("report_blocker", (b) => void (blocker = b))] : []),
            ...(opts.tools?.(() => heartbeat.beat()) ?? []),
          ],
          guard: composeGuards([createTaskAgentGuard({ root: deps.root, writable: spec.writable }), ...(opts.guards ?? [])]),
          ...(spec.model ? { model: spec.model } : {}),
        };
        const aReprendre = opts.resumeKey ? reprenables.get(opts.resumeKey) : undefined;
        if (opts.resumeKey) reprenables.delete(opts.resumeKey);
        session = await (async () => {
          // Une session disparue côté runtime ne doit pas faire échouer le tour : on repart neuf.
          if (aReprendre) {
            const reprise = await deps.runtime.resumeSession(aReprendre, config).catch((err: unknown) => {
              deps.logger?.info("reprise impossible, session neuve", { role: spec.role, sessionId: aReprendre, error: String(err) });
              return null;
            });
            if (reprise) {
              deps.logger?.info("session de tâche reprise", { role: spec.role, sessionId: reprise.id });
              return reprise;
            }
          }
          return deps.runtime.openSession(config);
        })().catch((err: unknown) => {
          throw new EnvFailureError(`Ouverture de session impossible : ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        });
        opts.signal?.addEventListener("abort", onAbort, { once: true });
        deps.logger?.info("agent de tâche lancé", { role: spec.role, sessionId: session.id });

        await turn(prompt);
        if (blocker && !output) return { blocker };
        if (!output && !opts.signal?.aborted)
          await turn(`Tu n'as pas appelé l'outil ${spec.output}. Termine maintenant ta phase en l'appelant avec des arguments valides.`);
        if (opts.signal?.aborted) throw new Error("Annulé");
        if (blocker && !output) return { blocker };
        if (!output) throw new WorkDefectError(`L'agent ${spec.role} n'a pas clôturé sa phase par ${spec.output}.`);
        return { output };
      } catch (err) {
        // Reprenable seulement si le contexte n'est pas en cause (ADR 0030) : le modèle n'a pas
        // répondu, ou l'agent s'est tu. Un plafond de durée ou de coût exclut la reprise — son
        // contexte est la cause de la coupure. `TurnBudgetError` et `TurnCostError` sont des
        // `WorkDefectError` comme `TurnTimeoutError`, d'où le test sur le type exact.
        if (opts.resumeKey && session && (err instanceof EnvFailureError || err instanceof TurnTimeoutError)) {
          reprenables.set(opts.resumeKey, session.id);
          garder = true;
        }
        throw err;
      } finally {
        opts.signal?.removeEventListener("abort", onAbort);
        if (session && !garder) {
          const id = session.id;
          await session.close().catch(() => undefined);
          await deps.runtime.deleteSession(id).catch((err: unknown) => deps.logger?.warn("suppression de session impossible", { sessionId: id, error: String(err) }));
        }
      }
    },
  };
}
