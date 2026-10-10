import type { GitHubAuth, AuthStatus, CopilotQuota } from "@agent-studio/github-auth";
import type { Workspace } from "@agent-studio/workspace";
import { MemoryConversationStore, reply, ScriptedRuntime, sequentialIds, fixedClock } from "@agent-studio/core/testing";
import { describe, expect, it } from "vitest";
import { createAppController } from "../src/main/app-controller.js";
import type { AppSettings, EventSink, WorkspaceProvider, WorkspaceServices, WorkspaceServicesArgs } from "../src/main/protocols.js";
import type { EventChannel } from "../src/shared/ipc-contract.js";
import { requests } from "../src/shared/ipc-contract.js";

const OAUTH: AuthStatus = { loggedIn: true, user: "octo", tokenKind: "oauth", copilotCompatible: true, hostname: "github.com" };

function fakeWorkspace(root: string): Workspace & { rolledBack: string[]; diffs: string[] } {
  const rolledBack: string[] = [];
  const diffs: string[] = [];
  let n = 0;
  return {
    root,
    rolledBack,
    diffs,
    files: { read: async () => "", write: async () => {}, ensureDir: async () => {}, list: async () => [] },
    checkpoints: {
      create: async (label) => ({ id: `cp-${++n}`, sha: "s", head: "h", label, createdAt: "" }),
      list: async () => [],
      diff: async (id) => {
        diffs.push(id);
        return { files: [{ path: "a.txt", status: "added" }], patch: "+a" };
      },
      rollback: async (id) => {
        rolledBack.push(id);
      },
    },
    repo: {
      // Ce double ne sait pas ouvrir de copie isolée : échouer vaut mieux que rendre une racine vide.
      worktree: async () => { throw new Error("copie isolée non fournie par ce double"); },
      head: async () => "h", commit: async () => null, sync: async () => ({ pulled: 1, pushed: 0 }), switchBranch: async () => {} },
  };
}

function setup(opts: { status?: AuthStatus; settings?: AppSettings; quota?: CopilotQuota | null; extra?: Partial<Parameters<typeof createAppController>[0]> } = {}) {
  const runtime = new ScriptedRuntime();
  const tokens: string[] = [];
  const emitted: { channel: EventChannel; payload: unknown }[] = [];
  const sink: EventSink = { emit: (channel, payload) => emitted.push({ channel, payload }) };
  const workspaces = new Map<string, ReturnType<typeof fakeWorkspace>>();
  const provider: WorkspaceProvider = {
    open: async (path) => {
      if (path.includes("absent")) throw new Error(`${path} n'est pas un dépôt Git`);
      const ws = workspaces.get(path) ?? fakeWorkspace(path);
      workspaces.set(path, ws);
      return ws;
    },
    clone: async (_url, dest) => {
      const ws = fakeWorkspace(dest);
      workspaces.set(dest, ws);
      return ws;
    },
  };
  let settings: AppSettings = opts.settings ?? {};
  // Comme `index.ts` : l'hôte retenu est lu dans les réglages avant de construire l'auth.
  let hote = opts.settings?.authHostname ?? "github.com";
  let deconnecte = false;
  const auth: GitHubAuth = {
    status: async () => (deconnecte ? { loggedIn: false, hostname: hote } : (opts.status ?? { ...OAUTH, hostname: hote })),
    token: async () => "gho_secret",
    copilotQuota: async () => opts.quota ?? null,
    hostname: () => hote,
    logout: async () => void (deconnecte = true),
    login: async (onCode, o) => {
      if (o?.hostname) hote = o.hostname;
      deconnecte = false;
      onCode({ code: "AB12-CD34", verificationUrl: `https://${hote}/login/device` });
      return { ...OAUTH, hostname: hote };
    },
  };
  const opened: string[] = [];
  const conversations = new MemoryConversationStore();
  const serviceLog: string[] = [];
  const hookGuards: import("@agent-studio/core").ToolCallGuard[] = [];
  let servicesArgs: WorkspaceServicesArgs | undefined;
  const controller = createAppController({
    auth,
    workspaces: provider,
    workspaceServices: async (args) => {
      servicesArgs = args;
      serviceLog.push(`créés:${args.workspace.root}`);
      const services: WorkspaceServices = {
        route: async (text) => {
          serviceLog.push(`route:${text}`);
          if (text.startsWith("/tdd")) {
            args.onPost("diabeo.tdd", "Cycle TDD lancé");
            return { kind: "handled" };
          }
          if (text.startsWith("/")) return { kind: "unknown-command", name: text.slice(1).split(" ")[0]! };
          return { kind: "chat" };
        },
        commands: () => [{ invocation: "tdd", title: "TDD", description: "d", extensionId: "diabeo.tdd" }],
        hookGuards: () => hookGuards,
        outilsAgent: () => [],
        tasks: async () => [],
        cancelTask: async (id) => void serviceLog.push(`annule:${id}`),
        pendingInteractions: async () => [],
        respond: async (id, option, _c, by) => void serviceLog.push(`réponse:${id}:${option}${by ? `:${by.role}` : ""}`),
        dispose: async () => void serviceLog.push(`libérés:${args.workspace.root}`),
      };
      return services;
    },
    runtimeFactory: (token) => {
      tokens.push(token);
      return runtime;
    },
    conversations,
    settings: { load: async () => settings, save: async (s) => void (settings = s) },
    folderPicker: { pick: async () => "/choisi" },
    external: { open: async (url) => void opened.push(url) },
    sink,
    clock: fixedClock(),
    ids: sequentialIds(),
    systemPrompt: "Rôle.",
    ...opts.extra,
  });
  return { controller, runtime, tokens, emitted, workspaces, opened, conversations, serviceLog, hookGuards, getServicesArgs: () => servicesArgs, getSettings: () => settings };
}

