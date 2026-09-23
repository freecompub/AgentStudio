import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Notification, session, shell } from "electron";
import { createJsonConversationStore, createJsonLogger, createJsonPermissionRules } from "@agent-studio/core";
import { API_VERSION } from "@agent-studio/extension-api";
import { createGhAuth, createNodeCommandRunner, createNodeProcessSpawner } from "@agent-studio/github-auth";
import { createCopilotClient, createCopilotRuntime } from "@agent-studio/runtime-copilot";
import { createSwiftAdapter, createTypeScriptAdapter, findLocalSwiftToolchain } from "@agent-studio/stack-adapters";
import { cliGitRunnerFactory, cloneWorkspace, openWorkspace } from "@agent-studio/workspace";
import { events, REQUEST_CHANNELS, type EventChannel, type EventPayload } from "../shared/ipc-contract.js";
import { createAppController, type AppController } from "./app-controller.js";
import { createIpcRouter } from "./ipc-router.js";
import { loadExtensions } from "./extension-loader.js";
import { createJsonSettingsStore } from "./settings-store.js";
import { createUtilityProcessLauncher } from "./utility-launcher.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { workspaceServicesFactory } from "./workspace-services.js";

const DEV_URL = process.env["ELECTRON_RENDERER_URL"];
const RENDERER_FILE = join(import.meta.dirname, "../renderer/index.html");
const PRELOAD = join(import.meta.dirname, "../preload/index.cjs");

if (!app.requestSingleInstanceLock()) app.quit();
app.enableSandbox();

const userData = app.getPath("userData");
mkdirSync(join(userData, "logs"), { recursive: true });
const logFile = join(userData, "logs", "main.log");
const logger = createJsonLogger({
  write: (line) => {
    appendFileSync(logFile, `${line}\n`);
    if (DEV_URL) process.stderr.write(`${line}\n`);
  },
  level: DEV_URL ? "debug" : "info",
});

let window: BrowserWindow | null = null;
let controller: AppController | null = null;

/** Seule la fenêtre de l'application (fichier empaqueté ou serveur de dev) parle au principal. */
function isTrustedSender(url: string): boolean {
  if (DEV_URL) return url.startsWith(DEV_URL);
  return url === pathToFileURL(RENDERER_FILE).href;
}

function emit<C extends EventChannel>(channel: C, payload: EventPayload<C>): void {
  const checked = events[channel].safeParse(payload);
  if (!checked.success) {
    logger.error("événement hors contrat", { channel });
    return;
  }
  window?.webContents.send(channel, checked.data);
}

function hardenSession(): void {
  const csp = DEV_URL
    ? // Vite en développement : script de rechargement à chaud en ligne et WebSocket.
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws:; img-src 'self' data:"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] } });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    title: "agent-studio",
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  // Aucune navigation hors de l'application ; liens https ouverts dans le navigateur système.
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(RENDERER_FILE);
  return win;
}

/** Extensions internes construites par `scripts/build-extensions.mjs`, et runtime de leurs hôtes. */
const EXTENSIONS_DIR = join(import.meta.dirname, "../extensions");
const EXTENSION_RUNTIME = join(import.meta.dirname, "../extension-host/extension-child.mjs");

async function createController(): Promise<AppController> {
  const { loaded, rejected } = await loadExtensions(EXTENSIONS_DIR, { appApi: API_VERSION });
  for (const r of rejected) logger.error("extension écartée : manifeste invalide", { directory: r.directory, errors: r.errors.join(" ; ") });
  const git = cliGitRunnerFactory({ config: { "credential.https://github.com.helper": "!gh auth git-credential" } });
  return createAppController({
    auth: createGhAuth({ runner: createNodeCommandRunner(), spawner: createNodeProcessSpawner() }),
    workspaces: {
      open: (path) => openWorkspace(path, { git }),
      clone: (url, dest) => cloneWorkspace(url, dest, { git }),
    },
    workspaceServices: workspaceServicesFactory({
      // Une extension = un utilityProcess sous modèle de permissions (D9, J4).
      extensions: loaded.map((e) => ({ kind: "isolated" as const, ...e })),
      isolation: {
        launcher: createUtilityProcessLauncher({ onStderr: (c) => logger.warn("sortie d'erreur d'une extension", { output: c.slice(0, 2_000) }) }),
        runtimeEntry: EXTENSION_RUNTIME,
      },
      // Swift (SwiftPM) puis TypeScript (Vitest) ; chaîne Swift du système ou installée hors système.
      stacks: [createSwiftAdapter({ toolchain: findLocalSwiftToolchain() ?? {} }), createTypeScriptAdapter()],
      tasksDir: join(userData, "tasks"),
      clock: { now: () => new Date() },
      ids: { next: () => randomUUID() },
      logger,
    }),
    runtimeFactory: (token) =>
      createCopilotRuntime({
        client: createCopilotClient({ gitHubToken: token, baseDirectory: join(userData, "copilot") }),
        logger: logger.child({ component: "runtime" }),
      }),
    conversations: createJsonConversationStore(join(userData, "conversations")),
    settings: createJsonSettingsStore(join(userData, "settings.json")),
    folderPicker: {
      async pick() {
        const r = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
        return r.canceled ? null : (r.filePaths[0] ?? null);
      },
    },
    external: { open: (url) => shell.openExternal(url) },
    notifier: {
      // Jalons et alertes seulement si l'application est en arrière-plan (§7.2).
      notify(title, body) {
        if (window?.isFocused() || !Notification.isSupported()) return;
        new Notification({ title, body }).show();
      },
    },
    sink: { emit },
    clock: { now: () => new Date() },
    ids: { next: () => randomUUID() },
    systemPrompt: SYSTEM_PROMPT,
    permissionRules: createJsonPermissionRules(join(userData, "permission-rules.json")),
    logger: logger.child({ component: "controller" }),
  });
}

app.whenReady().then(async () => {
  hardenSession();
  controller = await createController();
  const router = createIpcRouter(controller, { isTrustedSender, logger: logger.child({ component: "ipc" }) });
  for (const channel of REQUEST_CHANNELS) {
    ipcMain.handle(channel, (event, input: unknown) => router.handle(channel, input, event.senderFrame?.url ?? ""));
  }
  window = createWindow();
  logger.info("application démarrée", { version: app.getVersion() });

  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
});

app.on("window-all-closed", () => app.quit());

let disposed = false;
app.on("before-quit", (e) => {
  if (disposed || !controller) return;
  e.preventDefault();
  disposed = true;
  void controller.dispose().finally(() => app.quit());
});
