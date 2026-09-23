import { dirname } from "node:path";
import type { ExtensionContext, ExtensionManifest, ExtensionModule, TaskDefinition } from "@agent-studio/extension-api";
import type { ActivationRequest } from "./child/runtime.js";
import { activateInProcess, type ExtensionHandle, type HostDeps } from "./in-process-host.js";
import type { ChildHandle, ProcessLauncher } from "./launchers/protocol.js";
import { createRpcEndpoint, type RpcEndpoint } from "./rpc/endpoint.js";

export interface IsolatedExtension {
  manifest: ExtensionManifest;
  /** Chemin absolu du dossier de l'extension (seul dossier lisible par son hôte). */
  directory: string;
  /** Chemin absolu de l'entrée compilée (manifest.main résolu). */
  entry: string;
}

export interface IsolatedHostOptions {
  launcher: ProcessLauncher;
  /** Bundle du runtime enfant (`extension-child.mjs`). */
  runtimeEntry: string;
  /** Redémarrages tolérés par heure avant désactivation (§4.1). */
  maxRestartsPerHour?: number;
  activationTimeoutMs?: number;
  hookTimeoutMs?: number;
  /** Appelé quand l'extension est désactivée pour la session. */
  onDisabled?(reason: string): void;
  now?: () => number;
}

export interface IsolatedHandle extends ExtensionHandle {
  readonly pid: number | undefined;
  /** Activation terminée : toutes les contributions sont enregistrées. */
  readonly active: boolean;
  readonly disabled: boolean;
}

type AnyTask = TaskDefinition<unknown, { type: string }, unknown, ExtensionContext>;
type Dispatch = (ctx: ExtensionContext, args: unknown[], signal: AbortSignal, rpc: RpcEndpoint) => unknown;

/** Appels autorisés depuis l'hôte d'extension : liste blanche, chacun passe par le `ctx` contrôlé. */
const CALLS: Record<string, Dispatch> = {
  "chat.registerCommand": (ctx, [name], _s, rpc) =>
    void ctx.chat.registerCommand(String(name), async (args) => void (await rpc.call("command.invoke", [name, args]))),
  "chat.post": (ctx, [md]) => ctx.chat.post(String(md)),
  "agents.run": (ctx, [name, prompt, opts], signal) => ctx.agents.run(String(name), String(prompt), { ...(opts as object), signal }),
  "workspace.readFile": (ctx, [p]) => ctx.workspace.readFile(String(p)),
  "workspace.writeFile": (ctx, [p, content]) => ctx.workspace.writeFile(String(p), String(content)),
  "workspace.listFiles": (ctx) => ctx.workspace.listFiles(),
  "workspace.checkpoint": (ctx, [label]) => ctx.workspace.checkpoint(String(label)),
  "workspace.rollback": (ctx, [id]) => ctx.workspace.rollback(String(id)),
  "workspace.changedFiles": (ctx, [id]) => ctx.workspace.changedFiles(String(id)),
  "workspace.fingerprintTests": (ctx) => ctx.workspace.fingerprintTests(),
  "workspace.fingerprint": (ctx, [globs]) => ctx.workspace.fingerprint((globs as unknown[]).map(String)),
  "git.commit": (ctx, [message, opts]) => ctx.git.commit(String(message), opts as { paths?: string[] }),
  "git.head": (ctx) => ctx.git.head(),
  "git.branch": (ctx, [name]) => ctx.git.branch(String(name)),
  "stack.runTests": (ctx, [opts], signal) => ctx.stack.runTests({ ...(opts as object), signal }),
  "stack.mutation": (ctx, _args, signal) => ctx.stack.mutation({ signal }),
  "stack.architecture": (ctx, [rules]) => ctx.stack.architecture(rules as never),
  "tasks.start": (ctx, [name, input]) => ctx.tasks.start(String(name), input),
  "tasks.dispatch": (ctx, [id, event]) => ctx.tasks.dispatch(String(id), event as { type: string }),
  "tasks.cancel": (ctx, [id]) => ctx.tasks.cancel(String(id)),
  "interactions.request": (ctx, [req]) => ctx.interactions.request(req as never),
  "evidence.list": (ctx, [taskId]) => ctx.evidence.list(String(taskId)),
  "log.info": (ctx, [msg, fields]) => ctx.log.info(String(msg), fields as never),
  "log.warn": (ctx, [msg, fields]) => ctx.log.warn(String(msg), fields as never),
};

/**
 * Hôte d'extension isolé (D9, J4) : un processus par extension, lancé par `launcher`. Le `ctx` réel
 * (permissions, registre, moteur…) reste dans le principal ; l'enfant n'en reçoit qu'un mandataire.
 * Au-delà de `maxRestartsPerHour` plantages, l'extension est désactivée pour la session.
 */
