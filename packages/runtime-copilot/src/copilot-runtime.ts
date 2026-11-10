import type { ModelInfo, SessionConfigBase } from "@github/copilot-sdk";
import type { AgentEvent, AgentRuntime, AgentSession, AgentSessionConfig, Logger, ToolCallRequest } from "@agent-studio/core";
import { mapSessionEvent } from "./events/map-session-event.js";
import { createPermissionHandler } from "./permissions/permission-handler.js";
import type { CopilotClientPort, CopilotSessionPort } from "./protocols.js";
import { toSdkTool } from "./tools/to-sdk-tool.js";

export interface CopilotRuntimeDeps {
  client: CopilotClientPort;
  logger?: Logger;
}

/** Ce sur quoi porte un appel : commande, chemin ou URL selon la sorte. */
const cible = (r: ToolCallRequest): string | undefined => r.command ?? r.path ?? r.url;

/** Adaptateur `AgentRuntime` pour le Copilot SDK (D3, D35). */
export function createCopilotRuntime(deps: CopilotRuntimeDeps): AgentRuntime {
  const { client, logger } = deps;
  let modelCatalog: Promise<ModelInfo[]> | undefined;

  function sessionOptions(cfg: AgentSessionConfig, emettre: (e: AgentEvent) => void): SessionConfigBase {
    return {
      workingDirectory: cfg.workingDirectory,
      systemMessage: { mode: "append", content: cfg.systemPrompt },
      streaming: true,
      tools: cfg.tools.map(toSdkTool),
      onPermissionRequest: createPermissionHandler(cfg.guard, {
        ...(cfg.guardTimeoutMs !== undefined ? { timeoutMs: cfg.guardTimeoutMs } : {}),
        onDenied: (req, reason) => {
          // La cible — commande, chemin, URL — était calculée puis jetée. Sans elle, un refus ne
          // dit que « quelque chose a été interdit », ce qui n'aide ni à diagnostiquer un agent
          // qui se heurte en boucle, ni à repérer une tentative anormale.
          logger?.info("outil refusé", { role: cfg.role, toolName: req.toolName, kind: req.kind, cible: cible(req), reason });
          emettre({ type: "tool-denied", toolName: req.toolName, reason });
        },
        onDecision: (req, decision) =>
          emettre({
            type: "permission",
            kind: req.kind,
            toolName: req.toolName,
            ...(cible(req) !== undefined ? { target: cible(req)! } : {}),
            decision: decision.decision,
            ...(decision.decision === "deny" ? { reason: decision.reason } : {}),
          }),
      }),
      ...(cfg.model ? { model: cfg.model } : {}),
      ...(cfg.reasoningEffort ? { reasoningEffort: cfg.reasoningEffort } : {}),
      ...(cfg.contextTier ? { contextTier: cfg.contextTier } : {}),
    };
  }

  /**
   * L'effort et le contexte long qu'un rôle demande (ADR 0077), gardés seulement si le modèle choisi
   * les déclare. Sinon ils sont abandonnés avec un avertissement, et la session s'ouvre quand même :
   * échouer arrêtait DESIGN à chaque run, y compris sans modèle choisi, la configuration par défaut.
   */
  async function optionsHonorables(cfg: AgentSessionConfig): Promise<AgentSessionConfig> {
    if (!cfg.reasoningEffort && cfg.contextTier !== "long_context") return cfg;
    const { reasoningEffort, contextTier, ...reste } = cfg;
    const sans = (garder: { effort: boolean; contexte: boolean }, raison: string): AgentSessionConfig => {
      logger?.warn("options de modèle ignorées", { role: cfg.role, raison });
      return { ...reste, ...(garder.effort && reasoningEffort ? { reasoningEffort } : {}), ...(garder.contexte && contextTier ? { contextTier } : {}) };
    };
    const aucune = { effort: false, contexte: false };
    if (!cfg.model) return sans(aucune, "aucun modèle explicite : le runtime choisit le sien, sans garantie d'effort ni de contexte");
    let models: ModelInfo[];
    try {
      modelCatalog ??= client.listModels();
      models = await modelCatalog;
    } catch (err: unknown) {
      modelCatalog = undefined;
      return sans(aucune, `catalogue des modèles illisible (${err instanceof Error ? err.message : String(err)}) : effort et contexte non vérifiables`);
    }
    const model = models.find((m) => m.id === cfg.model);
    if (!model) return sans(aucune, `le modèle « ${cfg.model} » est absent du catalogue Copilot`);
    const effortOk = !reasoningEffort || (model.supportedReasoningEfforts?.includes(reasoningEffort) ?? false);
    const contexteOk = contextTier !== "long_context" || (Boolean(model.billing?.tokenPrices?.longContext) && model.capabilities.limits.max_context_window_tokens >= 1_000_000);
    if (effortOk && contexteOk) return cfg;
    const raisons = [
      ...(effortOk ? [] : [`le modèle « ${cfg.model} » ne déclare pas l'effort ${reasoningEffort}`]),
      ...(contexteOk ? [] : [`le modèle « ${cfg.model} » ne déclare pas de contexte d'au moins 1M tokens`]),
    ];
    return sans({ effort: effortOk, contexte: contexteOk }, raisons.join(" ; "));
  }

  /** Enveloppe : seule l'interface du port sort de ce paquet (D10). */
  function wrap(sdk: CopilotSessionPort, listeners: Set<(e: AgentEvent) => void>): AgentSession {
    const offSdk = sdk.on((ev) => {
      const mapped = mapSessionEvent(ev);
      for (const l of [...listeners]) l(mapped);
    });
    return {
      id: sdk.sessionId,
      send: async (prompt) => {
        await sdk.send({ prompt });
      },
      onEvent: (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      abort: () => sdk.abort(),
      close: async () => {
        offSdk();
        listeners.clear();
        await sdk.disconnect();
      },
    };
  }

  function listenerSet() {
    const listeners = new Set<(e: AgentEvent) => void>();
    const broadcast = (e: AgentEvent) => {
      for (const l of [...listeners]) l(e);
    };
    return { listeners, broadcast };
  }

  return {
    id: "copilot-sdk",
    capabilities: {
      inProcessHooks: true,
      customTools: "native",
      terminalTool: "native",
      fileMediation: false,
      usageUnit: "requests",
      resumableSessions: true,
    },
    /**
     * Modèles réellement disponibles pour ce compte (ADR 0020). Un échec (hors ligne, quota)
     * ne doit pas empêcher de converser : la liste est alors vide et le runtime décide.
     */
    async listModels() {
      try {
        return (await client.listModels())
          .filter((m) => m.policy?.state !== "disabled")
          // « auto » est le routage automatique du runtime : c'est déjà ce que fait l'absence
          // de choix. L'afficher ferait deux entrées pour le même comportement.
          .filter((m) => m.id !== "auto")
          .map((m) => ({ id: m.id, name: m.name, ...(m.billing?.multiplier !== undefined ? { multiplier: m.billing.multiplier } : {}) }));
      } catch (err) {
        logger?.warn("liste des modèles indisponible", { error: String(err) });
        return [];
      }
    },

    start: () => client.start(),
    stop: async () => {
      const errors = await client.stop();
      for (const e of errors) logger?.warn("erreur à l'arrêt du runtime", { error: e.message });
    },
    async openSession(demande) {
      const cfg = await optionsHonorables(demande);
      const { listeners, broadcast } = listenerSet();
      const sdk = await client.createSession(sessionOptions(cfg, broadcast));
      logger?.info("session ouverte", { sessionId: sdk.sessionId, role: cfg.role });
      return wrap(sdk, listeners);
    },
    async resumeSession(id, demande) {
      const cfg = await optionsHonorables(demande);
      const { listeners, broadcast } = listenerSet();
      const sdk = await client.resumeSession(id, sessionOptions(cfg, broadcast));
      logger?.info("session reprise", { sessionId: sdk.sessionId, role: cfg.role });
      return wrap(sdk, listeners);
    },
    // Une session que le runtime ne connaît plus (dossier de données effacé) ne peut pas être
    // supprimée : c'est un succès, sinon le registre la retenterait à chaque démarrage (revue de la
    // PR #12). Le SDK ne distingue pas ce cas dans son erreur ; ses métadonnées, si.
    async deleteSession(id) {
      try {
        await client.deleteSession(id);
      } catch (err) {
        if ((await client.getSessionMetadata(id).catch(() => null)) === undefined) return;
        throw err;
      }
    },
  };
}
