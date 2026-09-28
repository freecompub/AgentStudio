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
import { ROLE_LABELS, type Profile } from "@agent-studio/core";
import type { ExtensionInstaller } from "@agent-studio/extension-installer";
import type { GitHubAuth } from "@agent-studio/github-auth";
import type { Workspace } from "@agent-studio/workspace";
import type { ChatMessageDto, RequestChannel, RequestInput, RequestOutput, WorkspaceInfoDto } from "../shared/ipc-contract.js";
import { createIpcConfirmer } from "./ipc-confirmer.js";
import { createIpcConsent } from "./ipc-consent.js";
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
  /** Profil attribué par l'administrateur (D6) ; l'utilisateur ne peut pas le modifier. */
  profile?: { profile: Profile; developerMode: boolean; source: string };
  /** Installation d'extensions tierces depuis un fichier (J6). */
  installer?: ExtensionInstaller;
  /** Extensions internes livrées avec l'application (affichage). */
  builtInExtensions?: () => Promise<{ id: string; version: string; publisher: string; commands: string[] }[]>;
  /** Notifications système pour jalons et alertes (application en arrière-plan). */
  notifier?: SystemNotifier;
  logger?: Logger;
  idleMs?: number;
  /** Plafond de durée totale d'un tour (ADR 0026). */
  maxTurnMs?: number;
  /** Plafond du cumul des tokens d'entrée d'un tour (ADR 0027, désactivé par défaut depuis 0031). */
  maxInputTokens?: number;
  /** Fraction de la fenêtre de contexte au-delà de laquelle un tour est coupé (ADR 0031). */
  maxContextFraction?: number;
}

/** Un handler par canal de requête : le routeur IPC valide puis délègue. */
export type AppController = {
  [C in RequestChannel]: (input: RequestInput<C>) => Promise<RequestOutput<C>>;
} & {
  dispose(): Promise<void>;
  /** Accord d'installation à fournir à l'installateur (écran d'installation). */
  askConsent(req: import("@agent-studio/extension-installer").ConsentRequest): Promise<boolean>;
};

const DEVICE_PAGE = "https://github.com/login/device";

