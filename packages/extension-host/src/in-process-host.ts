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
import { matchesAny } from "@agent-studio/core";
import { PermissionDeniedError, permissionChecker } from "./permissions.js";
import { createTestRunService, readOnlyGuard, runTestsTool, testFreezeGuard } from "./test-runs.js";
import { runLintTool } from "./lint-tool.js";
import { extensionFileReader, loadAgentPrompts, loadSkillTool } from "./agent-prompts.js";

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
  /** Dossier de l'extension : fichiers de rôle et skills déclarés par le manifeste (ADR 0024). */
  directory?: string;
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
  /** Motifs `@stack:*` résolus par l'adaptateur de stack du projet (SPEC-skraft §10). */
  const resolveGlobs = (globs: string[]): string[] =>
    globs.flatMap((g) => {
      const m = /^@stack:(acceptanceTests|unitTests|sources)$/.exec(g);
      return m ? deps.stack.layout[m[1] as keyof typeof deps.stack.layout] : [g];
    });
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

  // Contenu (fichiers Markdown de l'extension) + contrat du cœur, composés une fois à l'activation.
  const prompts = await loadAgentPrompts(manifest, ext.directory ? extensionFileReader(ext.directory) : null);
  const promptOf = (name: string) => prompts.get(name)!;
  for (const a of declared.agents.values())
    deps.registry.addAgent({ extensionId: manifest.id, name: a.name, systemPrompt: promptOf(a.name).systemPrompt, writable: resolveGlobs(a.write ?? []), output: a.output });

  const taskName = (name: string) => `${manifest.id}/${name}`;
  const declaredTools = new Map((manifest.contributes.tools ?? []).map((t) => [t.name, t]));
  const extensionTools = new Map<string, import("@agent-studio/extension-api").ExtensionTool>();
  const testRuns = createTestRunService(deps);
  /** Outils de l'extension déclarés par l'agent : exécutés par le code de l'extension (§5.4). */
  const ownTools = (names: string[]): import("@agent-studio/core").ToolSpec[] =>
    names
      .map((n) => extensionTools.get(n))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters, handler: (args: unknown) => t.handler(args) }));
  for (const a of declared.agents.values())
    for (const t of ["run_tests", "run_lint"] as const)
      if (a.tools?.includes(t) && !perm.has("shell:test")) throw new Error(`L'agent ${a.name} utilise ${t} sans la permission shell:test`);

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
        const skillsLoaded: string[] = [];
        const composed = promptOf(name);
        const taskId = opts?.evidence?.taskId;
        const phase = taskId ? ((await deps.engine.phaseOf(taskId)) ?? opts?.evidence?.phase ?? "?") : null;
        const r = await deps.agents.run(
          { role: `${manifest.id}/${name}`, systemPrompt: composed.systemPrompt, writable: resolveGlobs(a.write ?? []), output: a.output, blocker: a.tools?.includes("report_blocker") ?? false },
          prompt,
          {
            ...(opts?.signal ? { signal: opts.signal } : {}),
            // Clé de continuité (ADR 0030) : deux exécutions du même rôle pour la même tâche sont
            // deux tentatives du même travail. Sans taskId, aucune reprise — c'est le cas des
            // agents lancés hors tâche.
            ...(taskId ? { resumeKey: `${taskId}/${manifest.id}/${name}` } : {}),
            // Trace d'exécution (ADR 0032) : tout ce que ce tour échange, et pourquoi il s'arrête.
            ...(taskId ? { trace: { taskId, ...(phase ? { phase } : {}) } } : {}),
            ...(deps.usage && taskId && phase ? { onUsage: (u: import("@agent-studio/core").UsageDelta) => void deps.usage!.add(taskId, phase, u).catch(() => undefined) } : {}),
            tools: (beat: () => void) => [
              ...ownTools(a.tools ?? []),
              ...(a.tools?.includes("run_tests")
                ? [
                    runTestsTool(testRuns, {
                      beat,
                      ...(opts?.signal ? { signal: opts.signal } : {}),
                      ...(opts?.evidence ? { tag: opts.evidence } : {}),
                      onRun: (run) => {
                        if (opts?.freezeTestsAfterRed && run.results.some((t) => t.status === "failed")) frozen = true;
                      },
                    }),
                  ]
                : []),
              // `run_lint` n'enregistre aucune preuve : la porte relance le linter elle-même, sinon
              // l'agent choisirait le moment de la mesure. Ici il ne fait que s'informer.
              ...(a.tools?.includes("run_lint")
                ? [
                    runLintTool(
                      {
                        lint: async (o) =>
                          deps.stack.lint
                            ? deps.stack.lint({
                                root: deps.workspace.root,
                                ...(o.files ? { files: o.files } : {}),
                                ...(opts?.signal ? { signal: opts.signal } : {}),
                              })
                            : null,
                      },
                      { beat },
                    ),
                  ]
                : []),
              // Skills facultatives : chaque chargement est rendu à l'extension, qui le trace dans l'état de sa tâche (D26).
              ...(composed.onDemand.size ? [loadSkillTool(composed.onDemand, (ref) => void skillsLoaded.push(ref))] : []),
            ],
            guards: [
              ...(opts?.freezeTestsAfterRed ? [testFreezeGuard(deps.workspace.root, (p) => deps.stack.isTestFile(p), () => frozen)] : []),
              ...(opts?.readOnly?.length ? [readOnlyGuard(deps.workspace.root, resolveGlobs(opts.readOnly))] : []),
              ...deps.hooks.guards(),
            ],
          },
        );
        const loaded = skillsLoaded.length ? { skillsLoaded: [...new Set(skillsLoaded)] } : {};
        return (r.blocker ? { blocker: structuredClone(r.blocker), ...loaded } : { output: structuredClone(r.output), ...loaded }) as never;
      },
    },

    workspace: {
      readFile: async (p) => (perm.require("fs:read"), deps.workspace.files.read(p)),
      async writeFile(p, content) {
        const rel = p.replaceAll("\\", "/");
        if (!matchesAny(resolveGlobs(perm.writeGlobs()), rel)) throw new PermissionDeniedError(manifest.id, `fs:write:${rel}`);
        await deps.workspace.files.write(rel, content);
      },
      listFiles: async () => (perm.require("fs:read"), deps.workspace.files.list()),
      checkpoint: async (label) => ({ id: (await deps.workspace.checkpoints.create(label)).id }),
      rollback: async (id) => (perm.require("git:revert"), deps.workspace.checkpoints.rollback(id)),
      changedFiles: async (id) => (perm.require("fs:read"), (await deps.workspace.checkpoints.diff(id)).files),
      async fingerprintTests() {
        perm.require("fs:read");
        return fingerprintFiles(deps.workspace.files, (p) => deps.stack.isTestFile(p));
      },
      async fingerprint(globs) {
        perm.require("fs:read");
        const resolved = resolveGlobs(globs);
        return fingerprintFiles(deps.workspace.files, (p) => matchesAny(resolved, p));
      },
    },

    git: {
      commit: async (message, opts) => (perm.require("git:commit"), deps.workspace.repo.commit(message, opts)),
      head: () => deps.workspace.repo.head(),
      branch: async (name) => (perm.require("git:branch"), deps.workspace.repo.switchBranch(name)),
    },

    stack: {
      runTests: async (opts) => {
        perm.require("shell:test");
        return testRuns.run({ source: "gate", ...(opts?.signal ? { signal: opts.signal } : {}), ...(opts?.evidence ? { tag: opts.evidence } : {}) });
      },
      isTestFile: (p) => deps.stack.isTestFile(p),
      layout: deps.stack.layout,
      infrastructureModules: deps.stack.infrastructureModules,
      async mutation(opts) {
        perm.require("shell:test");
        if (!deps.stack.mutation) return null;
        return deps.stack.mutation({ root: deps.workspace.root, ...(opts?.signal ? { signal: opts.signal } : {}) });
      },
      async architecture(rules) {
        perm.require("fs:read");
        if (!deps.stack.architecture) return null;
        return deps.stack.architecture({ root: deps.workspace.root, rules });
      },
      async lint(opts) {
        // Le linter est un programme du projet : même permission que l'exécution des tests.
        perm.require("shell:test");
        if (!deps.stack.lint) return null;
        return deps.stack.lint({
          root: deps.workspace.root,
          ...(opts?.files ? { files: opts.files } : {}),
          ...(opts?.signal ? { signal: opts.signal } : {}),
        });
      },
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

    tools: {
      register(tool) {
        if (!declaredTools.has(tool.name)) throw new Error(`Outil non déclaré dans le manifeste : ${tool.name}`);
        extensionTools.set(tool.name, tool);
        return { dispose: () => void extensionTools.delete(tool.name) };
      },
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