describe("AppController — authentification", () => {
  it("relaie le code d'appareil pendant la connexion", async () => {
    const { controller, emitted } = setup();
    expect(await controller["auth:login"]({})).toEqual(OAUTH);
    expect(emitted).toContainEqual({ channel: "auth:device-code", payload: { code: "AB12-CD34", verificationUrl: "https://github.com/login/device" } });
  });

  it("n'ouvre que la page de vérification GitHub", async () => {
    const { controller, opened } = setup();
    await controller["shell:open-device-page"]({});
    expect(opened).toEqual(["https://github.com/login/device"]);
  });
});

describe("AppController — connexion et déconnexion", () => {
  it("se connecter à une instance GitHub Enterprise retient l'hôte", async () => {
    const { controller, getSettings } = setup();
    expect(await controller["auth:login"]({ hostname: "github.exemple.fr" })).toMatchObject({ hostname: "github.exemple.fr" });
    expect(getSettings().authHostname).toBe("github.exemple.fr");
  });

  it("l'hôte retenu est réutilisé au démarrage suivant", async () => {
    const premier = setup();
    await premier.controller["auth:login"]({ hostname: "github.exemple.fr" });
    const suivant = setup({ settings: premier.getSettings() });
    expect((await suivant.controller["auth:status"]({})).hostname).toBe("github.exemple.fr");
  });

  it("la déconnexion clôture le projet ouvert et arrête le runtime", async () => {
    const { controller, runtime, serviceLog } = setup();
    await controller["workspace:open"]({ path: "/projets/demo" });
    await controller["chat:start"]({});
    const session = runtime.last;

    await controller["auth:logout"]({});

    expect(session.closed).toBe(true);
    expect(serviceLog).toContain("libérés:/projets/demo");
    expect(runtime.started).toBe(false);
    expect(await controller["auth:status"]({})).toMatchObject({ loggedIn: false });
    expect(await controller["workspace:current"]({})).toBeNull();
  });

  it("déconnexion sans projet ouvert : rien ne casse", async () => {
    const { controller } = setup();
    await controller["auth:logout"]({});
    expect(await controller["auth:status"]({})).toMatchObject({ loggedIn: false });
  });
});

