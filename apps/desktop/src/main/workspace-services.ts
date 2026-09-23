import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  createHookRegistry,
  createInteractionService,
  createJsonEvidenceStore,
  createJsonInteractionStore,
  createProgressReporter,
  createUsageRecorder,
  sumUsage,
  type UsageRecorder,
  type UsageRow,
  createLazyRuntime,
  createRegistry,
  createTaskAgentRunner,
  routeIntent,
  type Clock,
  type EvidenceStore,
  type InteractionStore,
  type IdGenerator,
  type Logger,
} from "@agent-studio/core";
import type { ExtensionManifest } from "@agent-studio/extension-api";
import {
  activateInProcess,
  activateIsolated,
  type ExtensionHandle,
  type IsolatedExtension,
  type LoadedExtension,
  type ProcessLauncher,
} from "@agent-studio/extension-host";
import { selectStackAdapter, type StackAdapter } from "@agent-studio/stack-adapters";
import { createJsonTaskStore, createTaskEngine, type TaskRecord, type TaskStore } from "@agent-studio/task-engine";
import type { InteractionDto, TaskCardDto } from "../shared/ipc-contract.js";
import type { WorkspaceServicesFactory } from "./protocols.js";

/** Extension à activer : dans le principal (tests, J2) ou dans son propre processus (J4). */
export type ExtensionSource = ({ kind: "in-process" } & LoadedExtension) | ({ kind: "isolated" } & IsolatedExtension);

export interface WorkspaceServicesConfig {
  extensions: ExtensionSource[];
  /** Adaptateurs de stack, par ordre de préférence : le premier qui reconnaît le projet est retenu. */
  stacks: StackAdapter[];
  /** Obligatoire dès qu'une extension est isolée. */
  isolation?: { launcher: ProcessLauncher; runtimeEntry: string };
  /** Dossier des tâches ; un sous-dossier par projet. */
  tasksDir: string;
  clock: Clock;
  ids: IdGenerator;
  logger?: Logger;
  /** Pour les tests : stockages imposés. */
  taskStore?: TaskStore;
  evidenceStore?: EvidenceStore;
  interactionStore?: InteractionStore;
  usageRecorder?: UsageRecorder;
  /** Unité d'usage du runtime (`RuntimeCapabilities.usageUnit`). */
  usageUnit?: "requests" | "tokens";
  agentIdleMs?: number;
}

/** Construit la carte de tâche (§7.2) à partir de l'état persisté et des libellés du manifeste. */
export function toTaskCard(
  record: TaskRecord,
  manifests: ExtensionManifest[],
  usage?: { unit: "requests" | "tokens"; rows: UsageRow[] },
): TaskCardDto {
  const [extId, taskName] = record.name.split("/") as [string, string];
  const decl = manifests.find((m) => m.id === extId)?.contributes.tasks?.find((t) => t.name === taskName);
  const s = (record.state ?? {}) as {
    phase?: string;
    feature?: string;
    current?: number;
    steps?: { behavior: string }[];
    feedback?: string;
    retries?: Record<string, number>;
  };
  const phase = s.phase ?? "";
  const step = s.steps?.[s.current ?? 0];
  return {
    id: record.id,
    title: `${decl?.title ?? record.name}${s.feature ? ` : ${s.feature}` : ""}`,
    phase,
    phaseLabel: decl?.states[phase] ?? phase,
    status: record.status,
    alert: decl?.alerts?.includes(phase) ?? false,
    milestone: decl?.milestones?.includes(phase) ?? false,
    ...(step && s.steps ? { step: { index: (s.current ?? 0) + 1, total: s.steps.length, behavior: step.behavior } } : {}),
    ...(s.feedback ? { feedback: s.feedback } : {}),
    ...(usage ? { usage: usageDto(usage.unit, usage.rows, s.retries ?? {}, decl?.states ?? {}) } : {}),
    updatedAt: record.updatedAt,
  };
}

/** Usage par état : compteurs de l'enregistreur, réessais tenus par la tâche, libellés du manifeste. */
function usageDto(unit: "requests" | "tokens", rows: UsageRow[], retries: Record<string, number>, labels: Record<string, string>) {
  const phases = [...rows.map((r) => r.phase), ...Object.keys(retries).filter((p) => !rows.some((r) => r.phase === p))];
  const merged = phases.map((phase) => {
    const r = rows.find((x) => x.phase === phase);
    return {
      phase,
      label: labels[phase] ?? phase,
      requests: r?.requests ?? 0,
      inputTokens: r?.inputTokens ?? 0,
      outputTokens: r?.outputTokens ?? 0,
      retries: retries[phase] ?? 0,
      durationMs: r?.durationMs ?? 0,
    };
  });
  const t = sumUsage(merged.map((m) => ({ ...m, effects: 0 })));
  return { unit, rows: merged, total: { phase: "total", label: "Total", requests: t.requests, inputTokens: t.inputTokens, outputTokens: t.outputTokens, retries: t.retries, durationMs: t.durationMs } };
}

