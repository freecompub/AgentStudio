import { basename } from "node:path";
import {
  createMainSession,
  createMemoryPermissionRules,
  createPermissionArbiter,
  type PermissionRules,
  type AgentRuntime,
  type Clock,
  type ConversationStore,
  type IdGenerator,
  type Logger,
  type MainSession,
} from "@agent-studio/core";
import type { GitHubAuth } from "@agent-studio/github-auth";
import type { Workspace } from "@agent-studio/workspace";
import type { RequestChannel, RequestInput, RequestOutput, WorkspaceInfoDto } from "../shared/ipc-contract.js";
import { createIpcConfirmer } from "./ipc-confirmer.js";
import type {
  EventSink,
  ExternalOpener,
  FolderPicker,
  RuntimeFactory,
  SettingsStore,
  SystemNotifier,
  WorkspaceProvider,
  WorkspaceServices,
  WorkspaceServicesFactory,
} from "./protocols.js";

export interface AppControllerDeps {
  auth: GitHubAuth;
  workspaces: WorkspaceProvider;
  /** Registre, extensions, tâches et interactions du projet ouvert (J2). */
  workspaceServices: WorkspaceServicesFactory;
  runtimeFactory: RuntimeFactory;
  conversations: ConversationStore;
  settings: SettingsStore;
  folderPicker: FolderPicker;
  external: ExternalOpener;
  sink: EventSink;
  clock: Clock;
  ids: IdGenerator;
  systemPrompt: string;
  /** Règles « toujours autoriser » de l'utilisateur (arbitre, D27). */
  permissionRules?: PermissionRules;
  /** Notifications système pour jalons et alertes (application en arrière-plan). */
  notifier?: SystemNotifier;
  logger?: Logger;
  idleMs?: number;
}

/** Un handler par canal de requête : le routeur IPC valide puis délègue. */
export type AppController = {
  [C in RequestChannel]: (input: RequestInput<C>) => Promise<RequestOutput<C>>;
} & { dispose(): Promise<void> };

const DEVICE_PAGE = "https://github.com/login/device";