describe("AppController — espaces de travail", () => {
  it("ouvre un dépôt, le mémorise et le restaure au démarrage suivant", async () => {
    const first = setup();
    expect(await first.controller["workspace:open"]({ path: "/projets/demo" })).toEqual({ root: "/projets/demo", name: "demo" });
    expect(first.getSettings().lastWorkspace).toBe("/projets/demo");

    const next = setup({ settings: first.getSettings() });
    expect(await next.controller["workspace:current"]({})).toEqual({ root: "/projets/demo", name: "demo" });
  });

  it("pas d'espace courant si le dernier a disparu", async () => {
    const { controller } = setup({ settings: { lastWorkspace: "/absent" } });
    expect(await controller["workspace:current"]({})).toBeNull();
  });

  it("clone puis ouvre", async () => {
    const { controller } = setup();
    expect(await controller["workspace:clone"]({ url: "https://github.com/o/r.git", dest: "/projets/r" })).toEqual({
      root: "/projets/r",
      name: "r",
    });
  });

  it("synchronise l'espace courant", async () => {
    const { controller } = setup();
    await controller["workspace:open"]({ path: "/projets/demo" });
    expect(await controller["workspace:sync"]({})).toEqual({ pulled: 1, pushed: 0 });
  });

  it("si les services refusent de se recréer, le projet reste celui d'avant", async () => {
    // `extensions:install` réattache le projet : un échec ne doit pas laisser une conversation
    // ouverte sur un contrôleur qui répond « Aucun projet ouvert » à toutes les requêtes.
    let echouer = false;
    const ctx = setup({
      extra: {
        workspaceServices: async (args) => {
          if (echouer) throw new Error("adaptateur de stack introuvable");
          return {
            route: async () => ({ kind: "chat" as const }),
            commands: () => [{ invocation: "tdd", title: "TDD", description: "d", extensionId: "diabeo.tdd" }],
            hookGuards: () => [], outilsAgent: () => [],
            tasks: async () => [],
            cancelTask: async () => {},
            pendingInteractions: async () => [],
            respond: async () => {},
            dispose: async () => {},
          };
        },
      },
    });
    await ctx.controller["workspace:open"]({ path: "/projets/demo" });

    echouer = true;
    await expect(ctx.controller["workspace:open"]({ path: "/projets/autre" })).rejects.toThrow(/adaptateur/);

    // Le projet précédent répond toujours : on n'a pas perdu l'existant au profit de rien.
    expect(await ctx.controller["workspace:current"]({})).toEqual({ root: "/projets/demo", name: "demo" });
    expect(await ctx.controller["commands:list"]({})).toHaveLength(1);
  });

  it("clôturer libère les services du projet et n'en laisse aucun courant", async () => {
    const { controller, serviceLog } = setup();
    await controller["workspace:open"]({ path: "/projets/demo" });
    await controller["workspace:close"]({});

    expect(serviceLog).toEqual(["créés:/projets/demo", "libérés:/projets/demo"]);
    expect(await controller["workspace:current"]({})).toBeNull();
  });

  it("clôturer ferme la session de conversation en cours", async () => {
    const { controller, runtime } = setup();
    await controller["workspace:open"]({ path: "/projets/demo" });
    await controller["chat:start"]({});
    const session = runtime.last;

    await controller["workspace:close"]({});

    expect(session.closed).toBe(true);
    await expect(controller["chat:start"]({})).rejects.toThrow(/Aucun projet/);
  });

  it("un projet clôturé n'est pas rouvert au démarrage suivant", async () => {
    const first = setup();
    await first.controller["workspace:open"]({ path: "/projets/demo" });
    await first.controller["workspace:close"]({});
    expect(first.getSettings().lastWorkspace).toBeUndefined();

    const next = setup({ settings: first.getSettings() });
    expect(await next.controller["workspace:current"]({})).toBeNull();
  });

  it("clôturer sans projet ouvert ne fait rien", async () => {
    const { controller, serviceLog } = setup();
    await controller["workspace:close"]({});
    await controller["workspace:close"]({});
    expect(serviceLog).toEqual([]);
    expect(await controller["workspace:current"]({})).toBeNull();
  });

  it("une restauration concurrente attend que les services du projet soient prêts", async () => {
    // React monte deux fois en <StrictMode> : deux `workspace:current` partent en parallèle.
    let libere!: () => void;
    const servicesPrets = new Promise<void>((r) => (libere = r));
    let creations = 0;
    const { controller } = setup({
      settings: { lastWorkspace: "/projets/demo" },
      extra: {
        workspaceServices: async () => {
          creations++;
          await servicesPrets;
          return {
            route: async () => ({ kind: "chat" as const }),
            commands: () => [],
            hookGuards: () => [], outilsAgent: () => [],
            tasks: async () => [],
            cancelTask: async () => {},
            pendingInteractions: async () => [],
            respond: async () => {},
            dispose: async () => {},
          };
        },
      },
    });

    const premiere = controller["workspace:current"]({});
    const seconde = controller["workspace:current"]({});
    let secondeResolue = false;
    void seconde.then(() => (secondeResolue = true));
    await new Promise((r) => setTimeout(r, 0));
    expect(secondeResolue).toBe(false);

    libere();
    expect(await premiere).toEqual({ root: "/projets/demo", name: "demo" });
    expect(await seconde).toEqual({ root: "/projets/demo", name: "demo" });
    // Un seul jeu de services : sinon les extensions seraient activées deux fois.
    expect(creations).toBe(1);
    // Le projet annoncé ouvert l'est vraiment : ses services répondent.
    expect(await controller["tasks:list"]({})).toEqual([]);
  });

  it("on peut rouvrir un projet après l'avoir clôturé", async () => {
    const { controller, serviceLog } = setup();
    await controller["workspace:open"]({ path: "/projets/demo" });
    await controller["workspace:close"]({});
    expect(await controller["workspace:open"]({ path: "/projets/demo" })).toEqual({ root: "/projets/demo", name: "demo" });
    expect(serviceLog).toEqual(["créés:/projets/demo", "libérés:/projets/demo", "créés:/projets/demo"]);
  });
});