/** Fabrique des services d'un projet : assemble registre, moteur, interactions et extensions. */
export function workspaceServicesFactory(cfg: WorkspaceServicesConfig): WorkspaceServicesFactory {
  return async ({ workspace, runtime, onTask, onInteractions, onPost, notify }) => {
    const manifests = cfg.extensions.map((e) => e.manifest);
    const detected = await selectStackAdapter(workspace.root, cfg.stacks);
    const stack = detected ?? cfg.stacks[0];
    if (!stack) throw new Error("Aucun adaptateur de stack configuré");
    if (!detected) cfg.logger?.warn("aucun adaptateur ne reconnaît le projet", { root: workspace.root, fallback: stack.id });
    else cfg.logger?.info("adaptateur de stack retenu", { root: workspace.root, stack: stack.id });
    const projectKey = createHash("sha256").update(workspace.root).digest("hex").slice(0, 16);
    const usage = cfg.usageRecorder ?? createUsageRecorder(join(cfg.tasksDir, projectKey, "usage"));
    const usageRows = new Map<string, UsageRow[]>();
    const engine = createTaskEngine({
      usage,
      store: cfg.taskStore ?? createJsonTaskStore(join(cfg.tasksDir, projectKey)),
      checkpoints: workspace.checkpoints,
      clock: cfg.clock,
      ids: cfg.ids,
      ...(cfg.logger ? { logger: cfg.logger.child({ component: "tasks" }) } : {}),
    });
    const interactions = createInteractionService({
      // Demandes persistées : une escalade survit au redémarrage (J3, D31).
      store: cfg.interactionStore ?? createJsonInteractionStore(join(cfg.tasksDir, projectKey, "interactions")),
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
    const latestCards = new Map<string, TaskCardDto>();
    const reporter = createProgressReporter({
      onCard: (s) => {
        const card = latestCards.get(s.taskId);
        if (card) onTask(card);
      },
      onMilestone: (s, text) => {
        onPost(s.extensionId, text);
        notify?.("Jalon atteint", text);
      },
      onAlert: (s, text) => {
        onPost(s.extensionId, text);
        notify?.("Tâche à surveiller", text);
      },
    });
    const unit = cfg.usageUnit ?? "requests";
    const records = new Map<string, TaskRecord>();
    const publish = (record: TaskRecord) => {
      const rows = usageRows.get(record.id);
      const card = toTaskCard(record, manifests, rows ? { unit, rows } : undefined);
      latestCards.set(card.id, card);
      reporter.update({
        taskId: card.id,
        extensionId: record.name.split("/")[0] ?? "",
        title: card.title,
        phase: card.phase,
        phaseLabel: card.phaseLabel,
        milestone: card.milestone,
        alert: card.alert,
        ...(card.step ? { step: card.step } : {}),
        ...(card.feedback ? { detail: card.feedback } : {}),
      });
    };
    const offTasks = engine.onUpdate((record) => {
      records.set(record.id, record);
      publish(record);
      if (record.status === "finished") void interactions.cancelForTask(record.id);
    });
    // L'usage arrive aussi hors transition (fin d'un tour d'agent) : la carte suit.
    const offUsage = usage.onChange((taskId, rows) => {
      usageRows.set(taskId, rows);
      const record = records.get(taskId);
      if (record) publish(record);
    });
    for (const r of await engine.list()) usageRows.set(r.id, await usage.report(r.id));

    const evidence = cfg.evidenceStore ?? createJsonEvidenceStore(join(cfg.tasksDir, projectKey, "evidence"));
    const registry = createRegistry();
    const hooks = createHookRegistry();
    const handles: ExtensionHandle[] = [];
    for (const ext of cfg.extensions) {
      const hostDeps = {
        registry,
        engine,
        agents: createTaskAgentRunner({
          runtime: createLazyRuntime(runtime),
          root: workspace.root,
          ...(cfg.agentIdleMs !== undefined ? { idleMs: cfg.agentIdleMs } : {}),
          ...(cfg.logger ? { logger: cfg.logger.child({ component: "agents" }) } : {}),
        }),
        workspace,
        stack,
        interactions,
        evidence,
        hooks,
        usage,
        clock: cfg.clock,
        ids: cfg.ids,
        chat: { post: onPost },
        ...(cfg.logger ? { logger: cfg.logger } : {}),
      };
      try {
        if (ext.kind === "in-process") handles.push(await activateInProcess({ manifest: ext.manifest, module: ext.module }, hostDeps));
        else {
          if (!cfg.isolation) throw new Error("Aucun lanceur d'hôte d'extension configuré");
          handles.push(await activateIsolated({ manifest: ext.manifest, directory: ext.directory, entry: ext.entry }, hostDeps, cfg.isolation));
        }
      } catch (err) {
        cfg.logger?.error("activation d'extension impossible", { extensionId: ext.manifest.id, error: String(err) });
        onPost(ext.manifest.id, `L'extension ${ext.manifest.id} n'a pas pu être activée : ${err instanceof Error ? err.message : String(err)}`);
      }
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
      hookGuards: () => hooks.guards(),
      tasks: async () =>
        (await engine.list())
          .map((r) => toTaskCard(r, manifests, usageRows.has(r.id) ? { unit, rows: usageRows.get(r.id)! } : undefined))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      cancelTask: (taskId) => engine.cancel(taskId),
      pendingInteractions: async () => (await interactions.pending()).map(toDto),
      respond: (id, option, comment) => interactions.respond(id, option, comment),
      async dispose() {
        offTasks();
        offUsage();
        reporter.dispose();
        offInteractions();
        for (const h of handles) await h.deactivate();
      },
    };
  };
}
