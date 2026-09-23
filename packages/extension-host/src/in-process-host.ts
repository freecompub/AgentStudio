import type {
  Clock,
  EvidenceStore,
  HookRegistry,
  IdGenerator,
  InteractionService,
  Logger,
  Registry,
  TaskAgentRunner,
  ToolCallGuard,
  UsageRecorder,
} from "@agent-studio/core";
import type { ExtensionContext, ExtensionManifest, ExtensionModule } from "@agent-studio/extension-api";
import { fingerprintFiles, type StackAdapter } from "@agent-studio/stack-adapters";
import type { TaskEngine } from "@agent-studio/task-engine";
import type { Workspace } from "@agent-studio/workspace";
import { permissionChecker } from "./permissions.js";
import { createTestRunService, runTestsTool, testFreezeGuard } from "./test-runs.js";

/** Sortie des messages d'extension vers la conversation, origine comprise (D34). */
export interface ExtensionChatSink {
  post(extensionId: string, markdown: string): void;
}

export interface HostDeps {
  registry: Registry;
  engine: TaskEngine;
  agents: TaskAgentRunner;
  workspace: Workspace;
  stack: StackAdapter;
  interactions: InteractionService;
  evidence: EvidenceStore;
  /** Hooks `onPreToolUse` des extensions actives, composés après les gardes du cœur (§5.5). */
  hooks: HookRegistry;
  /** Usage des agents, attribué à la tâche et à son état courant (D37). */
  usage?: UsageRecorder;
  chat: ExtensionChatSink;
  clock: Clock;
  ids: IdGenerator;
  logger?: Logger;
}

export interface LoadedExtension {
  manifest: ExtensionManifest;
  module: ExtensionModule;
}

export interface ExtensionHandle {
  readonly ctx: ExtensionContext;
  deactivate(): Promise<void>;
}

/**
 * Hôte d'extension **en processus** (J2) : construit le `ctx` d'une extension au-dessus des
 * services du cœur. Chaque appel vérifie la permission déclarée. L'isolation en
 * `utilityProcess` (J4) réutilisera ce même contexte côté principal, derrière un RPC.
 */
