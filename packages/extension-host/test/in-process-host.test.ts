import { createHookRegistry, createInteractionService, createRegistry, type TaskAgentRunner, type TaskAgentSpec } from "@agent-studio/core";
import { fixedClock, MemoryEvidenceStore, MemoryInteractionStore, RecordingCheckpoints, sequentialIds } from "@agent-studio/core/testing";
import type { ExtensionContext, ExtensionManifest, ExtensionModule } from "@agent-studio/extension-api";
import type { StackAdapter } from "@agent-studio/stack-adapters";
import { createTaskEngine, MemoryTaskStore } from "@agent-studio/task-engine";
import type { Workspace } from "@agent-studio/workspace";
import { describe, expect, it } from "vitest";
import { activateInProcess, type HostDeps } from "../src/in-process-host.js";
import { PermissionDeniedError } from "../src/permissions.js";

const MANIFEST: ExtensionManifest = {
  id: "diabeo.demo",
  version: "0.1.0",
  publisher: "diabeo",
  engines: { appApi: "^0.1" },
  permissions: ["fs:read", "fs:write:tests/**", "copilot:sessions", "shell:test", "git:commit", "git:revert"],
  contributes: {
    commands: [{ name: "demo", title: "Démo", description: "Lance la démo" }],
    agents: [{ name: "writer", title: "Rédacteur", role: "Tu écris des tests.", output: "report_phase", write: ["tests/**"] }],
    tasks: [{ name: "cycle", title: "Cycle", states: { A: "Étape A" } }],
  },
};

function fakeWorkspace(): Workspace {
  const files: Record<string, string> = { "tests/a.test.ts": "x", "src/a.ts": "y" };
  return {
    root: "/projets/demo",
    files: { read: async (p) => files[p] ?? "", write: async () => {}, ensureDir: async () => {}, list: async () => Object.keys(files) },
    checkpoints: {
      create: async (label) => ({ id: "cp-1", sha: "s", head: "h", label, createdAt: "" }),
      list: async () => [],
      diff: async () => ({ files: [{ path: "tests/a.test.ts", status: "modified" }], patch: "" }),
      rollback: async () => {},
    },
    repo: {
      // Ce double ne sait pas ouvrir de copie isolée : échouer vaut mieux que rendre une racine vide.
      worktree: async () => { throw new Error("copie isolée non fournie par ce double"); },
      head: async () => "h", commit: async () => "sha-1", sync: async () => ({ pulled: 0, pushed: 0 }), switchBranch: async () => {} },
  };
}

function setup(manifest: ExtensionManifest = MANIFEST) {
  const runs: { spec: TaskAgentSpec; prompt: string }[] = [];
  const agents: TaskAgentRunner = {
    run: async (spec, prompt) => {
      runs.push({ spec, prompt });
      return { output: { summary: "ok", files: [] } as never };
    },
    releaseTask: async () => {}, releaseRoles: async () => {}, releaseAll: async () => {},
  };
  const engine = createTaskEngine({ store: new MemoryTaskStore(), checkpoints: new RecordingCheckpoints(), clock: fixedClock(), ids: sequentialIds("t") });
  const posted: string[] = [];
  const stack: StackAdapter = {
    id: "typescript", layout: { acceptanceTests: ["tests/acceptance/**"], unitTests: ["tests/**"], sources: ["src/**"] }, infrastructureModules: ["Infrastructure"], 
    detect: async () => true,
    runTests: async () => ({ results: [], exitCode: 0, timedOut: false, output: "", durationMs: 1 }),
    isTestFile: (p) => p.startsWith("tests/"),
    testFilePattern: "^tests/",
  };
  const deps: HostDeps = {
    registry: createRegistry(),
    engine,
    agents,
    workspace: fakeWorkspace(),
    stack,
    interactions: createInteractionService({
      store: new MemoryInteractionStore(),
      clock: fixedClock(),
      ids: sequentialIds("int-"),
      deliver: (taskId, option, comment) => engine.dispatch(taskId, { type: "HUMAN_DECISION", decision: option, ...(comment ? { comment } : {}) }),
    }),
    chat: { post: (ext, md) => void posted.push(`${ext}: ${md}`) },
    evidence: new MemoryEvidenceStore(),
    hooks: createHookRegistry(),
    clock: fixedClock(),
    ids: sequentialIds("ev-"),
  };
  return { deps, runs, posted };
}