export function createAppController(deps: AppControllerDeps): AppController {
  const confirmer = createIpcConfirmer(deps.sink);
  const permissionRules = deps.permissionRules ?? createMemoryPermissionRules();
  let workspace: Workspace | null = null;
  let services: WorkspaceServices | null = null;
  let runtime: AgentRuntime | null = null;
  let session: MainSession | null = null;
  let offSession: (() => void) | null = null;

  const info = (ws: Workspace): WorkspaceInfoDto => ({ root: ws.root, name: basename(ws.root) });

  function requireWorkspace(): Workspace {
    if (!workspace) throw new Error("Aucun projet ouvert.");
    return workspace;
  }

  function requireSession(): MainSession {
    if (!session) throw new Error("La conversation n'est pas démarrée.");
    return session;
  }

  async function closeSession(): Promise<void> {
    offSession?.();
    offSession = null;
    await session?.close();
    session = null;
  }

  function requireServices(): WorkspaceServices {
    if (!services) throw new Error("Aucun projet ouvert.");
    return services;
  }

  async function attach(ws: Workspace): Promise<void> {
    await services?.dispose();
    workspace = ws;
    services = await deps.workspaceServices({
      workspace: ws,
      runtime: ensureRuntime,
      onTask: (card) => deps.sink.emit("task:update", card),
      onInteractions: (pending) => deps.sink.emit("interactions:changed", { pending }),
      ...(deps.notifier ? { notify: (title: string, body: string) => deps.notifier!.notify(title, body) } : {}),
      onPost: (extensionId, markdown) => {
        if (session) void session.record("notice", markdown, extensionId);
        else deps.logger?.info("message d'extension hors conversation", { extensionId });
      },
    });
  }

  async function activate(ws: Workspace): Promise<WorkspaceInfoDto> {
    await closeSession();
    await attach(ws);
    await deps.settings.save({ ...(await deps.settings.load()), lastWorkspace: ws.root });
    deps.logger?.info("projet ouvert", { root: ws.root });
    return info(ws);
  }

  async function ensureRuntime(): Promise<AgentRuntime> {
    if (runtime) return runtime;
    const status = await deps.auth.status();
    if (!status.loggedIn) throw new Error("Connectez-vous à GitHub pour discuter avec l'agent.");
    if (!status.copilotCompatible)
      throw new Error(
        "Votre connexion GitHub utilise un jeton personnel classique, refusé par Copilot. Reconnectez-vous via le navigateur (bouton « Se connecter »).",
      );
    const rt = deps.runtimeFactory(await deps.auth.token());
    await rt.start();
    runtime = rt;
    return rt;
  }

  return {
    "auth:status": () => deps.auth.status(),

    "auth:login": async () => {
      const status = await deps.auth.login((code) => deps.sink.emit("auth:device-code", code));
      if (runtime) {
        await closeSession();
        await runtime.stop();
        runtime = null; // nouveau jeton au prochain démarrage
      }
      return status;
    },

    "shell:open-device-page": () => deps.external.open(DEVICE_PAGE),

    "workspace:current": async () => {
      if (workspace) return info(workspace);
      const last = (await deps.settings.load()).lastWorkspace;
      if (!last) return null;
      try {
        await attach(await deps.workspaces.open(last));
        return info(workspace!);
      } catch (err) {
        deps.logger?.warn("dernier projet introuvable", { root: last, error: String(err) });
        return null;
      }
    },

    "workspace:pick-folder": () => deps.folderPicker.pick(),

    "workspace:open": async ({ path }) => activate(await deps.workspaces.open(path)),

    "workspace:clone": async ({ url, dest }) => activate(await deps.workspaces.clone(url, dest)),

    "workspace:sync": () => requireWorkspace().repo.sync(),

    "chat:start": async () => {
      const ws = requireWorkspace();
      if (session) return session.messages();
      const rt = await ensureRuntime();
      const s = createMainSession({
        runtime: rt,
        store: deps.conversations,
        checkpoints: ws.checkpoints,
        workspaceRoot: ws.root,
        systemPrompt: deps.systemPrompt,
        // Arbitre unique : politique du cœur → hooks des extensions → règles → question (D27).
        guard: createPermissionArbiter({ root: ws.root, confirmer, rules: permissionRules, extensionGuards: () => services?.hookGuards() ?? [] }),
        clock: deps.clock,
        ids: deps.ids,
        ...(deps.idleMs !== undefined ? { idleMs: deps.idleMs } : {}),
      });
      offSession = s.onEvent((e) => {
        if (e.type === "messages") deps.sink.emit("chat:messages", { messages: e.messages });
        else if (e.type === "busy") deps.sink.emit("chat:busy", { busy: e.busy });
        else if (e.event.type !== "activity" && e.event.type !== "usage") deps.sink.emit("chat:agent", { event: e.event });
      });
      session = s;
      return s.start();
    },

    "chat:send": async ({ text }) => {
      const s = requireSession();
      // Une commande est consignée avant d'être exécutée, pour que ses messages la suivent.
      if (!/^\s*\/[a-z0-9]/.test(text)) return s.send(text);
      await s.record("user", text.trim());
      const outcome = await requireServices().route(text);
      if (outcome.kind === "unknown-command") {
        const known = requireServices().commands().map((c) => `/${c.invocation}`).join(", ") || "aucune";
        await s.record("notice", `Commande inconnue : /${outcome.name}. Commandes disponibles : ${known}.`);
      }
    },

    "chat:undo": ({ messageId }) => requireSession().undo(messageId),

    "chat:abort": () => requireSession().abort(),

    "chat:turn-changes": async ({ messageId }) => {
      const msg = requireSession()
        .messages()
        .find((m) => m.id === messageId && m.role === "user");
      if (!msg?.checkpointId) throw new Error(`Tour introuvable : ${messageId}`);
      return requireWorkspace().checkpoints.diff(msg.checkpointId);
    },

    "confirm:respond": async ({ id, answer }) => confirmer.respond(id, answer),

    "commands:list": async () =>
      requireServices()
        .commands()
        .map(({ invocation, title, description }) => ({ invocation, title, description })),

    "tasks:list": () => requireServices().tasks(),

    "task:cancel": ({ taskId }) => requireServices().cancelTask(taskId),

    "interactions:list": () => requireServices().pendingInteractions(),

    "interaction:respond": ({ id, option, comment }) => requireServices().respond(id, option, comment),

    async dispose() {
      await services?.dispose();
      services = null;
      await closeSession();
      await runtime?.stop();
      runtime = null;
    },
  };
}
