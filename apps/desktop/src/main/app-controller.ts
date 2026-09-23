import { basename } from "node:path";
import {
  createMainSession,
  createWorkspaceGuard,
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
import type { EventSink, ExternalOpener, FolderPicker, RuntimeFactory, SettingsStore, WorkspaceProvider } from "./protocols.js";

export interface AppControllerDeps {
  auth: GitHubAuth;
  workspaces: WorkspaceProvider;
  runtimeFactory: RuntimeFactory;
  conversations: ConversationStore;
  settings: SettingsStore;
  folderPicker: FolderPicker;
  external: ExternalOpener;
  sink: EventSink;
  clock: Clock;
  ids: IdGenerator;
  systemPrompt: string;
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
  let workspace: Workspace | null = null;
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

  async function activate(ws: Workspace): Promise<WorkspaceInfoDto> {
    await closeSession();
    workspace = ws;
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
        workspace = await deps.workspaces.open(last);
        return info(workspace);
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
        guard: createWorkspaceGuard({ root: ws.root, confirmer }),
        clock: deps.clock,
        ids: deps.ids,
        ...(deps.idleMs !== undefined ? { idleMs: deps.idleMs } : {}),
      });
      offSession = s.onEvent((e) => {
        if (e.type === "messages") deps.sink.emit("chat:messages", { messages: e.messages });
        else if (e.type === "busy") deps.sink.emit("chat:busy", { busy: e.busy });
        else if (e.event.type !== "activity") deps.sink.emit("chat:agent", { event: e.event });
      });
      session = s;
      return s.start();
    },

    "chat:send": ({ text }) => requireSession().send(text),

    "chat:undo": ({ messageId }) => requireSession().undo(messageId),

    "chat:abort": () => requireSession().abort(),

    "chat:turn-changes": async ({ messageId }) => {
      const msg = requireSession()
        .messages()
        .find((m) => m.id === messageId && m.role === "user");
      if (!msg?.checkpointId) throw new Error(`Tour introuvable : ${messageId}`);
      return requireWorkspace().checkpoints.diff(msg.checkpointId);
    },

    "confirm:respond": async ({ id, allowed }) => confirmer.respond(id, allowed),

    async dispose() {
      await closeSession();
      await runtime?.stop();
      runtime = null;
    },
  };
}
