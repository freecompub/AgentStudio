import type { AgentEvent, AgentRuntime, AgentSession, ToolCallGuard, ToolSpec } from "../protocols/agent-runtime.js";
import type { Logger } from "../protocols/logger.js";
import type { UsageDelta } from "../protocols/usage.js";
import type { TraceBody, TraceEntry, TraceStore, TurnEnd } from "../protocols/trace.js";
import { TurnBudgetError, TurnContextError, TurnCostError } from "../turns/run-turn.js";
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
  /** Tâche et phase auxquelles rattacher la trace (ADR 0032) ; absentes, rien n'est tracé. */
  trace?: { taskId: string; phase?: string };
}

/** Sortie structurée du rôle, ou blocage signalé par `report_blocker`. */
export type TaskAgentResult<N extends TerminalToolName> =
  | { output: TerminalOutput<N>; blocker?: undefined }
  | { output?: undefined; blocker: TerminalOutput<"report_blocker"> };

export interface TaskAgentRunner {
  run<N extends TerminalToolName>(spec: TaskAgentSpec<N>, prompt: string, opts?: TaskAgentRunOptions): Promise<TaskAgentResult<N>>;
  /**
   * Libère les sessions d'une tâche terminée (ADR 0039).
   *
   * Les sessions survivent désormais d'un essai à l'autre. Sans ce point de libération elles ne
   * seraient plus jamais supprimées et leur état s'accumulerait sur le disque : elles restent
   * éphémères, mais à l'échelle de la **tâche** et non du tour.
   */
  releaseTask(taskId: string): Promise<void>;
  /**
   * Libère les sessions de certains rôles d'une tâche en cours (ADR 0050).
   *
   * `releaseTask` clôt la tâche entière ; ici la tâche continue, mais le travail de ces rôles a été
   * rembobiné. Garder leur conversation reviendrait à leur faire corriger des fichiers effacés —
   * l'incohérence que l'ADR 0040 a levée pour le réessai, et qui restait sur le chemin d'escalade.
   */
  releaseRoles(taskId: string, roles: readonly string[]): Promise<void>;
}

export interface TaskAgentRunnerDeps {
  runtime: AgentRuntime;
  root: string;
  idleMs?: number;
  /** Plafond de durée totale d'un tour (ADR 0026). */
  maxMs?: number;
  /** Plafond du cumul des tokens d'entrée d'un tour (ADR 0027, désactivé par défaut depuis 0031). */
  maxInputTokens?: number;
  /** Fraction de la fenêtre de contexte au-delà de laquelle le tour est coupé (ADR 0031). */
  maxContextFraction?: number;
  logger?: Logger;
  /** Trace d'exécution (ADR 0032). Son échec n'interrompt jamais un tour : elle observe, elle ne décide pas. */
  trace?: TraceStore;
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
    async releaseTask(taskId) {
      const prefixe = `${taskId}/`;
      for (const [cle, id] of [...reprenables]) {
        if (!cle.startsWith(prefixe)) continue;
        reprenables.delete(cle);
        await deps.runtime.deleteSession(id).catch((err: unknown) => deps.logger?.warn("suppression de session impossible", { sessionId: id, error: String(err) }));
      }
    },
    async releaseRoles(taskId, roles) {
      for (const role of roles) {
        // Clé de continuité : `<taskId>/<extension>/<rôle>` (voir `resumeKey`). Le suffixe suffit
        // à viser un rôle sans connaître l'extension qui le déclare.
        const suffixe = `/${role}`;
        for (const [cle, id] of [...reprenables]) {
          if (!cle.startsWith(`${taskId}/`) || !cle.endsWith(suffixe)) continue;
          reprenables.delete(cle);
          await deps.runtime.deleteSession(id).catch((err: unknown) => deps.logger?.warn("suppression de session impossible", { sessionId: id, error: String(err) }));
        }
      }
    },

