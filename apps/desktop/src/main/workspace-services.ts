import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  createInteractionService,
  createLazyRuntime,
  createRegistry,
  createTaskAgentRunner,
  MemoryInteractionStore,
  routeIntent,
  type Clock,
  type IdGenerator,
  type Logger,
} from "@agent-studio/core";
import type { ExtensionManifest } from "@agent-studio/extension-api";
import { activateInProcess, type ExtensionHandle, type LoadedExtension } from "@agent-studio/extension-host";
import type { StackAdapter } from "@agent-studio/stack-adapters";
import { createJsonTaskStore, createTaskEngine, type TaskRecord, type TaskStore } from "@agent-studio/task-engine";
import type { InteractionDto, TaskCardDto } from "../shared/ipc-contract.js";
import type { WorkspaceServicesFactory } from "./protocols.js";

export interface WorkspaceServicesConfig {
  /** Extensions chargées en processus (J2 ; isolation en utilityProcess au J4). */
  extensions: LoadedExtension[];
  stack: StackAdapter;
  /** Dossier des tâches ; un sous-dossier par projet. */
  tasksDir: string;
  clock: Clock;
  ids: IdGenerator;
  logger?: Logger;
  /** Pour les tests : stockage des tâches imposé. */
  taskStore?: TaskStore;
  agentIdleMs?: number;
}

/** Construit la carte de tâche (§7.2) à partir de l'état persisté et des libellés du manifeste. */
export function toTaskCard(record: TaskRecord, manifests: ExtensionManifest[]): TaskCardDto {
  const [extId, taskName] = record.name.split("/") as [string, string];
  const decl = manifests.find((m) => m.id === extId)?.contributes.tasks?.find((t) => t.name === taskName);
  const s = (record.state ?? {}) as { phase?: string; feature?: string; current?: number; steps?: { behavior: string }[]; feedback?: string };
  const phase = s.phase ?? "";
  const step = s.steps?.[s.current ?? 0];
  return {
    id: record.id,
    title: `${decl?.title ?? record.name}${s.feature ? ` : ${s.feature}` : ""}`,
    phase,
    phaseLabel: decl?.states[phase] ?? phase,
    status: record.status,
    alert: decl?.alerts?.includes(phase) ?? false,
    ...(step && s.steps ? { step: { index: (s.current ?? 0) + 1, total: s.steps.length, behavior: step.behavior } } : {}),
    ...(s.feedback ? { feedback: s.feedback } : {}),
    updatedAt: record.updatedAt,
  };
}

/** Fabrique des services d'un projet : assemble registre, moteur, interactions et extensions. */
export function workspaceServicesFactory(cfg: WorkspaceServicesConfig): WorkspaceServicesFactory {
  return async ({ workspace, runtime, onTask, onInteractions, onPost }) => {
    const manifests = cfg.extensions.map((e) => e.manifest);
    const projectKey = createHash("sha256").update(workspace.root).digest("hex").slice(0, 16);
    const engine = createTaskEngine({
      store: cfg.taskStore ?? createJsonTaskStore(join(cfg.tasksDir, projectKey)),
      checkpoints: workspace.checkpoints,
      clock: cfg.clock,
      ids: cfg.ids,
      ...(cfg.logger ? { logger: cfg.logger.child({ component: "tasks" }) } : {}),
    });
    const interactions = createInteractionService({
      store: new MemoryInteractionStore(), // J3 : demandes persistées
      clock: cfg.clock,
      ids: cfg.ids,
      deliver: (taskId, option, comment) => engine.dispatch(taskId, { type: "HUMAN_DECISION", decision: option, ...(comment ? { comment } : {}) }),
    });
    const toDto = (r: Awaited<ReturnType<typeof interactions.pending>>[number]): InteractionDto => ({
      id: r.id,
      taskId: r.taskId,
      extensionId: r.extensionId,
      title: r.title,
      options: r.options,
      createdAt: r.createdAt,
      ...(r.detail ? { detail: r.detail } : {}),
    });
    const offInteractions = interactions.onChange((pending) => onInteractions(pending.map(toDto)));
    const offTasks = engine.onUpdate((record) => {
      onTask(toTaskCard(record, manifests));
      if (record.status === "finished") void interactions.cancelForTask(record.id);
    });

    const registry = createRegistry();
    const handles: ExtensionHandle[] = [];
    for (const ext of cfg.extensions) {
      handles.push(
        await activateInProcess(ext, {
          registry,
          engine,
          agents: createTaskAgentRunner({
            runtime: createLazyRuntime(runtime),
            root: workspace.root,
            ...(cfg.agentIdleMs !== undefined ? { idleMs: cfg.agentIdleMs } : {}),
            ...(cfg.logger ? { logger: cfg.logger.child({ component: "agents" }) } : {}),
          }),
          workspace,
          stack: cfg.stack,
          interactions,
          chat: { post: onPost },
          ...(cfg.logger ? { logger: cfg.logger } : {}),
        }),
      );
    }
    await engine.resumeAll();

    return {
      async route(text) {
        const intent = routeIntent(registry, text);
        if (intent.kind === "chat") return { kind: "chat" };
        if (intent.kind === "unknown-command") return intent;
        await intent.command.handler(intent.args);
        return { kind: "handled" };
      },
      commands: () => registry.commands(),
      tasks: async () => (await engine.list()).map((r) => toTaskCard(r, manifests)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      cancelTask: (taskId) => engine.cancel(taskId),
      pendingInteractions: async () => (await interactions.pending()).map(toDto),
      respond: (id, option, comment) => interactions.respond(id, option, comment),
      async dispose() {
        offTasks();
        offInteractions();
        for (const h of handles) await h.deactivate();
      },
    };
  };
}
