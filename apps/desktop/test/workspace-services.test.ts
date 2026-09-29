import { fixedClock, MemoryEvidenceStore, MemoryInteractionStore, ScriptedRuntime, sequentialIds } from "@agent-studio/core/testing";
import { manifest as tddManifest, tddExtension } from "@agent-studio/ext-tdd";
import { MemoryTaskStore } from "@agent-studio/task-engine";
import type { Workspace } from "@agent-studio/workspace";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUsageRecorder } from "@agent-studio/core";
import { describe, expect, it } from "vitest";
import type { InteractionDto, TaskCardDto } from "../src/shared/ipc-contract.js";
import { workspaceServicesFactory } from "../src/main/workspace-services.js";

function fakeWorkspace(): Workspace {
  let n = 0;
  return {
    root: "/projets/demo",
    files: { read: async () => "", write: async () => {}, ensureDir: async () => {}, list: async () => [] },
    checkpoints: {
      create: async (label) => ({ id: `cp-${++n}`, sha: "s", head: "h", label, createdAt: "" }),
      list: async () => [],
      diff: async () => ({ files: [], patch: "" }),
      rollback: async () => {},
    },
    repo: {
      // Ce double ne sait pas ouvrir de copie isolée : échouer vaut mieux que rendre une racine vide.
      worktree: async () => { throw new Error("copie isolée non fournie par ce double"); },
      head: async () => "h", commit: async () => null, sync: async () => ({ pulled: 0, pushed: 0 }), switchBranch: async () => {} },
  };
}

async function setup(store = new MemoryTaskStore(), runtime = new ScriptedRuntime(), interactionStore = new MemoryInteractionStore()) {
  const usageRecorder = createUsageRecorder(await mkdtemp(join(tmpdir(), "agent-studio-usage-")));
  runtime.behave("diabeo.tdd/tdd-planner", async (t) => {
    t.session.emit({ type: "usage", model: "gpt-5", inputTokens: 1200, outputTokens: 80, multiplier: 1 });
    await t.callTool("submit_plan", { steps: [{ id: "s1", behavior: "plafonne la dose" }] });
  });
  let runtimeLoads = 0;
  const cards: TaskCardDto[] = [];
  const pending: InteractionDto[][] = [];
  const posts: string[] = [];
  const notifications: string[] = [];
  const services = await workspaceServicesFactory({
    extensions: [{ kind: "in-process", manifest: tddManifest, module: tddExtension }],
    stacks: [{ id: "typescript", layout: { acceptanceTests: ["tests/acceptance/**"], unitTests: ["tests/**"], sources: ["src/**"] }, infrastructureModules: ["Infrastructure"],  detect: async () => true, isTestFile: (p) => p.startsWith("tests/"), testFilePattern: "^tests/", runTests: async () => ({ results: [], exitCode: 0, timedOut: false, output: "", durationMs: 0 }) }],
    tasksDir: "/inutile",
    taskStore: store,
    evidenceStore: new MemoryEvidenceStore(),
    interactionStore,
    usageRecorder,
    clock: fixedClock(),
    ids: sequentialIds("id-"),
  })({
    workspace: fakeWorkspace(),
    runtime: async () => (runtimeLoads++, runtime),
    onTask: (c) => cards.push(c),
    onInteractions: (p) => pending.push(p),
    onPost: (ext, md) => posts.push(`${ext}: ${md}`),
    notify: (title, body) => notifications.push(`${title} | ${body}`),
  });
  return { services, cards, pending, posts, notifications, getLoads: () => runtimeLoads, store };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
};