async function activateWith(activate: (ctx: ExtensionContext) => void | Promise<void>, manifest = MANIFEST) {
  const env = setup(manifest);
  let ctx!: ExtensionContext;
  const module: ExtensionModule = {
    activate: async (c) => {
      ctx = c;
      await activate(c);
    },
  };
  const handle = await activateInProcess({ manifest, module }, env.deps);
  return { ...env, ctx, handle };
}

describe("Hôte d'extension en processus", () => {
  it("l'extension voit les couples BDD de la pile ; sans BDD, rien (ADR 0074)", async () => {
    const env = setup();
    env.deps.stack = { ...env.deps.stack, bdd: [{ lanceur: "reqnroll", features: "tests/Features", etapes: "tests/Steps" }] };
    let vu: unknown = "non lu";
    await activateInProcess({ manifest: MANIFEST, module: { activate: (c) => void (vu = c.stack.bdd) } }, env.deps);
    expect(vu).toEqual([{ lanceur: "reqnroll", features: "tests/Features", etapes: "tests/Steps" }]);
    const { ctx } = await activateWith(() => {});
    expect(ctx.stack.bdd).toBeUndefined();
  });

  it("l'extension voit les racines où rien ne décide le BDD (08/11)", async () => {
    const env = setup();
    env.deps.stack = { ...env.deps.stack, bddNonDecide: [".", "web"] };
    let vu: unknown = "non lu";
    await activateInProcess({ manifest: MANIFEST, module: { activate: (c) => void (vu = c.stack.bddNonDecide) } }, env.deps);
    expect(vu).toEqual([".", "web"]);
  });

  it("les commandes déclarées sont enregistrées au registre et invocables", async () => {
    const seen: string[] = [];
    const { deps } = await activateWith((ctx) => void ctx.chat.registerCommand("demo", async (args) => void seen.push(args)));
    await deps.registry.command("demo")!.handler("bonjour");
    expect(seen).toEqual(["bonjour"]);
    expect(deps.registry.command("diabeo.demo/demo")?.title).toBe("Démo");
  });

  it("refuse d'enregistrer une commande non déclarée", async () => {
    await expect(activateWith((ctx) => void ctx.chat.registerCommand("pirate", async () => {}))).rejects.toThrow(/non déclarée/);
  });

  it("agents.run : le modèle est résolu par le cœur depuis la classe déclarée (ADR 0048)", async () => {
    const manifest = {
      ...MANIFEST,
      contributes: { ...MANIFEST.contributes, agents: [{ name: "writer", title: "Rédacteur", role: "r", output: "report_phase", write: ["tests/**"], modelClass: "light" as const }] },
    } as ExtensionManifest;
    const { ctx, deps, runs } = await activateWith(() => {}, manifest);
    const demandes: (string | undefined)[] = [];
    deps.modelFor = async (cls) => (demandes.push(cls), cls === "light" ? "gpt-5-mini" : undefined);
    await ctx.agents.run("writer", "x");
    expect(demandes).toEqual(["light"]);
    expect(runs[0]?.spec).toMatchObject({ model: "gpt-5-mini" });
  });

  it("agents.run : modèle non résolu, aucun modèle n'est demandé (le runtime décide)", async () => {
    const { ctx, deps, runs } = await activateWith(() => {});
    deps.modelFor = async () => undefined;
    await ctx.agents.run("writer", "x");
    expect(runs[0]?.spec).not.toHaveProperty("model");
  });

  it("agents.run : agent déclaré, rôle, périmètre et sortie du manifeste ; résultat sérialisé uniquement", async () => {
    const { ctx, runs } = await activateWith(() => {});
    const r = await ctx.agents.run("writer", "Écris un test");
    expect(r).toEqual({ output: { summary: "ok", files: [] } });
    expect(runs[0]?.spec).toEqual({ role: "diabeo.demo/writer", systemPrompt: expect.any(String), writable: ["tests/**"], output: "report_phase", blocker: false });
    // Consignes du manifeste, puis contrat d'exécution ajouté par le cœur (ADR 0024).
    expect(runs[0]?.spec.systemPrompt).toMatch(/^Tu écris des tests\.\n\n## Fonctionnement dans agent-studio\n/);
    expect(runs[0]?.spec.systemPrompt).toContain("appelant l'outil `report_phase`");
    await expect(ctx.agents.run("inconnu", "x")).rejects.toThrow(/non déclaré/);
  });

  it("agent en fichier Markdown avec skills : prompt composé, load_skill fourni, chargements rendus à l'extension", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "agent-studio-ext-md-"));
    try {
      await mkdir(join(dir, "agents"));
      await mkdir(join(dir, "skills/craft"), { recursive: true });
      await writeFile(join(dir, "agents/writer.agent.md"), "---\nname: writer\ndescription: Écrit\n---\n\nTu écris des tests.\n");
      await writeFile(join(dir, "skills/craft/SKILL.md"), "---\nname: craft\ndescription: Artisanat\n---\n\n# Craft\n\nPetites méthodes.\n");
      const manifest: ExtensionManifest = {
        ...MANIFEST,
        contributes: {
          ...MANIFEST.contributes,
          agents: [{ name: "writer", title: "Rédacteur", prompt: "agents/writer.agent.md", output: "report_phase", write: ["tests/**"], skills: { onDemand: ["craft"] } }],
          skills: [{ name: "craft", path: "skills/craft" }],
        },
      };
      const env = setup(manifest);
      let tools: import("@agent-studio/core").ToolSpec[] = [];
      let prompt = "";
      env.deps.agents = {
        run: async (spec, _p, opts) => {
          prompt = spec.systemPrompt;
          tools = opts?.tools?.(() => {}) ?? [];
          await tools.find((t) => t.name === "load_skill")!.handler({ name: "craft" });
          return { output: { summary: "", files: [] } as never };
        },
        releaseTask: async () => {}, releaseRoles: async () => {}, releaseAll: async () => {},
      };
      let ctx!: ExtensionContext;
      await activateInProcess({ manifest, module: { activate: (c) => void (ctx = c) }, directory: dir }, env.deps);
      const r = await ctx.agents.run("writer", "x");
      expect(prompt.startsWith("Tu écris des tests.")).toBe(true);
      expect(prompt).toContain("`craft` : Artisanat");
      expect(tools.map((t) => t.name)).toEqual(["load_skill"]);
      expect(r).toEqual({ output: { summary: "", files: [] }, skillsLoaded: ["craft"] });
      // Sans dossier, une extension qui déclare des fichiers de rôle ne s'active pas.
      await expect(activateInProcess({ manifest, module: { activate: () => {} } }, setup(manifest).deps)).rejects.toThrow(/dossier est inconnu/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("mémoire déclarée par agent (ADR 0053) : « tour » repart toujours neuf, « tache » (défaut) garde sa session", async () => {
    const manifest: ExtensionManifest = {
      ...MANIFEST,
      contributes: {
        ...MANIFEST.contributes,
        agents: [
          { name: "writer", title: "Rédacteur", role: "r", output: "report_phase", write: ["tests/**"] },
          { name: "lens", title: "Lentille", role: "r", output: "report_phase", memoire: "tour" },
        ],
      },
    };
    const env = setup(manifest);
    const cles: (string | undefined)[] = [];
    env.deps.agents = {
      run: async (_s, _p, opts) => (cles.push(opts?.resumeKey), { output: { summary: "", files: [] } as never }),
      releaseTask: async () => {}, releaseRoles: async () => {}, releaseAll: async () => {},
    };
    let ctx!: ExtensionContext;
    await activateInProcess({ manifest, module: { activate: (c) => void (ctx = c) } }, env.deps);
    await ctx.agents.run("writer", "x", { evidence: { taskId: "t1" } });
    await ctx.agents.run("lens", "x", { evidence: { taskId: "t1" } });
    expect(cles).toEqual(["t1/diabeo.demo/writer", undefined]);
  });

  it("une capacité non déclarée est refusée (D11)", async () => {
    const manifest: ExtensionManifest = { ...MANIFEST, permissions: ["fs:read"] , contributes: { ...MANIFEST.contributes, agents: [] } };
    const { ctx } = await activateWith(() => {}, manifest);
    await expect(ctx.git.commit("x")).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(ctx.stack.runTests()).rejects.toThrow(/shell:test/);
    await expect(ctx.workspace.rollback("cp")).rejects.toThrow(/git:revert/);
    await expect(ctx.agents.run("writer", "x")).rejects.toThrow(/copilot:sessions/);
    expect(await ctx.workspace.listFiles()).toHaveLength(2); // fs:read déclarée
  });

  it("un agent dont le périmètre d'écriture dépasse les permissions fs:write fait échouer l'activation", async () => {
    const manifest: ExtensionManifest = {
      ...MANIFEST,
      contributes: { ...MANIFEST.contributes, agents: [{ name: "w", title: "W", role: "r", output: "report_phase", write: ["src/**"] }] },
    };
    await expect(activateWith(() => {}, manifest)).rejects.toThrow(/fs:write:src\/\*\*/);
  });

  it("tâches : nom préfixé par l'extension, déclarée au manifeste, l'effet reçoit le ctx", async () => {
    let effectCtx: ExtensionContext | undefined;
    const { ctx, deps } = await activateWith((c) =>
      c.tasks.register({
        name: "cycle",
        initialState: () => ({ done: false }),
        initialEffects: () => ["go"],
        transition: (s, e) => (e.type === "DONE" ? { state: { done: true }, effects: [] } : { state: s, effects: [] }),
        runEffect: async (_f, d) => {
          effectCtx = d;
          return { type: "DONE" };
        },
        checkpointBefore: () => false,
        isTerminal: (s) => s.done,
      }),
    );
    const id = await ctx.tasks.start("cycle", {});
    await deps.engine.idle(id);
    expect((await deps.engine.status(id))?.name).toBe("diabeo.demo/cycle");
    expect(effectCtx?.extensionId).toBe("diabeo.demo");
    await expect(
      activateWith((c) => c.tasks.register({ name: "absente", initialState: () => 0, initialEffects: () => [], transition: (s) => ({ state: s, effects: [] }), runEffect: async () => {}, isTerminal: () => true })),
    ).rejects.toThrow(/non déclarée/);
  });

  it("interactions : la réponse revient à la tâche comme HUMAN_DECISION", async () => {
    const decisions: string[] = [];
    const { ctx, deps } = await activateWith((c) =>
      c.tasks.register({
        name: "cycle",
        initialState: () => ({ done: false }),
        initialEffects: () => ["ask"],
        transition: (s, e) => {
          if (e.type === "HUMAN_DECISION" && "decision" in e) decisions.push(e.decision);
          return { state: { done: e.type === "HUMAN_DECISION" }, effects: [] };
        },
        runEffect: async (_f, d, { taskId }) => void (await d.interactions.request({ taskId, title: "Valider ?", options: [{ id: "yes", label: "Oui" }] })),
        checkpointBefore: () => false,
        isTerminal: (s) => s.done,
      }),
    );
    const id = await ctx.tasks.start("cycle", {});
    await deps.engine.idle(id);
    const [pending] = await deps.interactions.pending();
    expect(pending).toMatchObject({ extensionId: "diabeo.demo", taskId: id, title: "Valider ?" });
    await deps.interactions.respond(pending!.id, "yes");
    expect(decisions).toEqual(["yes"]);
  });

  it("chat.post porte l'origine ; aucune propriété du contexte n'expose le runtime", async () => {
    const { ctx, posted } = await activateWith(() => {});
    ctx.chat.post("Bonjour");
    expect(posted).toEqual(["diabeo.demo: Bonjour"]);
    // Liste verrouillée : c'est la règle de sécurité n°1 — aucun objet du SDK n'est jamais exposé à
    // une extension. `trace` s'y ajoute (ADR 0038) et ne la met pas en cause : elle ne sait
    // qu'archiver des livrables, et la trace RACONTE, elle n'atteste rien (une porte ne doit jamais
    // s'y appuyer, contrairement à `evidence`).
    expect(Object.keys(ctx).sort()).toEqual([
      "agents", "chat", "evidence", "extensionId", "git", "hooks", "interactions", "log", "stack", "tasks", "tools", "trace", "workspace",
    ]);
  });

  it("hooks : un refus d'extension s'applique aux sessions d'agent, préfixé par l'extension", async () => {
    const { ctx, deps, runs } = await activateWith((c) =>
      void c.hooks.onPreToolUse((call) => (call.kind === "shell" ? { decision: "deny", reason: "pas de shell ici" } : undefined)),
    );
    const [guard] = deps.hooks.guards();
    expect(await guard!.check({ kind: "shell", toolName: "bash", command: "ls" })).toEqual({ decision: "deny", reason: "[diabeo.demo] pas de shell ici" });
    expect(await guard!.check({ kind: "read", toolName: "view", path: "a" })).toEqual({ decision: "allow" });
    void ctx;
    void runs;
  });

  it("hooks : les gardes des extensions sont transmises à chaque agent lancé", async () => {
    let seen: unknown[] = [];
    const env = setup();
    env.deps.agents = { releaseTask: async () => {}, releaseRoles: async () => {}, releaseAll: async () => {}, run: async (_s, _p, opts) => ((seen = opts?.guards ?? []), { output: { summary: "", files: [] } as never }) };
    let ctx!: ExtensionContext;
    await activateInProcess({ manifest: MANIFEST, module: { activate: (c) => void ((ctx = c), c.hooks.onPreToolUse(() => undefined)) } }, env.deps);
    await ctx.agents.run("writer", "x");
    expect(seen).toHaveLength(1);
  });

  it("readOnly : écriture refusée sur les motifs gelés (@stack:* résolus), le reste du périmètre reste permis", async () => {
    let seen: import("@agent-studio/core").ToolCallGuard[] = [];
    const env = setup();
    env.deps.agents = { releaseTask: async () => {}, releaseRoles: async () => {}, releaseAll: async () => {}, run: async (_s, _p, opts) => ((seen = opts?.guards ?? []), { output: { summary: "", files: [] } as never }) };
    let ctx!: ExtensionContext;
    await activateInProcess({ manifest: MANIFEST, module: { activate: (c) => void (ctx = c) } }, env.deps);
    await ctx.agents.run("writer", "x", { readOnly: ["@stack:acceptanceTests"] });
    expect(seen).toHaveLength(1);
    const deny = await seen[0]!.check({ kind: "write", toolName: "edit", path: "tests/acceptance/cap.test.ts" });
    expect(deny).toMatchObject({ decision: "deny", reason: expect.stringContaining("tests/acceptance/cap.test.ts est gelé") });
    expect(await seen[0]!.check({ kind: "write", toolName: "edit", path: "/projets/demo/tests/unit/cap.test.ts" })).toEqual({ decision: "allow" });
    expect(await seen[0]!.check({ kind: "read", toolName: "view", path: "tests/acceptance/cap.test.ts" })).toEqual({ decision: "allow" });
  });

  it("stack.mutation et stack.architecture : null si la stack ne les propose pas, sinon délégués à l'adaptateur", async () => {
    const env = setup();
    let ctx!: ExtensionContext;
    await activateInProcess({ manifest: MANIFEST, module: { activate: (c) => void (ctx = c) } }, env.deps);
    expect(await ctx.stack.mutation()).toBeNull();
    expect(await ctx.stack.architecture([])).toBeNull();
    env.deps.stack.mutation = async (o) => ({ score: o.root === "/projets/demo" ? 100 : 0, files: [] });
    env.deps.stack.architecture = async (o) => ({ modules: [], violations: o.rules.map((r) => ({ module: r.module, file: "f", imported: r.forbidden[0]! })) });
    expect(await ctx.stack.mutation()).toEqual({ score: 100, files: [] });
    expect((await ctx.stack.architecture([{ module: "Domain", forbidden: ["UI"] }]))?.violations).toEqual([{ module: "Domain", file: "f", imported: "UI" }]);
  });

  it("désactivation : capacités retirées du registre", async () => {
    const { deps, handle } = await activateWith((ctx) => void ctx.chat.registerCommand("demo", async () => {}));
    await handle.deactivate();
    expect(deps.registry.command("demo")).toBeUndefined();
    expect(deps.hooks.guards()).toEqual([]);
  });
});
