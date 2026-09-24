import type { AgentRuntime } from "../protocols/agent-runtime.js";

/**
 * `AgentRuntime` obtenu au premier usage (authentification, démarrage du CLI) : les services
 * qui en dépendent peuvent être assemblés avant que l'utilisateur soit connecté.
 */
export function createLazyRuntime(load: () => Promise<AgentRuntime>): AgentRuntime {
  let pending: Promise<AgentRuntime> | null = null;
  const get = () => {
    pending ??= load().catch((err: unknown) => {
      pending = null;
      throw err;
    });
    return pending;
  };
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
    start: async () => void (await get()),
    stop: async () => {
      if (pending) await (await pending).stop();
    },
    openSession: async (cfg) => (await get()).openSession(cfg),
    resumeSession: async (id, cfg) => (await get()).resumeSession(id, cfg),
    deleteSession: async (id) => (await get()).deleteSession(id),
  };
}
