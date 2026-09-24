import { pathToFileURL } from "node:url";
import type { ExtensionContext, ExtensionModule, TaskDefinition } from "@agent-studio/extension-api";
import { createRpcEndpoint, type RpcEndpoint } from "../rpc/endpoint.js";
import type { MessageChannelLike } from "../rpc/protocol.js";

export interface ActivationRequest {
  extensionId: string;
  layout: { acceptanceTests: string[]; unitTests: string[]; sources: string[] };
  /** Ce que la stack tient pour de l'infrastructure : transmis, l'extension ne le devine pas. */
  infrastructureModules: string[];
  /** Chemin absolu de l'entrée compilée de l'extension. */
  entry: string;
  testFilePattern: string;
}

type AnyTask = TaskDefinition<unknown, { type: string }, unknown, ExtensionContext>;

/**
 * Runtime de l'hôte d'extension (processus isolé). L'extension ne reçoit qu'un `ctx` mandataire :
 * chaque appel part au principal, qui vérifie la permission et exécute (D10, D11).
 */
export function runExtensionChild(channel: MessageChannelLike): RpcEndpoint {
  let module: ExtensionModule | null = null;
  let ctx: ExtensionContext | null = null;
  const commands = new Map<string, (args: string) => Promise<void>>();
  const tasks = new Map<string, AnyTask>();
  const hooks = new Map<number, Parameters<ExtensionContext["hooks"]["onPreToolUse"]>[0]>();
  const tools = new Map<string, Parameters<ExtensionContext["tools"]["register"]>[0]>();
  const registrations: Promise<unknown>[] = [];
  let hookSeq = 0;

  const task = (name: unknown) => {
    const t = tasks.get(String(name));
    if (!t) throw new Error(`Tâche inconnue dans l'hôte : ${String(name)}`);
    return t;
  };

  const endpoint: RpcEndpoint = createRpcEndpoint(channel, {
    async activate([req]) {
      const r = req as ActivationRequest;
      const imported = (await import(pathToFileURL(r.entry).href)) as { default?: ExtensionModule } & Partial<ExtensionModule>;
      module = imported.default ?? (imported as ExtensionModule);
      if (typeof module.activate !== "function") throw new Error("L'entrée de l'extension n'exporte pas activate()");
      ctx = proxyContext(r);
      await module.activate(ctx);
      await Promise.all(registrations); // une contribution refusée fait échouer l'activation
      return null;
    },
    async deactivate() {
      await module?.deactivate?.();
      return null;
    },
    "command.invoke": async ([name, args]) => {
      const h = commands.get(String(name));
      if (!h) throw new Error(`Commande inconnue dans l'hôte : ${String(name)}`);
      await h(String(args));
      return null;
    },
    "task.initialState": async ([name, input]) => task(name).initialState(input),
    "task.initialEffects": async ([name, state]) => task(name).initialEffects(state),
    "task.transition": async ([name, state, event]) => task(name).transition(state, event as { type: string }),
    "task.isTerminal": async ([name, state]) => task(name).isTerminal(state),
    "task.checkpointBefore": async ([name, effect]) => (await task(name).checkpointBefore?.(effect)) ?? true,
    "task.phaseOf": async ([name, state]) => {
      const t = task(name);
      if (t.phaseOf) return t.phaseOf(state);
      const p = (state as { phase?: unknown } | null)?.phase;
      return typeof p === "string" ? p : "?";
    },
    "task.runEffect": async ([name, effect, ec], { signal }) => {
      const e = ec as { taskId: string; state: unknown };
      return (await task(name).runEffect(effect, ctx!, { taskId: e.taskId, state: e.state, signal })) ?? null;
    },
    "tool.invoke": async ([name, args]) => {
      const t = tools.get(String(name));
      if (!t) throw new Error(`Outil inconnu dans l'hôte : ${String(name)}`);
      return t.handler(args);
    },
    "hook.preToolUse": async ([id, call]) => {
      const h = hooks.get(Number(id));
      return h ? ((await h(call as never)) ?? null) : null;
    },
  });

  const call = (name: string, args: unknown[], signal?: AbortSignal) =>
    endpoint.call("ctx", [name, args], signal ? { signal } : {}) as Promise<never>;

  function register(p: Promise<unknown>): void {
    registrations.push(p);
    p.catch(() => undefined); // l'erreur est remontée par activate()
  }

  function proxyContext(r: ActivationRequest): ExtensionContext {
    const testFile = new RegExp(r.testFilePattern);
    return {
      extensionId: r.extensionId,
      chat: {
        registerCommand(name, handler) {
          commands.set(name, handler);
          register(call("chat.registerCommand", [name]));
          return { dispose: () => void commands.delete(name) };
        },
        post: (md) => void call("chat.post", [md]).catch(() => undefined),
      },
      agents: {
        run: (name, prompt, opts) => {
          const { signal, ...rest } = opts ?? {};
          return call("agents.run", [name, prompt, rest], signal);
        },
      },
      workspace: {
        readFile: (p) => call("workspace.readFile", [p]),
        writeFile: (p, content) => call("workspace.writeFile", [p, content]),
        listFiles: () => call("workspace.listFiles", []),
        checkpoint: (label) => call("workspace.checkpoint", [label]),
        rollback: (id) => call("workspace.rollback", [id]),
        changedFiles: (id) => call("workspace.changedFiles", [id]),
        fingerprintTests: () => call("workspace.fingerprintTests", []),
        fingerprint: (globs) => call("workspace.fingerprint", [globs]),
      },
      git: {
        commit: (message, opts) => call("git.commit", [message, opts ?? {}]),
        head: () => call("git.head", []),
        branch: (name) => call("git.branch", [name]),
      },
      stack: {
        runTests: (opts) => {
          const { signal, ...rest } = opts ?? {};
          return call("stack.runTests", [rest], signal);
        },
        isTestFile: (p) => testFile.test(p.replaceAll("\\", "/")),
        layout: r.layout,
        infrastructureModules: r.infrastructureModules,
        mutation: (opts) => call("stack.mutation", [], opts?.signal),
        architecture: (rules) => call("stack.architecture", [rules]),
        lint: (opts) => call("stack.lint", [opts?.files ? { files: opts.files } : undefined], opts?.signal),
      },
      tasks: {
        register(def) {
          tasks.set(def.name, def as unknown as AnyTask);
          register(call("tasks.register", [{ name: def.name }]));
        },
        start: (name, input) => call("tasks.start", [name, input]),
        dispatch: (id, event) => call("tasks.dispatch", [id, event]),
        cancel: (id) => call("tasks.cancel", [id]),
      },
      interactions: { request: (req) => call("interactions.request", [req]) },
      evidence: { list: (taskId) => call("evidence.list", [taskId]) },
      tools: {
        register(tool) {
          tools.set(tool.name, tool);
          register(call("tools.register", [{ name: tool.name, description: tool.description, parameters: tool.parameters }]));
          return { dispose: () => void tools.delete(tool.name) };
        },
      },
      hooks: {
        onPreToolUse(handler) {
          const id = ++hookSeq;
          hooks.set(id, handler);
          register(call("hooks.onPreToolUse", [id]));
          return { dispose: () => void hooks.delete(id) };
        },
      },
      log: {
        info: (msg, fields) => void call("log.info", [msg, fields ?? {}]).catch(() => undefined),
        warn: (msg, fields) => void call("log.warn", [msg, fields ?? {}]).catch(() => undefined),
      },
    };
  }

  return endpoint;
}