export async function activateIsolated(ext: IsolatedExtension, deps: HostDeps, opts: IsolatedHostOptions): Promise<IsolatedHandle> {
  const now = opts.now ?? Date.now;
  const maxRestarts = opts.maxRestartsPerHour ?? 3;
  const crashes: number[] = [];
  let child: ChildHandle | null = null;
  let rpc: RpcEndpoint | null = null;
  let inner: ExtensionHandle | null = null;
  let stopping = false;
  let disabled = false;
  const log = deps.logger?.child({ extensionId: ext.manifest.id });

  function taskProxy(name: string, rpcRef: RpcEndpoint): AnyTask {
    const t = { timeoutMs: 5_000 };
    return {
      name,
      initialState: (input) => rpcRef.call("task.initialState", [name, input], t),
      initialEffects: (state) => rpcRef.call("task.initialEffects", [name, state], t) as Promise<unknown[]>,
      transition: (state, event) => rpcRef.call("task.transition", [name, state, event], t) as Promise<{ state: unknown; effects: unknown[] }>,
      isTerminal: (state) => rpcRef.call("task.isTerminal", [name, state], t) as Promise<boolean>,
      checkpointBefore: (effect) => rpcRef.call("task.checkpointBefore", [name, effect], t) as Promise<boolean>,
      phaseOf: (state) => rpcRef.call("task.phaseOf", [name, state], t) as Promise<string>,
      runEffect: (effect, _ctx, ec) =>
        rpcRef.call("task.runEffect", [name, effect, { taskId: ec.taskId, state: ec.state }], { signal: ec.signal }) as Promise<never>,
    };
  }

  async function start(): Promise<void> {
    const c = opts.launcher.launch({ entry: opts.runtimeEntry, readPaths: [ext.directory, dirname(opts.runtimeEntry)] });
    child = c;
    c.onExit((code) => void onExit(c, code));

    const bridge: ExtensionModule = {
      async activate(ctx) {
        const endpoint: RpcEndpoint = createRpcEndpoint(c.channel, {
          async ctx([name, args], { signal }) {
            const method = String(name);
            if (method === "tasks.register") {
              const taskName = String((args as [{ name: string }])[0].name);
              ctx.tasks.register(taskProxy(taskName, endpoint));
              return null;
            }
            if (method === "tools.register") {
              const t = (args as [{ name: string; description: string; parameters: Record<string, unknown> }])[0];
              ctx.tools.register({ ...t, handler: async (a) => String(await endpoint.call("tool.invoke", [t.name, a], { timeoutMs: 60_000 })) });
              return null;
            }
            if (method === "hooks.onPreToolUse") {
              const id = (args as [number])[0];
              ctx.hooks.onPreToolUse(async (call) => (await endpoint.call("hook.preToolUse", [id, call], { timeoutMs: opts.hookTimeoutMs ?? 2_000 })) as never);
              return null;
            }
            const dispatch = Object.hasOwn(CALLS, method) ? CALLS[method] : undefined;
            if (!dispatch) throw new Error(`Appel non autorisé depuis l'extension : ${method}`);
            return (await dispatch(ctx, args as unknown[], signal, endpoint)) ?? null;
          },
        });
        rpc = endpoint;
        const req: ActivationRequest = { extensionId: ext.manifest.id, entry: ext.entry, testFilePattern: deps.stack.testFilePattern, layout: deps.stack.layout };
        await endpoint.call("activate", [req], { timeoutMs: opts.activationTimeoutMs ?? 15_000 });
      },
      async deactivate() {
        await rpc?.call("deactivate", [], { timeoutMs: 2_000 }).catch(() => undefined);
      },
    };

    try {
      inner = await activateInProcess({ manifest: ext.manifest, module: bridge }, deps);
      log?.info("extension activée (processus isolé)", { pid: c.pid ?? -1 });
    } catch (err) {
      stopping = true;
      c.kill();
      rpc?.close("activation échouée");
      throw err;
    }
  }

  async function onExit(c: ChildHandle, code: number | null): Promise<void> {
    if (c !== child) return;
    rpc?.close(`L'extension ${ext.manifest.id} s'est arrêtée (code ${code ?? "signal"})`);
    deps.registry.removeExtension(ext.manifest.id);
    deps.hooks.removeExtension(ext.manifest.id);
    inner = null;
    if (stopping || disabled) return;

    const t = now();
    crashes.push(t);
    while (crashes.length && t - crashes[0]! > 3_600_000) crashes.shift();
    log?.warn("hôte d'extension arrêté", { code: code ?? -1, crashes: crashes.length });
    if (crashes.length > maxRestarts) {
      disabled = true;
      const reason = `L'extension ${ext.manifest.id} a planté ${crashes.length} fois en une heure : elle est désactivée jusqu'au prochain lancement.`;
      deps.chat.post(ext.manifest.id, reason);
      opts.onDisabled?.(reason);
      return;
    }
    try {
      await start();
    } catch (err) {
      log?.warn("redémarrage impossible", { error: String(err) });
    }
  }

  await start();

  return {
    get pid() {
      return child?.pid;
    },
    get active() {
      return inner !== null;
    },
    get disabled() {
      return disabled;
    },
    get ctx(): ExtensionContext {
      if (!inner) throw new Error(`L'extension ${ext.manifest.id} n'est pas active`);
      return inner.ctx;
    },
    async deactivate() {
      stopping = true;
      await inner?.deactivate();
      rpc?.close("extension désactivée");
      child?.kill();
    },
  };
}