describe("Services d'un projet (J2)", () => {
  async function ouvrir(opts: { profil?: string; allowedPrograms?: string[]; confirmer?: "allow-once" | "deny"; fichiers?: string[] }) {
    const racine = await mkdtemp(join(tmpdir(), "agent-studio-profil-projet-"));
    const cleanup = () => rm(racine, { recursive: true, force: true });
    if (opts.profil !== undefined) {
      await mkdir(join(racine, ".agent-studio"), { recursive: true });
      await writeFile(join(racine, ".agent-studio", "stack.yaml"), opts.profil);
    }
    const posts: string[] = [];
    const ecrits: string[] = [];
    const services = await workspaceServicesFactory({
      extensions: [],
      stacks: [
        {
          id: "typescript",
          layout: { acceptanceTests: [], unitTests: ["tests/**"], sources: ["src/**"] },
          infrastructureModules: ["Infrastructure"],
          detect: async () => true,
          isTestFile: () => false,
          testFilePattern: "^tests/",
          runTests: async () => ({ results: [], exitCode: 0, timedOut: false, output: "", durationMs: 0 }),
        },
      ],
      ...(opts.allowedPrograms ? { allowedPrograms: opts.allowedPrograms } : {}),
      tasksDir: "/inutile",
      taskStore: new MemoryTaskStore(),
      evidenceStore: new MemoryEvidenceStore(),
      interactionStore: new MemoryInteractionStore(),
      clock: fixedClock(),
      ids: sequentialIds("id-"),
    })({
      workspace: {
        ...fakeWorkspace(),
        root: racine,
        files: { ...fakeWorkspace().files, list: async () => opts.fichiers ?? [], write: async (rel, c) => void ecrits.push(`${rel}\n${c}`) },
      },
      runtime: async () => new ScriptedRuntime(),
      onTask: () => {},
      onInteractions: () => {},
      onPost: (_e, md) => posts.push(md),
      ...(opts.confirmer ? { confirmer: { confirm: async () => opts.confirmer! } } : {}),
    });
    return { services, posts, ecrits, racine, cleanup };
  }

  const PROFIL_VALIDE = `
id: python
detect: [pyproject.toml]
tests:
  command: [pytest, "--junit-xml={rapport}"]
  report: junit-xml
layout:
  unitTests: ["tests/**"]
  sources: ["src/**"]
infrastructureModules: [django]
`;

  it("un profil déclaré par le projet l'emporte sur la détection", async () => {
    const { services, posts, cleanup } = await ouvrir({ profil: PROFIL_VALIDE, allowedPrograms: ["pytest"] });
    try {
      // La stack est celle du profil, pas l'adaptateur TypeScript qui prétendait reconnaître.
      expect(posts.join("\n")).toMatch(/profil/i);
      expect(posts.join("\n")).toMatch(/python/);
    } finally {
      await services.dispose();
      await cleanup();
    }
  });

  it("un profil refusé est expliqué dans la conversation, et la détection reprend la main", async () => {
    // Le champ et la valeur fautive doivent être nommés : l'auteur du profil doit savoir quoi corriger.
    const { services, posts, cleanup } = await ouvrir({ profil: PROFIL_VALIDE.replace("pytest", "curl"), allowedPrograms: ["pytest"] });
    try {
      expect(posts.join("\n")).toMatch(/curl/);
      expect(posts.join("\n")).toMatch(/refus/i);
    } finally {
      await services.dispose();
      await cleanup();
    }
  });

  it("la commande /stack est routable dès qu'un projet est ouvert, sans aucune extension", async () => {
    // Elle appartient au cœur : elle décrit le projet, pas le travail d'une extension.
    const { services, posts, cleanup } = await ouvrir({ confirmer: "deny" });
    expect(services.commands().map((c) => c.invocation)).toContain("stack");
    expect(await services.route("/stack")).toEqual({ kind: "handled" });
    expect(posts.at(-1)).toMatch(/typescript/);
    await cleanup();
  });

  it("/stack doctor décrit le profil déclaré, et dit ce qu'il n'a pas vérifié", async () => {
    const { services, posts, cleanup } = await ouvrir({ profil: PROFIL_VALIDE, allowedPrograms: ["pytest"], confirmer: "deny" });
    await services.route("/stack doctor");
    expect(posts.at(-1)).toMatch(/Diagnostic du profil/);
    expect(posts.at(-1)).toMatch(/canari/i);
    await cleanup();
  });

  it("/stack init propose un profil puis n'écrit rien quand l'utilisateur refuse", async () => {
    const { services, posts, ecrits, cleanup } = await ouvrir({ confirmer: "deny", fichiers: ["pyproject.toml", "tests/test_a.py"] });
    await services.route("/stack init");
    expect(posts.at(-2)).toMatch(/```yaml/);
    expect(posts.at(-1)).toMatch(/rien n'a été écrit/i);
    expect(ecrits).toEqual([]);
    await cleanup();
  });

  it("/stack init écrit le profil après accord, à l'emplacement versionné", async () => {
    const { services, ecrits, cleanup } = await ouvrir({ confirmer: "allow-once", fichiers: ["pyproject.toml"] });
    await services.route("/stack init");
    expect(ecrits).toHaveLength(1);
    expect(ecrits[0]).toMatch(/^\.agent-studio\/stack\.yaml\n/);
    expect(ecrits[0]).toMatch(/id: python/);
    await cleanup();
  });

  it("sans confirmateur, /stack n'est pas enregistrée : mieux vaut pas de commande qu'une écriture sans accord", async () => {
    const { services, cleanup } = await ouvrir({});
    expect(services.commands().map((c) => c.invocation)).not.toContain("stack");
    await cleanup();
  });

  it("sans profil, rien n'est dit et la détection s'applique", async () => {
    const { services, posts, cleanup } = await ouvrir({});
    try {
      expect(posts.join("\n")).not.toMatch(/profil/i);
    } finally {
      await services.dispose();
      await cleanup();
    }
  });

  it("stack non reconnue : l'utilisateur en est averti dans la conversation, pas seulement dans le journal", async () => {
    // Le repli change ce que font les portes et les commandes : le taire laisserait
    // l'utilisateur devant des résultats inexplicables.
    const posts: string[] = [];
    await workspaceServicesFactory({
      extensions: [],
      stacks: [
        {
          id: "typescript",
          layout: { acceptanceTests: [], unitTests: [], sources: [] },
          infrastructureModules: [],
          detect: async () => false, // aucun adaptateur ne reconnaît ce projet
          isTestFile: () => false,
          testFilePattern: "^tests/",
          runTests: async () => ({ results: [], exitCode: 0, timedOut: false, output: "", durationMs: 0 }),
        },
      ],
      tasksDir: "/inutile",
      taskStore: new MemoryTaskStore(),
      evidenceStore: new MemoryEvidenceStore(),
      interactionStore: new MemoryInteractionStore(),
      clock: fixedClock(),
      ids: sequentialIds("id-"),
    })({
      workspace: fakeWorkspace(),
      runtime: async () => new ScriptedRuntime(),
      onTask: () => {},
      onInteractions: () => {},
      onPost: (ext, md) => posts.push(`${ext}: ${md}`),
    });
    expect(posts.join("\n")).toMatch(/reconnu par aucun adaptateur/i);
  });

  it("expose la commande /tdd de l'extension ; le texte libre part vers la session principale", async () => {
    const { services, getLoads } = await setup();
    expect(services.commands().map((c) => c.invocation)).toEqual(["tdd"]);
    expect(await services.route("Bonjour")).toEqual({ kind: "chat" });
    expect(await services.route("/inconnue")).toEqual({ kind: "unknown-command", name: "inconnue" });
    expect(getLoads()).toBe(0); // aucun runtime tant qu'aucun agent n'est lancé
  });

  it("/tdd : tâche lancée, carte avec libellés du manifeste, plan soumis en demande d'interaction", async () => {
    const { services, cards, pending, posts } = await setup();
    expect(await services.route("/tdd Plafonner la dose")).toEqual({ kind: "handled" });
    expect(posts[0]).toMatch(/^diabeo\.tdd: Cycle TDD lancé/);

    await until(() => pending.some((p) => p.length === 1));
    const [review] = await services.pendingInteractions();
    expect(review).toMatchObject({ extensionId: "diabeo.tdd", title: "Valider le plan TDD : Plafonner la dose", detail: "1. plafonne la dose" });
    expect(review?.options.map((o) => o.id)).toEqual(["approve", "reject"]);

    await until(() => cards.at(-1)?.status === "waiting"); // carte limitée à deux rafraîchissements par seconde
    const card = cards.at(-1)!;
    expect(card).toMatchObject({ title: "Cycle TDD : Plafonner la dose", phase: "PLAN_REVIEW", phaseLabel: "Plan à valider", status: "waiting", alert: false });
    expect(card.step).toEqual({ index: 1, total: 1, behavior: "plafonne la dose" });
    expect(await services.tasks()).toHaveLength(1);
  });

  it("usage par état sur la carte : requêtes et tokens du planificateur, libellé du manifeste (D37)", async () => {
    const { services, cards, pending } = await setup();
    await services.route("/tdd Plafonner la dose");
    await until(() => pending.some((p) => p.length === 1));
    await until(() => cards.at(-1)?.usage?.rows.some((r) => r.phase === "PLANNING" && r.requests === 1) ?? false);
    const usage = cards.at(-1)!.usage!;
    expect(usage.unit).toBe("requests");
    expect(usage.rows.find((r) => r.phase === "PLANNING")).toMatchObject({ label: "Découpage en comportements", requests: 1, inputTokens: 1200, outputTokens: 80 });
    expect(usage.total.requests).toBe(1);
  });

  it("la réponse relance la tâche ; l'annulation clôt la tâche et ses demandes", async () => {
    const { services, pending, cards } = await setup();
    await services.route("/tdd Plafonner la dose");
    await until(() => pending.some((p) => p.length === 1));
    const [review] = await services.pendingInteractions();
    await services.respond(review!.id, "reject", "trop large");
    await until(() => pending.filter((p) => p.length === 1).length === 2); // nouveau plan soumis
    const [second] = await services.pendingInteractions();

    await services.cancelTask(second!.taskId);
    await until(() => cards.at(-1)?.phase === "ABORTED");
    expect(cards.at(-1)).toMatchObject({ status: "finished", phaseLabel: "Annulé", alert: true });
    await until(() => pending.at(-1)?.length === 0);
  });

  it("redémarrage : la tâche en attente et sa demande de décision sont toujours là (J3)", async () => {
    const store = new MemoryTaskStore();
    const interactionStore = new MemoryInteractionStore();
    const first = await setup(store, new ScriptedRuntime(), interactionStore);
    await first.services.route("/tdd Plafonner la dose");
    await until(() => first.pending.some((p) => p.length === 1));
    await first.services.dispose();

    const second = await setup(store, new ScriptedRuntime(), interactionStore);
    const tasks = await second.services.tasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ phase: "PLAN_REVIEW", status: "waiting" });
    const [review] = await second.services.pendingInteractions();
    expect(review?.taskId).toBe(tasks[0]?.id);
  });

  it("jalons et alertes : consignés dans la conversation et notifiés", async () => {
    const { services, pending, posts, notifications } = await setup();
    await services.route("/tdd Plafonner la dose");
    await until(() => pending.some((p) => p.length === 1));
    const [review] = await services.pendingInteractions();
    await services.cancelTask(review!.taskId);
    await until(() => posts.some((p) => p.includes("Annulé")));
    expect(posts.at(-1)).toBe("diabeo.tdd: Cycle TDD : Plafonner la dose : Annulé (étape 1 sur 1 : plafonne la dose)");
    expect(notifications.at(-1)).toMatch(/^Tâche à surveiller \| Cycle TDD/);
  });
});