describe("AppController — choix du modèle (D38, ADR 0020)", () => {
  it("liste les modèles du runtime et signale celui retenu pour le projet", async () => {
    const { controller, runtime } = setup();
    runtime.models = [
      { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", multiplier: 1 },
      { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", multiplier: 3 },
    ];
    await controller["workspace:open"]({ path: "/projets/demo" });

    expect(await controller["models:list"]({})).toEqual({
      models: [
        { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", multiplier: 1 },
        { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", multiplier: 3 },
      ],
      selected: null,
    });
  });

  it("agents des tâches : modèle par classe de rôle, puis modèle du projet, puis rien (ADR 0048)", async () => {
    const ctx = setup({ settings: { modelClasses: { "/projets/a": { light: "gpt-5-mini" } } } });
    await ctx.controller["workspace:open"]({ path: "/projets/a" });
    await ctx.controller["model:set"]({ id: "claude-sonnet-5" });
    const modelFor = ctx.getServicesArgs()!.modelFor!;
    expect(await modelFor("light")).toBe("gpt-5-mini");
    // Classe non associée, agent sans classe : le modèle du projet, relu à chaque appel.
    expect(await modelFor("strong")).toBe("claude-sonnet-5");
    expect(await modelFor(undefined)).toBe("claude-sonnet-5");
    await ctx.controller["model:set"]({ id: null });
    expect(await modelFor("strong")).toBeUndefined();
  });

  it("agents des tâches : un modèle que l'abonnement ne propose pas est ignoré (ADR 0048)", async () => {
    const ctx = setup({ settings: { modelClasses: { "/projets/a": { light: "gpt-5-mini" } }, models: { "/projets/a": "claude-sonnet-5" } } });
    ctx.runtime.models = [{ id: "claude-sonnet-5", name: "Claude Sonnet 5" }];
    await ctx.controller["workspace:open"]({ path: "/projets/a" });
    expect(await ctx.getServicesArgs()!.modelFor!("light")).toBe("claude-sonnet-5");
  });

  it("réglage des modèles par classe : lu et écrit par projet, une classe vidée retombe sur le défaut (ADR 0048)", async () => {
    const ctx = setup();
    ctx.runtime.models = [{ id: "gpt-5-mini", name: "GPT-5 mini" }, { id: "claude-sonnet-5.5", name: "Claude Sonnet 5.5" }];
    await ctx.controller["workspace:open"]({ path: "/projets/a" });
    expect(await ctx.controller["model-classes:list"]({})).toEqual({ models: ctx.runtime.models, classes: {} });

    await ctx.controller["model-class:set"]({ modelClass: "light", id: "gpt-5-mini" });
    await ctx.controller["model-class:set"]({ modelClass: "strong", id: "claude-sonnet-5.5" });
    expect((await ctx.controller["model-classes:list"]({})).classes).toEqual({ light: "gpt-5-mini", strong: "claude-sonnet-5.5" });
    expect(await ctx.getServicesArgs()!.modelFor!("light")).toBe("gpt-5-mini");

    await ctx.controller["model-class:set"]({ modelClass: "light", id: null });
    expect((await ctx.controller["model-classes:list"]({})).classes).toEqual({ strong: "claude-sonnet-5.5" });

    // Un autre projet a ses propres réglages.
    await ctx.controller["workspace:open"]({ path: "/projets/b" });
    expect((await ctx.controller["model-classes:list"]({})).classes).toEqual({});
  });

  it("agents des tâches : la liste des modèles n'est pas redemandée à chaque tour (revue de code du 03/10)", async () => {
    const ctx = setup({ settings: { modelClasses: { "/projets/a": { light: "gpt-5-mini" } } } });
    ctx.runtime.models = [{ id: "gpt-5-mini", name: "GPT-5 mini" }];
    let appels = 0;
    const liste = ctx.runtime.listModels.bind(ctx.runtime);
    ctx.runtime.listModels = async () => (appels++, liste());
    await ctx.controller["workspace:open"]({ path: "/projets/a" });
    const modelFor = ctx.getServicesArgs()!.modelFor!;
    await Promise.all([modelFor("light"), modelFor("light"), modelFor("strong"), modelFor(undefined)]);
    expect(appels).toBe(1);
  });

  it("le modèle choisi est retenu par projet et transmis aux sessions suivantes", async () => {
    const ctx = setup();
    await ctx.controller["workspace:open"]({ path: "/projets/a" });
    await ctx.controller["model:set"]({ id: "claude-sonnet-4.5" });
    await ctx.controller["chat:start"]({});
    expect(ctx.runtime.configs.get("fake-1")?.model).toBe("claude-sonnet-4.5");

    // Un autre projet garde son propre choix.
    await ctx.controller["workspace:open"]({ path: "/projets/b" });
    expect((await ctx.controller["models:list"]({})).selected).toBeNull();

    // Et le premier retrouve le sien, y compris au démarrage suivant.
    await ctx.controller["workspace:open"]({ path: "/projets/a" });
    expect((await ctx.controller["models:list"]({})).selected).toBe("claude-sonnet-4.5");
    const suivant = setup({ settings: ctx.getSettings() });
    await suivant.controller["workspace:open"]({ path: "/projets/a" });
    expect((await suivant.controller["models:list"]({})).selected).toBe("claude-sonnet-4.5");
  });

  it("revenir au choix automatique efface le modèle retenu", async () => {
    const { controller, runtime } = setup();
    await controller["workspace:open"]({ path: "/projets/demo" });
    await controller["model:set"]({ id: "claude-sonnet-4.5" });
    await controller["model:set"]({ id: null });
    expect((await controller["models:list"]({})).selected).toBeNull();
    await controller["chat:start"]({});
    expect(runtime.configs.get("fake-1")?.model).toBeUndefined();
  });

  it("un runtime sans liste de modèles n'empêche pas de converser", async () => {
    const { controller, runtime } = setup();
    runtime.models = null; // le port rend `listModels` facultatif
    await controller["workspace:open"]({ path: "/projets/demo" });
    expect(await controller["models:list"]({})).toEqual({ models: [], selected: null });
  });
});

describe("AppController — conversation", () => {
  it("refuse de démarrer sans projet ouvert", async () => {
    const { controller } = setup();
    await expect(controller["chat:start"]({})).rejects.toThrow(/Aucun projet/);
  });

  it("refuse de démarrer avec un PAT classique en expliquant quoi faire", async () => {
    const { controller } = setup({ status: { loggedIn: true, user: "o", tokenKind: "classic-pat", copilotCompatible: false, hostname: "github.com" } });
    await controller["workspace:open"]({ path: "/projets/demo" });
    await expect(controller["chat:start"]({})).rejects.toThrow(/navigateur/);
  });

  it("démarre le runtime avec le jeton, une seule fois, et relaie les événements", async () => {
    const { controller, runtime, tokens, emitted } = setup();
    await controller["workspace:open"]({ path: "/projets/demo" });
    expect(await controller["chat:start"]({})).toEqual([]);
    expect(runtime.started).toBe(true);
    expect(tokens).toEqual(["gho_secret"]);
    expect(runtime.configs.get("fake-1")?.workingDirectory).toBe("/projets/demo");

    runtime.last.onNextSend(reply("Bonjour"));
    await controller["chat:send"]({ text: "Salut" });
    const channels = emitted.map((e) => e.channel);
    expect(channels).toContain("chat:messages");
    expect(channels).toContain("chat:busy");
    expect(channels).toContain("chat:agent");

    await controller["chat:start"]({});
    expect(tokens).toHaveLength(1);
  });

  it("un message posté avant la conversation n'est pas perdu : il y apparaît à l'ouverture", async () => {
    // Les échecs constatés à l'ouverture d'un projet — stack non reconnue, profil refusé —
    // arrivent avant que la conversation existe. Les journaliser ne les montre à personne.
    const ctx = setup();
    await ctx.controller["workspace:open"]({ path: "/projets/demo" });
    ctx.getServicesArgs()!.onPost("agent-studio", "Aucun adaptateur ne reconnaît ce projet.");

    const messages = await ctx.controller["chat:start"]({});

    expect(messages.map((m) => [m.role, m.text])).toContainEqual(["notice", "Aucun adaptateur ne reconnaît ce projet."]);
    // Et une seule fois : la file est vidée, pas rejouée à chaque démarrage.
    expect((await ctx.controller["chat:start"]({})).filter((m) => m.role === "notice")).toHaveLength(1);
  });

  it("les messages en attente suivent le projet : clôturer les oublie", async () => {
    const ctx = setup();
    await ctx.controller["workspace:open"]({ path: "/projets/demo" });
    ctx.getServicesArgs()!.onPost("agent-studio", "message du projet précédent");
    await ctx.controller["workspace:close"]({});

    await ctx.controller["workspace:open"]({ path: "/projets/autre" });
    expect((await ctx.controller["chat:start"]({})).filter((m) => m.role === "notice")).toEqual([]);
  });

  it("deux canaux concurrents ne démarrent qu'un seul runtime", async () => {
    // `ChatScreen` lance `chat:start` et `models:list` dans le même tour : tous deux
    // appellent `ensureRuntime`. Deux runtimes, c'est deux processus Copilot dont un fuit.
    const { controller, tokens } = setup();
    await controller["workspace:open"]({ path: "/projets/demo" });

    await Promise.all([controller["chat:start"]({}), controller["models:list"]({})]);

    expect(tokens).toHaveLength(1);
  });

  it("un runtime qui refuse de démarrer n'est pas retenu : le suivant réessaie", async () => {
    const { controller, runtime, tokens } = setup();
    await controller["workspace:open"]({ path: "/projets/demo" });
    runtime.failStart = new Error("démarrage impossible");

    await expect(controller["chat:start"]({})).rejects.toThrow(/démarrage impossible/);

    runtime.failStart = null;
    await controller["chat:start"]({});
    expect(tokens).toHaveLength(2);
  });

  it("deux démarrages concurrents n'ouvrent qu'une seule session", async () => {
    // React monte deux fois en <StrictMode> : `chat:start` part deux fois en parallèle.
    const { controller, runtime } = setup();
    await controller["workspace:open"]({ path: "/projets/demo" });

    const [a, b] = await Promise.all([controller["chat:start"]({}), controller["chat:start"]({})]);

    expect(runtime.history).toHaveLength(1);
    expect(a).toEqual(b);
  });

  it("une reprise concurrente ne reprend pas deux fois la même session", async () => {
    const premier = setup();
    await premier.controller["workspace:open"]({ path: "/projets/demo" });
    await premier.controller["chat:start"]({});
    const id = premier.runtime.last.id;

    // Nouveau contrôleur sur les mêmes stockages : la conversation est reprise.
    const suivant = setup({ settings: premier.getSettings(), extra: { conversations: premier.conversations } });
    await suivant.controller["workspace:open"]({ path: "/projets/demo" });
    suivant.runtime.sessions.set(id, premier.runtime.last);

    await Promise.all([suivant.controller["chat:start"]({}), suivant.controller["chat:start"]({})]);
    expect(suivant.runtime.history).toHaveLength(1);
  });

  it("annulation et changements d'un tour s'appuient sur son checkpoint", async () => {
    const { controller, runtime, workspaces } = setup();
    await controller["workspace:open"]({ path: "/projets/demo" });
    await controller["chat:start"]({});
    runtime.last.onNextSend(reply("ok"));
    await controller["chat:send"]({ text: "Crée a.txt" });

    expect(await controller["chat:turn-changes"]({ messageId: "m1" })).toEqual({
      files: [{ path: "a.txt", status: "added" }],
      patch: "+a",
    });
    await controller["chat:undo"]({ messageId: "m1" });
    expect(workspaces.get("/projets/demo")?.diffs).toEqual(["cp-1"]);
    expect(workspaces.get("/projets/demo")?.rolledBack).toEqual(["cp-1"]);
  });

  it("changer de projet ferme la session précédente", async () => {
    const { controller, runtime } = setup();
    await controller["workspace:open"]({ path: "/projets/a" });
    await controller["chat:start"]({});
    const first = runtime.last;
    await controller["workspace:open"]({ path: "/projets/b" });
    expect(first.closed).toBe(true);
    await controller["chat:start"]({});
    expect(runtime.configs.get("fake-2")?.workingDirectory).toBe("/projets/b");
  });

  it("les confirmations de la garde passent par la fenêtre", async () => {
    const { controller, runtime, emitted } = setup();
    await controller["workspace:open"]({ path: "/projets/demo" });
    await controller["chat:start"]({});
    const guard = runtime.configs.get("fake-1")!.guard;

    const decision = guard.check({ kind: "shell", toolName: "shell", command: "npm install left-pad" });
    await new Promise((r) => setTimeout(r, 0));
    const req = emitted.find((e) => e.channel === "confirm:request")?.payload as { id: string; detail: string };
    expect(req.detail).toContain("npm install left-pad");
    await controller["confirm:respond"]({ id: req.id, answer: "allow-once" });
    expect(await decision).toEqual({ decision: "allow" });
  });
});

describe("AppController — commandes, tâches et interactions (J2)", () => {
  async function started() {
    const ctx = setup();
    await ctx.controller["workspace:open"]({ path: "/projets/demo" });
    await ctx.controller["chat:start"]({});
    return ctx;
  }

  it("un /commande passe par l'extension, est consigné, et n'est jamais envoyé à l'agent", async () => {
    const { controller, runtime } = await started();
    await controller["chat:send"]({ text: "/tdd Plafonner" });
    const msgs = await controller["chat:start"]({});
    expect(msgs.map((m) => [m.role, m.text, m.origin])).toEqual([
      ["user", "/tdd Plafonner", undefined],
      ["notice", "Cycle TDD lancé", "diabeo.tdd"],
    ]);
    expect(runtime.last.sent).toEqual([]);
  });

  it("commande inconnue : avis listant les commandes disponibles", async () => {
    const { controller } = await started();
    await controller["chat:send"]({ text: "/pirate x" });
    const msgs = await controller["chat:start"]({});
    expect(msgs.at(-1)?.text).toBe("Commande inconnue : /pirate. Commandes disponibles : /tdd.");
  });

  it("le texte libre part toujours vers la session principale", async () => {
    const { controller, runtime } = await started();
    runtime.last.onNextSend(reply("ok"));
    await controller["chat:send"]({ text: "Bonjour" });
    expect(runtime.last.sent).toEqual(["Bonjour"]);
  });

  it("les cartes de tâche et les demandes sont relayées à la fenêtre", async () => {
    const { controller, emitted, getServicesArgs } = await started();
    const card = { id: "t1", title: "Cycle TDD", phase: "RED", phaseLabel: "Écriture du test", status: "running" as const, alert: false, milestone: false, updatedAt: "" };
    getServicesArgs()!.onTask(card);
    getServicesArgs()!.onInteractions([]);
    expect(emitted).toContainEqual({ channel: "task:update", payload: card });
    expect(emitted).toContainEqual({ channel: "interactions:changed", payload: { pending: [] } });
    expect(await controller["commands:list"]({})).toEqual([{ invocation: "tdd", title: "TDD", description: "d" }]);
  });

  it("réponses et annulations délèguent aux services ; changer de projet les libère", async () => {
    const { controller, serviceLog } = await started();
    await controller["interaction:respond"]({ id: "int-1", option: "approve" });
    await controller["task:cancel"]({ taskId: "t1" });
    await controller["workspace:open"]({ path: "/projets/autre" });
    // Les services du nouveau projet sont construits d'abord : si leur création échoue, le
    // projet en cours reste utilisable. Les anciens ne sont libérés qu'ensuite.
    expect(serviceLog).toEqual([
      "créés:/projets/demo",
      "réponse:int-1:approve:developpeur",
      "annule:t1",
      "créés:/projets/autre",
      "libérés:/projets/demo",
    ]);
  });
});

describe("AppController — arbitre de permissions (J4)", () => {
  it("un hook d'extension qui refuse bloque l'outil sans question à l'utilisateur", async () => {
    const { controller, runtime, emitted, hookGuards } = setup();
    await controller["workspace:open"]({ path: "/projets/demo" });
    await controller["chat:start"]({});
    hookGuards.push({ check: async () => ({ decision: "deny", reason: "[diabeo.demo] non" }) });
    const guard = runtime.configs.get("fake-1")!.guard;
    expect(await guard.check({ kind: "shell", toolName: "shell", command: "npm test" })).toEqual({ decision: "deny", reason: "[diabeo.demo] non" });
    expect(emitted.some((e) => e.channel === "confirm:request")).toBe(false);
  });

  it("un hook d'extension qui plante n'autorise rien", async () => {
    const { controller, runtime, hookGuards } = setup();
    await controller["workspace:open"]({ path: "/projets/demo" });
    await controller["chat:start"]({});
    hookGuards.push({ check: async () => Promise.reject(new Error("boum")) });
    const guard = runtime.configs.get("fake-1")!.guard;
    expect(await guard.check({ kind: "write", toolName: "edit", path: "src/a.ts" })).toMatchObject({ decision: "deny" });
  });
});

describe("AppController — profils, modes et extensions (J6)", () => {
  it("profil en lecture seule ; mode par défaut du profil, modifiable par l'utilisateur", async () => {
    const { controller, getSettings } = setup({
      extra: { profile: { profile: { role: "po", defaultMode: "simple", permissionPolicy: "prudente" }, developerMode: false, source: "/etc/agent-studio/admin.json" } },
    });
    expect(await controller["profile:get"]({})).toEqual({
      role: "po",
      roleLabel: "PO / BA",
      defaultMode: "simple",
      permissionPolicy: "prudente",
      developerMode: false,
      adminSource: "/etc/agent-studio/admin.json",
    });
    expect(await controller["ui:get-mode"]({})).toBe("simple");
    await controller["ui:set-mode"]({ mode: "advanced" });
    expect(await controller["ui:get-mode"]({})).toBe("advanced");
    expect(getSettings().uiMode).toBe("advanced");
  });

  it("la réponse à une demande porte le rôle du profil", async () => {
    const { controller, serviceLog } = setup({
      extra: { profile: { profile: { role: "architecte", defaultMode: "advanced", permissionPolicy: "souple" }, developerMode: false, source: "x" } },
    });
    await controller["workspace:open"]({ path: "/projets/demo" });
    await controller["interaction:respond"]({ id: "int-9", option: "accept" });
    expect(serviceLog).toContain("réponse:int-9:accept:architecte");
  });

  it("installation depuis un fichier : accord demandé dans la fenêtre, puis services rechargés", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { generateKeyPair, packExtension } = await import("@agent-studio/extension-packaging");
    const { createExtensionInstaller } = await import("@agent-studio/extension-installer");
    const dir = await mkdtemp(join(tmpdir(), "agent-studio-ctl-"));
    const key = generateKeyPair();
    const enc = (x: string) => new TextEncoder().encode(x);
    const manifest = { id: "tiers.lint", version: "1.0.0", publisher: "tiers", engines: { appApi: "^0.1" }, main: "dist/index.mjs", permissions: ["fs:read"], contributes: { commands: [{ name: "lint", title: "Vérifier le style", description: "d" }] } };
    const file = join(dir, "lint.asx");
    await writeFile(file, packExtension(new Map([["manifest.json", enc(JSON.stringify(manifest))], ["dist/index.mjs", enc("export default {activate(){}}")]]), { privateKeyPem: key.privateKeyPem, keyId: key.keyId }));

    let ctl!: ReturnType<typeof createAppController>;
    const installer = createExtensionInstaller({
      installDir: join(dir, "extensions"),
      appApi: "0.1.0",
      trusted: () => [{ publisher: "tiers", keyId: key.keyId, publicKeyPem: key.publicKeyPem, trustedUpdates: false }],
      devMode: () => false,
      consent: (req) => ctl.askConsent(req),
      revocation: async () => null,
      rootPublicKeyPem: key.publicKeyPem,
      clock: { now: () => new Date() },
    });
    const env = setup({ extra: { installer, folderPicker: { pick: async () => null, pickPackage: async () => file } } });
    ctl = env.controller;
    await ctl["workspace:open"]({ path: "/projets/demo" });

    const install = ctl["extensions:install"]({});
    await new Promise((r) => setTimeout(r, 50));
    const req = env.emitted.find((e) => e.channel === "extension-consent:request")?.payload as { id: string; permissions: unknown[]; commands: string[] };
    expect(req.permissions).toEqual([{ permission: "fs:read", description: "Lire les fichiers du projet" }]);
    expect(req.commands).toEqual(["Vérifier le style : d"]);
    await ctl["extension-consent:respond"]({ id: req.id, accept: true });

    expect(await install).toEqual({ status: "installed", id: "tiers.lint", version: "1.0.0" });
    expect(env.serviceLog.filter((l) => l.startsWith("créés"))).toHaveLength(2);
    expect(env.emitted.some((e) => e.channel === "extensions:changed")).toBe(true);
    expect(await ctl["extensions:list"]({})).toEqual([
      { id: "tiers.lint", version: "1.0.0", publisher: "tiers", builtIn: false, signed: true, status: "active", commands: ["Vérifier le style"] },
    ]);
  });

  it("installation annulée au choix du fichier", async () => {
    const { controller } = setup({ extra: { installer: { installFromFile: async () => ({ status: "declined" }), list: async () => [], uninstall: async () => {}, applyRevocations: async () => [], active: async () => [] }, folderPicker: { pick: async () => null, pickPackage: async () => null } } });
    expect(await controller["extensions:install"]({})).toEqual({ status: "cancelled" });
  });
});

/**
 * Réserve Copilot exposée au renderer (ADR 0044).
 *
 * Le 29/09, une tâche a été lancée avec 28 requêtes premium en réserve sur 1500, pour une phase
 * qui en demande des dizaines. L'information existait chez GitHub, à un appel d'ici, et rien ne la
 * demandait. §10.2 tient : ce sont des chiffres qui franchissent l'IPC, jamais un jeton.
 */
describe("auth:quota", () => {
  const QUOTA = { total: 1500, utilisees: 1471, restantes: 28, pourcentageRestant: 1.8, depassementAutorise: false, remiseAZero: "2026-10-01" };

  it("rend la réserve telle que l'authentification la lit", async () => {
    const { controller } = setup({ quota: QUOTA });
    expect(await controller["auth:quota"]({})).toEqual(QUOTA);
  });

  it("réserve illisible : `null` traverse l'IPC sans faire échouer l'appel", async () => {
    const { controller } = setup({ quota: null });
    expect(await controller["auth:quota"]({})).toBeNull();
  });

  it("le contrat IPC accepte les deux formes, et rien d'autre", async () => {
    // Le renderer est sandboxé : ce qui franchit l'IPC est validé, ici comme ailleurs.
    expect(requests["auth:quota"].output.parse(QUOTA)).toEqual(QUOTA);
    expect(requests["auth:quota"].output.parse(null)).toBeNull();
    expect(() => requests["auth:quota"].output.parse({ restantes: "beaucoup" })).toThrow();
  });
});
