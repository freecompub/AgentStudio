import type { SessionConfigBase } from "@github/copilot-sdk";
import type { AgentEvent, AgentRuntime, AgentSession, AgentSessionConfig, Logger } from "@agent-studio/core";
import { mapSessionEvent } from "./events/map-session-event.js";
import { createPermissionHandler } from "./permissions/permission-handler.js";
import type { CopilotClientPort, CopilotSessionPort } from "./protocols.js";
import { toSdkTool } from "./tools/to-sdk-tool.js";

export interface CopilotRuntimeDeps {
  client: CopilotClientPort;
  logger?: Logger;
}

/** Adaptateur `AgentRuntime` pour le Copilot SDK (D3, D35). */
export function createCopilotRuntime(deps: CopilotRuntimeDeps): AgentRuntime {
  const { client, logger } = deps;

  function sessionOptions(cfg: AgentSessionConfig, denied: (e: AgentEvent) => void): SessionConfigBase {
    return {
      workingDirectory: cfg.workingDirectory,
      systemMessage: { mode: "append", content: cfg.systemPrompt },
      streaming: true,
      tools: cfg.tools.map(toSdkTool),
      onPermissionRequest: createPermissionHandler(cfg.guard, {
        ...(cfg.guardTimeoutMs !== undefined ? { timeoutMs: cfg.guardTimeoutMs } : {}),
        onDenied: (req, reason) => {
          logger?.info("outil refusé", { role: cfg.role, toolName: req.toolName, kind: req.kind, reason });
          denied({ type: "tool-denied", toolName: req.toolName, reason });
        },
      }),
      ...(cfg.model ? { model: cfg.model } : {}),
    };
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
    start: () => client.start(),
    stop: async () => {
      const errors = await client.stop();
      for (const e of errors) logger?.warn("erreur à l'arrêt du runtime", { error: e.message });
    },
    async openSession(cfg) {
      const { listeners, broadcast } = listenerSet();
      const sdk = await client.createSession(sessionOptions(cfg, broadcast));
      logger?.info("session ouverte", { sessionId: sdk.sessionId, role: cfg.role });
      return wrap(sdk, listeners);
    },
    async resumeSession(id, cfg) {
      const { listeners, broadcast } = listenerSet();
      const sdk = await client.resumeSession(id, sessionOptions(cfg, broadcast));
      logger?.info("session reprise", { sessionId: sdk.sessionId, role: cfg.role });
      return wrap(sdk, listeners);
    },
    deleteSession: (id) => client.deleteSession(id),
  };
}
