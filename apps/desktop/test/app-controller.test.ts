import type { GitHubAuth, AuthStatus } from "@agent-studio/github-auth";
import type { Workspace } from "@agent-studio/workspace";
import { MemoryConversationStore, reply, ScriptedRuntime, sequentialIds, fixedClock } from "@agent-studio/core/testing";
import { describe, expect, it } from "vitest";
import { createAppController } from "../src/main/app-controller.js";
import type { AppSettings, EventSink, WorkspaceProvider, WorkspaceServices, WorkspaceServicesArgs } from "../src/main/protocols.js";
import type { EventChannel } from "../src/shared/ipc-contract.js";

const OAUTH: AuthStatus = { loggedIn: true, user: "octo", tokenKind: "oauth", copilotCompatible: true };

function fakeWorkspace(root: string): Workspace & { rolledBack: string[]; diffs: string[] } {
  const rolledBack: string[] = [];
  const diffs: string[] = [];
  let n = 0;
  return {
    root,
    rolledBack,
    diffs,
    files: { read: async () => "", write: async () => {}, list: async () => [] },
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
    repo: { head: async () => "h", commit: async () => null, sync: async () => ({ pulled: 1, pushed: 0 }) },
  };
}

function setup(opts: { status?: AuthStatus; settings?: AppSettings } = {}) {
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
  const auth: GitHubAuth = {
    status: async () => opts.status ?? OAUTH,
    token: async () => "gho_secret",
    login: async (onCode) => {
      onCode({ code: "AB12-CD34", verificationUrl: "https://github.com/login/device" });
      return OAUTH;
    },
  };
  const opened: string[] = [];
  const serviceLog: string[] = [];
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
        tasks: async () => [],
        cancelTask: async (id) => void serviceLog.push(`annule:${id}`),
        pendingInteractions: async () => [],
        respond: async (id, option) => void serviceLog.push(`réponse:${id}:${option}`),
        dispose: async () => void serviceLog.push(`libérés:${args.workspace.root}`),
      };
      return services;
    },
    runtimeFactory: (token) => {
      tokens.push(token);
      return runtime;
    },
    conversations: new MemoryConversationStore(),
    settings: { load: async () => settings, save: async (s) => void (settings = s) },
    folderPicker: { pick: async () => "/choisi" },
    external: { open: async (url) => void opened.push(url) },
    sink,
    clock: fixedClock(),
    ids: sequentialIds(),
    systemPrompt: "Rôle.",
  });
  return { controller, runtime, tokens, emitted, workspaces, opened, serviceLog, getServicesArgs: () => servicesArgs, getSettings: () => settings };
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
});

describe("AppController — conversation", () => {
  it("refuse de démarrer sans projet ouvert", async () => {
    const { controller } = setup();
    await expect(controller["chat:start"]({})).rejects.toThrow(/Aucun projet/);
  });

  it("refuse de démarrer avec un PAT classique en expliquant quoi faire", async () => {
    const { controller } = setup({ status: { loggedIn: true, user: "o", tokenKind: "classic-pat", copilotCompatible: false } });
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

    const decision = guard.check({ kind: "shell", toolName: "shell", command: "npm test" });
    await new Promise((r) => setTimeout(r, 0));
    const req = emitted.find((e) => e.channel === "confirm:request")?.payload as { id: string; detail: string };
    expect(req.detail).toContain("npm test");
    await controller["confirm:respond"]({ id: req.id, allowed: true });
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
    expect(serviceLog).toEqual([
      "créés:/projets/demo",
      "réponse:int-1:approve",
      "annule:t1",
      "libérés:/projets/demo",
      "créés:/projets/autre",
    ]);
  });
});
