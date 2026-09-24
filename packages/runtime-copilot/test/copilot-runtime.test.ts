import type { MessageOptions, ModelInfo, ResumeSessionConfig, SessionConfig, SessionEvent } from "@github/copilot-sdk";
import type { AgentEvent, AgentSessionConfig } from "@agent-studio/core";
import { describe, expect, it } from "vitest";
import { createCopilotRuntime } from "../src/copilot-runtime.js";
import type { CopilotClientPort, CopilotSessionPort } from "../src/protocols.js";

class FakeSdkSession implements CopilotSessionPort {
  readonly sent: MessageOptions[] = [];
  handlers = new Set<(e: SessionEvent) => void>();
  aborted = false;
  disconnected = false;
  constructor(readonly sessionId: string) {}
  async send(o: MessageOptions) {
    this.sent.push(o);
    return "msg-1";
  }
  on(h: (e: SessionEvent) => void) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }
  emit(type: string, data: Record<string, unknown>) {
    const e = { id: "x", parentId: null, timestamp: "", type, data } as unknown as SessionEvent;
    for (const h of this.handlers) h(e);
  }
  async abort() {
    this.aborted = true;
  }
  async disconnect() {
    this.disconnected = true;
  }
}

class FakeClient implements CopilotClientPort {
  started = false;
  created: SessionConfig[] = [];
  resumed: { id: string; config: ResumeSessionConfig }[] = [];
  deleted: string[] = [];
  last?: FakeSdkSession;
  async start() {
    this.started = true;
  }
  async stop() {
    return [];
  }
  async createSession(config: SessionConfig) {
    this.created.push(config);
    return (this.last = new FakeSdkSession(`sdk-${this.created.length}`));
  }
  async resumeSession(id: string, config: ResumeSessionConfig) {
    this.resumed.push({ id, config });
    return (this.last = new FakeSdkSession(id));
  }
  async deleteSession(id: string) {
    this.deleted.push(id);
  }
  modelsError: Error | null = null;
  models: ModelInfo[] = [];
  listModelsAppels = 0;
  async listModels() {
    this.listModelsAppels++;
    if (this.modelsError) throw this.modelsError;
    return this.models;
  }
}

const modele = (id: string, name: string, over: Partial<ModelInfo> = {}): ModelInfo =>
  ({ id, name, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 1000 } }, ...over }) as ModelInfo;

const cfg = (over: Partial<AgentSessionConfig> = {}): AgentSessionConfig => ({
  role: "main",
  workingDirectory: "/projets/demo",
  systemPrompt: "Rôle.",
  tools: [],
  guard: { check: async () => ({ decision: "allow" }) },
  ...over,
});

