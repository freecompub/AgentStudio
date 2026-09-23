import { fixedClock, MemoryEvidenceStore, MemoryInteractionStore, ScriptedRuntime, sequentialIds } from "@agent-studio/core/testing";
import { manifest as tddManifest, tddExtension } from "@agent-studio/ext-tdd";
import { MemoryTaskStore } from "@agent-studio/task-engine";
import type { Workspace } from "@agent-studio/workspace";
import { mkdtemp } from "node:fs/promises";
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
    files: { read: async () => "", write: async () => {}, list: async () => [] },
    checkpoints: {
      create: async (label) => ({ id: `cp-${++n}`, sha: "s", head: "h", label, createdAt: "" }),
      list: async () => [],
      diff: async () => ({ files: [], patch: "" }),
      rollback: async () => {},
    },
    repo: { head: async () => "h", commit: async () => null, sync: async () => ({ pulled: 0, pushed: 0 }) },
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
    stacks: [{ id: "typescript", detect: async () => true, isTestFile: (p) => p.startsWith("tests/"), testFilePattern: "^tests/", runTests: async () => ({ results: [], exitCode: 0, timedOut: false, output: "", durationMs: 0 }) }],
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