    async run(spec, prompt, opts = {}) {
      let output: TerminalOutput<typeof spec.output> | undefined;
      let blocker: TerminalOutput<"report_blocker"> | undefined;
      let session: AgentSession | undefined;
      /** Session laissée en vie pour que le tour suivant la reprenne (ADR 0030). */
      let garder = false;

      /**
       * Écrit une entrée de trace (ADR 0032). Silencieuse par construction : une trace qui ferait
       * échouer le tour qu'elle observe serait pire que pas de trace du tout.
       */
      const tracer = (e: TraceBody): void => {
        if (!deps.trace || !opts.trace) return;
        void deps.trace
          .append({
            taskId: opts.trace.taskId,
            at: new Date().toISOString(),
            ...(session ? { sessionId: session.id } : {}),
            role: spec.role,
            ...e,
          } as TraceEntry)
          .catch((err: unknown) => deps.logger?.warn("trace non écrite", { error: String(err) }));
      };

      /** Ce qui a mis fin au tour, nommé par sa cause et non par son type d'erreur. */
      const finDe = (err: unknown): TurnEnd => {
        if (err instanceof TurnContextError) return "contexte";
        if (err instanceof TurnBudgetError) return "durée";
        if (err instanceof TurnCostError) return "coût";
        if (err instanceof TurnTimeoutError) return "silence";
        if (err instanceof EnvFailureError) return "panne";
        if (err instanceof WorkDefectError) return "sans-sortie";
        return "annulé";
      };
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
            ...(deps.maxContextFraction !== undefined ? { maxContextFraction: deps.maxContextFraction } : {}),
            onEvent: (e) => {
              if (e.type === "usage") {
                multiplier ??= e.multiplier;
                inputTokens += e.inputTokens ?? 0;
                outputTokens += e.outputTokens ?? 0;
              }
              if (e.type === "message") tracer({ kind: "message", texte: e.text });
              else if (e.type === "reasoning") tracer({ kind: "raisonnement", texte: e.text });
              else if (e.type === "tool-start") tracer({ kind: "outil", nom: e.toolName, appel: e.toolCallId });
              else if (e.type === "tool-end")
                tracer({
                  kind: "outil-fin",
                  appel: e.toolCallId,
                  succès: e.success,
                  // Sans le motif, la trace dit « échoué » et n'apprend rien (ADR 0037).
                  ...(e.error ? { erreur: [e.error.code, e.error.message, e.error.remediation].filter(Boolean).join(" — ") } : {}),
                });
              else if (e.type === "permission")
                tracer({
                  kind: "permission",
                  sorte: e.kind,
                  outil: e.toolName,
                  ...(e.target !== undefined ? { cible: e.target } : {}),
                  décision: e.decision,
                  ...(e.reason !== undefined ? { raison: e.reason } : {}),
                });
              else if (e.type === "usage")
                tracer({
                  kind: "usage",
                  ...(e.model !== undefined ? { modèle: e.model } : {}),
                  ...(e.inputTokens !== undefined ? { entrée: e.inputTokens } : {}),
                  ...(e.outputTokens !== undefined ? { sortie: e.outputTokens } : {}),
                  ...(e.nanoAiu !== undefined ? { nanoAiu: e.nanoAiu } : {}),
                });
              else if (e.type === "context")
                tracer({
                  kind: "contexte",
                  occupés: e.currentTokens,
                  limite: e.tokenLimit,
                  ...(e.systemTokens !== undefined ? { système: e.systemTokens } : {}),
                  ...(e.conversationTokens !== undefined ? { conversation: e.conversationTokens } : {}),
                  ...(e.toolDefinitionsTokens !== undefined ? { outils: e.toolDefinitionsTokens } : {}),
                  ...(e.messages !== undefined ? { messages: e.messages } : {}),
                });
              opts.onEvent?.(e);
            },
          });
        } finally {
          opts.onUsage?.({ requests: multiplier ?? 1, inputTokens, outputTokens });
        }
      };
      /**
       * L'agent a posé une question (ADR 0030, amendée). Ce n'est **pas** un échec : il a fait ce
       * qu'on lui demande — s'arrêter plutôt qu'inventer. C'est donc le cas le plus clairement
       * reprenable de tous, et c'était le seul qu'on punissait en supprimant sa session : il
       * reperdait, à chaque question, tout ce qu'il avait lu du dépôt.
       */
      const questionPosee = () => {
        if (opts.resumeKey && session) {
          reprenables.set(opts.resumeKey, session.id);
          garder = true;
        }
        tracer({ kind: "tour-fin", fin: "blocker", sortie: blocker });
        return { blocker: blocker! };
      };
      const onAbort = () => void session?.abort();
      try {
        if (opts.signal?.aborted) throw new Error("Annulé");
        const outilsPropres = opts.tools?.(() => heartbeat.beat()) ?? [];
        const outilsDuRole = outilsPropres.map((t) => t.name);
        const config = {
          role: spec.role,
          workingDirectory: deps.root,
          systemPrompt: spec.systemPrompt,
          tools: [
            terminalTool(spec.output, (o) => void (output = o)),
            ...(spec.blocker ? [terminalTool("report_blocker", (b) => void (blocker = b))] : []),
            ...outilsPropres,
          ],
          guard: composeGuards([createTaskAgentGuard({ root: deps.root, writable: spec.writable, outils: outilsDuRole }), ...(opts.guards ?? [])]),
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
        tracer({ kind: "tour-début", prompt, ...(opts.trace?.phase ? { phase: opts.trace.phase } : {}), repris: session.id === aReprendre });

        await turn(prompt);
        if (blocker && !output) return questionPosee();
        if (!output && !opts.signal?.aborted)
          await turn(`Tu n'as pas appelé l'outil ${spec.output}. Termine maintenant ta phase en l'appelant avec des arguments valides.`);
        if (opts.signal?.aborted) throw new Error("Annulé");
        if (blocker && !output) return questionPosee();
        if (!output) throw new WorkDefectError(`L'agent ${spec.role} n'a pas clôturé sa phase par ${spec.output}.`);
        tracer({ kind: "tour-fin", fin: "output", sortie: output });
        // La session survit à un tour clos normalement (ADR 0039). D17 dit « une session neuve par
        // phase/rôle » : trois essais de DESIGN par le même architecte sont la même phase et le même
        // rôle. Sans cela, corriger un identifiant mal nommé oblige l'agent à relire tout le dépôt.
        if (opts.resumeKey && session) {
          reprenables.set(opts.resumeKey, session.id);
          garder = true;
        }
        return { output };
      } catch (err) {
        tracer({ kind: "tour-fin", fin: finDe(err), raison: err instanceof Error ? err.message : String(err) });
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