describe("CopilotRuntime", () => {
  it("déclare ses capacités", () => {
    const rt = createCopilotRuntime({ client: new FakeClient() });
    expect(rt.id).toBe("copilot-sdk");
    expect(rt.capabilities).toMatchObject({ inProcessHooks: true, terminalTool: "native", usageUnit: "requests", resumableSessions: true });
  });

  it("démarre le client", async () => {
    const client = new FakeClient();
    await createCopilotRuntime({ client }).start();
    expect(client.started).toBe(true);
  });

  it("ouvre une session avec répertoire, prompt système ajouté, modèle et arbitre de permissions", async () => {
    const client = new FakeClient();
    const rt = createCopilotRuntime({ client });
    const s = await rt.openSession(cfg({ model: "gpt-5" }));
    const created = client.created[0]!;
    expect(s.id).toBe("sdk-1");
    expect(created.workingDirectory).toBe("/projets/demo");
    expect(created.model).toBe("gpt-5");
    expect(created.systemMessage).toEqual({ mode: "append", content: "Rôle." });
    expect(created.streaming).toBe(true);
    expect(typeof created.onPermissionRequest).toBe("function");
  });

  it("n'expose jamais l'objet du SDK : la session renvoyée n'a que l'interface du port", async () => {
    const rt = createCopilotRuntime({ client: new FakeClient() });
    const s = await rt.openSession(cfg());
    expect(Object.keys(s).sort()).toEqual(["abort", "close", "id", "onEvent", "send"]);
  });

  it("traduit nos outils en outils SDK, terminaux compris", async () => {
    const client = new FakeClient();
    const calls: unknown[] = [];
    await createCopilotRuntime({ client }).openSession(
      cfg({
        tools: [
          {
            name: "report_phase",
            description: "Clôt la phase",
            parameters: { type: "object", properties: {} },
            terminal: true,
            handler: async (a) => {
              calls.push(a);
              return "ok";
            },
          },
        ],
      }),
    );
    const tool = client.created[0]!.tools![0]!;
    expect(tool).toMatchObject({ name: "report_phase", description: "Clôt la phase", isTerminal: true, skipPermission: true });
    expect(await tool.handler!({ x: 1 }, {} as never)).toBe("ok");
    expect(calls).toEqual([{ x: 1 }]);
  });

  it("relaie les événements normalisés et envoie le prompt", async () => {
    const client = new FakeClient();
    const s = await createCopilotRuntime({ client }).openSession(cfg());
    const seen: AgentEvent[] = [];
    const off = s.onEvent((e) => seen.push(e));
    await s.send("bonjour");
    client.last!.emit("assistant.message", { content: "salut", messageId: "m" });
    client.last!.emit("session.idle", {});
    off();
    client.last!.emit("session.idle", {});
    expect(client.last!.sent).toEqual([{ prompt: "bonjour" }]);
    expect(seen).toEqual([{ type: "message", text: "salut" }, { type: "idle" }]);
  });

  it("un refus de l'arbitre est aussi émis comme événement tool-denied", async () => {
    const client = new FakeClient();
    const s = await createCopilotRuntime({ client }).openSession(
      cfg({ guard: { check: async () => ({ decision: "deny", reason: "non" }) } }),
    );
    const seen: AgentEvent[] = [];
    s.onEvent((e) => seen.push(e));
    const handler = client.created[0]!.onPermissionRequest!;
    await handler({ kind: "shell", fullCommandText: "ls" } as never, { sessionId: "sdk-1" });
    expect(seen).toEqual([{ type: "tool-denied", toolName: "shell", reason: "non" }]);
  });

  it("reprend une session par son identifiant", async () => {
    const client = new FakeClient();
    const s = await createCopilotRuntime({ client }).resumeSession("ancienne", cfg());
    expect(s.id).toBe("ancienne");
    expect(client.resumed[0]?.config.workingDirectory).toBe("/projets/demo");
  });

  it("liste les modèles disponibles avec leur coût relatif", async () => {
    const client = new FakeClient();
    client.models = [
      modele("gpt-5.6-luna", "GPT-5.6 Luna", { billing: { multiplier: 1 } }),
      modele("claude-sonnet-4.5", "Claude Sonnet 4.5", { billing: { multiplier: 3 } }),
    ];
    const rt = createCopilotRuntime({ client });
    expect(await rt.listModels!()).toEqual([
      { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", multiplier: 1 },
      { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", multiplier: 3 },
    ]);
  });

  it("écarte les modèles désactivés par la politique du compte", async () => {
    const client = new FakeClient();
    client.models = [
      modele("autorise", "Autorisé", { policy: { state: "enabled", terms: "" } }),
      modele("refuse", "Refusé", { policy: { state: "disabled", terms: "" } }),
      modele("sans-politique", "Sans politique"),
    ];
    const rt = createCopilotRuntime({ client });
    expect((await rt.listModels!()).map((m) => m.id)).toEqual(["autorise", "sans-politique"]);
  });

  it("une liste indisponible ne casse rien : aucun modèle proposé", async () => {
    const client = new FakeClient();
    client.modelsError = new Error("hors ligne");
    const rt = createCopilotRuntime({ client });
    expect(await rt.listModels!()).toEqual([]);
  });

  it("le modèle choisi est transmis à la session", async () => {
    const client = new FakeClient();
    const rt = createCopilotRuntime({ client });
    await rt.openSession(cfg({ model: "claude-sonnet-4.5" }));
    expect(client.created[0]?.model).toBe("claude-sonnet-4.5");
  });

  it("close() déconnecte ; deleteSession supprime côté runtime", async () => {
    const client = new FakeClient();
    const rt = createCopilotRuntime({ client });
    const s = await rt.openSession(cfg());
    await s.abort();
    await s.close();
    await rt.deleteSession(s.id);
    expect(client.last!.aborted).toBe(true);
    expect(client.last!.disconnected).toBe(true);
    expect(client.deleted).toEqual(["sdk-1"]);
  });
});