export function createAppController(deps: AppControllerDeps): AppController {
  const confirmer = createIpcConfirmer(deps.sink);
  const permissionRules = deps.permissionRules ?? createMemoryPermissionRules();
  const consent = createIpcConsent(deps.sink);
  const profileInfo = deps.profile ?? { profile: { role: "developpeur" as const, defaultMode: "advanced" as const, permissionPolicy: "souple" as const }, developerMode: false, source: "défaut" };
  let workspace: Workspace | null = null;
  let services: WorkspaceServices | null = null;
  let runtime: AgentRuntime | null = null;
  let session: MainSession | null = null;
  let offSession: (() => void) | null = null;
  /** Restauration du dernier projet, partagée entre appels concurrents. */
  let restauration: Promise<WorkspaceInfoDto | null> | null = null;
  /** Démarrage de la conversation en cours, partagé entre appels concurrents. */
  let demarrage: Promise<ChatMessageDto[]> | null = null;
  /** Démarrage du runtime en cours, partagé entre appels concurrents. */
  let demarrageRuntime: Promise<AgentRuntime> | null = null;
  /**
   * Messages postés alors qu'aucune conversation n'est ouverte. Les échecs constatés à
   * l'ouverture d'un projet — stack non reconnue, profil refusé — arrivent avant elle : les
   * journaliser ne les montrerait à personne. Ils sont versés à la conversation dès qu'elle
   * démarre, puis oubliés.
   */
  let enAttente: { extensionId: string; markdown: string }[] = [];

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

  /**
   * Attache un projet. Il n'est exposé qu'une fois ses services prêts : sinon un appel concurrent
   * le croirait ouvert et ses requêtes (commandes, tâches, interactions) échoueraient.
   */
  async function attach(ws: Workspace): Promise<void> {
    // Les services sont construits avant de toucher à l'existant : si la construction échoue
    // — adaptateur introuvable, extension illisible —, le projet en cours reste utilisable
    // plutôt que de laisser une conversation ouverte sur un contrôleur sans projet.
    const prets = await deps.workspaceServices({
      workspace: ws,
      runtime: ensureRuntime,
      onTask: (card) => deps.sink.emit("task:update", card),
      onInteractions: (pending) => deps.sink.emit("interactions:changed", { pending }),
      // Même canal que l'arbitre de permissions : écrire un profil de stack élargit ce que
      // l'application a le droit de lancer, et se confirme donc dans la fenêtre (§8.5).
      confirmer,
      ...(deps.notifier ? { notify: (title: string, body: string) => deps.notifier!.notify(title, body) } : {}),
      onPost: (extensionId, markdown) => {
        if (session) void session.record("notice", markdown, extensionId);
        else enAttente.push({ extensionId, markdown });
      },
    });
    const anciens = services;
    workspace = ws;
    services = prets;
    await anciens?.dispose();
  }

  async function activate(ws: Workspace): Promise<WorkspaceInfoDto> {
    await closeSession();
    await attach(ws);
    await deps.settings.save({ ...(await deps.settings.load()), lastWorkspace: ws.root });
    deps.logger?.info("projet ouvert", { root: ws.root });
    return info(ws);
  }

  /** Ferme la session et arrête le runtime : le prochain tour en ouvrira un avec le jeton courant. */
  async function oublierRuntime(): Promise<void> {
    if (!runtime) return;
    await closeSession();
    await runtime.stop();
    runtime = null;
  }

  /** Modèle retenu pour le projet courant (D38, ADR 0020) ; `null` = le runtime décide. */
  async function selectedModel(): Promise<string | null> {
    if (!workspace) return null;
    return (await deps.settings.load()).models?.[workspace.root] ?? null;
  }

  /** Clôture le projet courant : session, services et extensions libérés, aucun projet mémorisé. */
  async function close(): Promise<void> {
    if (!workspace) return;
    const { root } = workspace;
    await closeSession();
    await services?.dispose();
    services = null;
    workspace = null;
    enAttente = []; // ces messages parlaient du projet qu'on vient de fermer
    const { lastWorkspace: _oublie, ...reste } = await deps.settings.load();
    await deps.settings.save(reste);
    deps.logger?.info("projet clôturé", { root });
  }

  async function ensureRuntime(): Promise<AgentRuntime> {
    if (runtime) return runtime;
    // `chat:start` et `models:list` partent ensemble : sans partage, deux clients Copilot
    // démarreraient sur le même dossier, et le second écraserait le premier, qui fuirait.
    if (demarrageRuntime) return demarrageRuntime;
    const encours = demarrerRuntime();
    demarrageRuntime = encours;
    try {
      return await encours;
    } finally {
      demarrageRuntime = null;
    }
  }

  async function demarrerRuntime(): Promise<AgentRuntime> {
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

    "auth:login": async ({ hostname }) => {
      const status = await deps.auth.login(
        (code) => deps.sink.emit("auth:device-code", code),
        ...(hostname ? [{ hostname }] : []),
      );
      await oublierRuntime();
      // L'hôte choisi est retenu : au démarrage suivant, on interroge la bonne instance.
      await deps.settings.save({ ...(await deps.settings.load()), authHostname: deps.auth.hostname() });
      return status;
    },

    "auth:logout": async () => {
      // Se déconnecter en laissant une conversation ouverte sur un runtime authentifié n'aurait
      // pas de sens : on clôture le projet, donc la session et les extensions, avant de rendre
      // le jeton.
      await close();
      await oublierRuntime();
      await deps.auth.logout();
    },

    "shell:open-device-page": () => deps.external.open(DEVICE_PAGE),

    "workspace:current": async () => {
      // Le renderer peut appeler ce canal plusieurs fois en parallèle (React <StrictMode> monte
      // deux fois) : une seule restauration, partagée par tous les appels concurrents.
      if (restauration) return restauration;
      if (workspace) return info(workspace);
      const encours = (async (): Promise<WorkspaceInfoDto | null> => {
        const last = (await deps.settings.load()).lastWorkspace;
        if (!last) return null;
        try {
          await attach(await deps.workspaces.open(last));
          return info(workspace!);
        } catch (err) {
          deps.logger?.warn("dernier projet introuvable", { root: last, error: String(err) });
          return null;
        }
      })();
      restauration = encours;
      try {
        return await encours;
      } finally {
        restauration = null;
      }
    },

    "workspace:pick-folder": () => deps.folderPicker.pick(),

    "workspace:open": async ({ path }) => activate(await deps.workspaces.open(path)),

    "workspace:close": () => close(),

    "workspace:clone": async ({ url, dest }) => activate(await deps.workspaces.clone(url, dest)),

    "workspace:sync": () => requireWorkspace().repo.sync(),

    "models:list": async () => {
      const selected = await selectedModel();
      try {
        const rt = await ensureRuntime();
        return { models: (await rt.listModels?.()) ?? [], selected };
      } catch (err) {
        // Pas encore connecté, ou runtime indisponible : on ne propose rien plutôt que d'échouer.
        deps.logger?.info("modèles indisponibles", { error: String(err) });
        return { models: [], selected };
      }
    },

    "model:set": async ({ id }) => {
      const ws = requireWorkspace();
      const reglages = await deps.settings.load();
      const models = { ...(reglages.models ?? {}) };
      if (id === null) delete models[ws.root];
      else models[ws.root] = id;
      await deps.settings.save({ ...reglages, models });
      deps.logger?.info("modèle choisi", { root: ws.root, model: id });
    },

    "chat:start": async () => {
      const ws = requireWorkspace();
      if (session) return session.messages();
      // Le renderer appelle ce canal deux fois en parallèle (React <StrictMode>) : sans partage,
      // la session serait ouverte — ou reprise — deux fois, et le premier écouteur fuirait.
      if (demarrage) return demarrage;
      const encours = (async (): Promise<ChatMessageDto[]> => {
      const rt = await ensureRuntime();
      const modele = await selectedModel();
      const s = createMainSession({
        runtime: rt,
        store: deps.conversations,
        checkpoints: ws.checkpoints,
        workspaceRoot: ws.root,
        systemPrompt: deps.systemPrompt,
        ...(modele ? { model: modele } : {}),
        // Arbitre unique : politique du cœur → hooks des extensions → règles → question (D27).
        guard: createPermissionArbiter({
          root: ws.root,
          confirmer,
          rules: permissionRules,
          extensionGuards: () => services?.hookGuards() ?? [],
          profilePolicy: profileInfo.profile.permissionPolicy,
        }),
        clock: deps.clock,
        ids: deps.ids,
        ...(deps.idleMs !== undefined ? { idleMs: deps.idleMs } : {}),
        ...(deps.maxTurnMs !== undefined ? { maxMs: deps.maxTurnMs } : {}),
        ...(deps.maxInputTokens !== undefined ? { maxInputTokens: deps.maxInputTokens } : {}),
        ...(deps.maxContextFraction !== undefined ? { maxContextFraction: deps.maxContextFraction } : {}),
      });
      offSession = s.onEvent((e) => {
        if (e.type === "messages") deps.sink.emit("chat:messages", { messages: e.messages });
        else if (e.type === "busy") deps.sink.emit("chat:busy", { busy: e.busy });
        // `activity`, `usage` et `context` sont des signaux de mesure, pas des messages : ils ne
        // franchissent pas l'IPC (le contrat de `chat:agent` ne les décrit pas). L'occupation du
        // contexte mériterait d'être affichée — c'est un chantier d'interface à part.
        else if (e.event.type !== "activity" && e.event.type !== "usage" && e.event.type !== "context")
          deps.sink.emit("chat:agent", { event: e.event });
      });
        session = s;
        const messages = await s.start();
        if (enAttente.length === 0) return messages;
        // Versés maintenant, et une seule fois : ils appartiennent à cette conversation.
        const differes = enAttente;
        enAttente = [];
        for (const m of differes) await s.record("notice", m.markdown, m.extensionId);
        return s.messages();
      })();
      demarrage = encours;
      try {
        return await encours;
      } finally {
        demarrage = null;
      }
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

    "interaction:respond": ({ id, option, comment }) => requireServices().respond(id, option, comment, { role: profileInfo.profile.role }),

    "profile:get": async () => ({
      role: profileInfo.profile.role,
      roleLabel: ROLE_LABELS[profileInfo.profile.role],
      defaultMode: profileInfo.profile.defaultMode,
      permissionPolicy: profileInfo.profile.permissionPolicy,
      developerMode: profileInfo.developerMode,
      adminSource: profileInfo.source,
    }),

    "ui:get-mode": async () => (await deps.settings.load()).uiMode ?? profileInfo.profile.defaultMode,

    "ui:set-mode": async ({ mode }) => deps.settings.save({ ...(await deps.settings.load()), uiMode: mode }),

    "extensions:list": async () => {
      const builtIn = (await deps.builtInExtensions?.()) ?? [];
      const installed = (await deps.installer?.list()) ?? [];
      const active = new Map(((await deps.installer?.active()) ?? []).map((a) => [a.manifest.id, a.manifest]));
      return [
        ...builtIn.map((b) => ({ ...b, builtIn: true, signed: true, status: "active" as const })),
        ...installed.map((e) => ({
          id: e.id,
          version: e.version,
          publisher: e.publisher,
          builtIn: false,
          signed: e.signed,
          status: e.disabled ? ("disabled" as const) : ("active" as const),
          ...(e.disabled ? { reason: e.disabled } : {}),
          commands: (active.get(e.id)?.contributes.commands ?? []).map((c) => c.title),
        })),
      ];
    },

    "extensions:install": async () => {
      if (!deps.installer) return { status: "rejected" as const, reason: "Installation d'extensions indisponible." };
      const file = await deps.folderPicker.pickPackage?.();
      if (!file) return { status: "cancelled" as const };
      const r = await deps.installer.installFromFile(file);
      if (r.status === "installed") {
        deps.logger?.info("extension installée", { extensionId: r.id, version: r.version });
        if (workspace) await attach(workspace); // nouvelles commandes disponibles tout de suite
        deps.sink.emit("extensions:changed", {});
      }
      return r;
    },

    "extensions:uninstall": async ({ id }) => {
      await deps.installer?.uninstall(id);
      if (workspace) await attach(workspace);
      deps.sink.emit("extensions:changed", {});
    },

    "extension-consent:respond": async ({ id, accept }) => consent.respond(id, accept),

    askConsent: (req) => consent.ask(req),

    async dispose() {
      await services?.dispose();
      services = null;
      await closeSession();
      await runtime?.stop();
      runtime = null;
    },
  };
}