export async function activateInProcess(ext: LoadedExtension, deps: HostDeps): Promise<ExtensionHandle> {
  const { manifest } = ext;
  const perm = permissionChecker(manifest);
  const log = deps.logger?.child({ extensionId: manifest.id });
  const declared = {
    commands: new Map((manifest.contributes.commands ?? []).map((c) => [c.name, c])),
    agents: new Map((manifest.contributes.agents ?? []).map((a) => [a.name, a])),
    tasks: new Set((manifest.contributes.tasks ?? []).map((t) => t.name)),
  };
  const writeGlobs = new Set(perm.writeGlobs());
  for (const a of declared.agents.values())
    for (const g of a.write ?? [])
      if (!writeGlobs.has(g)) throw new Error(`L'agent ${a.name} écrit dans ${g} sans la permission fs:write:${g}`);

  for (const a of declared.agents.values())
    deps.registry.addAgent({ extensionId: manifest.id, name: a.name, systemPrompt: a.role, writable: a.write ?? [], output: a.output });

  const taskName = (name: string) => `${manifest.id}/${name}`;
  const testRuns = createTestRunService(deps);
  for (const a of declared.agents.values())
    if (a.tools?.includes("run_tests") && !perm.has("shell:test"))
      throw new Error(`L'agent ${a.name} utilise run_tests sans la permission shell:test`);

  const ctx: ExtensionContext = {
    extensionId: manifest.id,

    chat: {
      registerCommand(name, handler) {
        const c = declared.commands.get(name);
        if (!c) throw new Error(`Commande non déclarée dans le manifeste : ${name}`);
        deps.registry.addCommand({ extensionId: manifest.id, name, title: c.title, description: c.description, handler });
        return { dispose: () => undefined };
      },
      post: (markdown) => deps.chat.post(manifest.id, markdown),
    },

    agents: {
      async run(name, prompt, opts) {
        perm.require("copilot:sessions");
        const a = declared.agents.get(name);
        if (!a) throw new Error(`Agent non déclaré dans le manifeste : ${name}`);
        let frozen = false;
        const taskId = opts?.evidence?.taskId;
        const phase = taskId ? ((await deps.engine.phaseOf(taskId)) ?? opts?.evidence?.phase ?? "?") : null;
        const r = await deps.agents.run(
          { role: `${manifest.id}/${name}`, systemPrompt: a.role, writable: a.write ?? [], output: a.output },
          prompt,
          {
            ...(opts?.signal ? { signal: opts.signal } : {}),
            ...(deps.usage && taskId && phase ? { onUsage: (u: import("@agent-studio/core").UsageDelta) => void deps.usage!.add(taskId, phase, u).catch(() => undefined) } : {}),
            ...(a.tools?.includes("run_tests")
              ? {
                  tools: (beat: () => void) => [
                    runTestsTool(testRuns, {
                      beat,
                      ...(opts?.signal ? { signal: opts.signal } : {}),
                      ...(opts?.evidence ? { tag: opts.evidence } : {}),
                      onRun: (run) => {
                        if (opts?.freezeTestsAfterRed && run.results.some((t) => t.status === "failed")) frozen = true;
                      },
                    }),
                  ],
                }
              : {}),
            guards: [
              ...(opts?.freezeTestsAfterRed ? [testFreezeGuard(deps.workspace.root, (p) => deps.stack.isTestFile(p), () => frozen)] : []),
              ...deps.hooks.guards(),
            ],
          },
        );
        return { output: structuredClone(r.output) } as never;
      },
    },

    workspace: {
      readFile: async (p) => (perm.require("fs:read"), deps.workspace.files.read(p)),
      listFiles: async () => (perm.require("fs:read"), deps.workspace.files.list()),
      checkpoint: async (label) => ({ id: (await deps.workspace.checkpoints.create(label)).id }),
      rollback: async (id) => (perm.require("git:revert"), deps.workspace.checkpoints.rollback(id)),
      changedFiles: async (id) => (perm.require("fs:read"), (await deps.workspace.checkpoints.diff(id)).files),
      async fingerprintTests() {
        perm.require("fs:read");
        return fingerprintFiles(deps.workspace.files, (p) => deps.stack.isTestFile(p));
      },
    },

    git: {
      commit: async (message, opts) => (perm.require("git:commit"), deps.workspace.repo.commit(message, opts)),
      head: () => deps.workspace.repo.head(),
    },

    stack: {
      runTests: async (opts) => {
        perm.require("shell:test");
        return testRuns.run({ source: "gate", ...(opts?.signal ? { signal: opts.signal } : {}), ...(opts?.evidence ? { tag: opts.evidence } : {}) });
      },
      isTestFile: (p) => deps.stack.isTestFile(p),
    },

    tasks: {
      register(def) {
        if (!declared.tasks.has(def.name)) throw new Error(`Tâche non déclarée dans le manifeste : ${def.name}`);
        deps.engine.register({ ...def, name: taskName(def.name) }, ctx);
      },
      start: (name, input) => deps.engine.start(taskName(name), input),
      dispatch: (taskId, event) => deps.engine.dispatch(taskId, event),
      cancel: (taskId) => deps.engine.cancel(taskId),
    },

    interactions: {
      request: (req) => deps.interactions.request({ ...req, extensionId: manifest.id }),
    },

    evidence: {
      list: async (taskId) => (perm.require("fs:read"), deps.evidence.list(taskId)),
    },

    hooks: {
      onPreToolUse(handler) {
        const guard: ToolCallGuard = {
          async check(req) {
            const call = { kind: req.kind, toolName: req.toolName, ...(req.path ? { path: req.path } : {}), ...(req.command ? { command: req.command } : {}), ...(req.url ? { url: req.url } : {}) };
            const d = await handler(call);
            return d?.decision === "deny" ? { decision: "deny", reason: `[${manifest.id}] ${d.reason}` } : { decision: "allow" };
          },
        };
        const remove = deps.hooks.add(manifest.id, guard);
        return { dispose: remove };
      },
    },

    log: {
      info: (msg, fields) => log?.info(msg, fields),
      warn: (msg, fields) => log?.warn(msg, fields),
    },
  };

  try {
    await ext.module.activate(ctx);
  } catch (err) {
    deps.registry.removeExtension(manifest.id);
    deps.hooks.removeExtension(manifest.id);
    throw err;
  }
  log?.info("extension activée (en processus)");

  return {
    ctx,
    async deactivate() {
      await ext.module.deactivate?.();
      deps.registry.removeExtension(manifest.id);
      deps.hooks.removeExtension(manifest.id);
    },
  };
}
