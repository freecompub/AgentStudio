import { fixedClock, MemoryEvidenceStore, ScriptedRuntime, sequentialIds } from "@agent-studio/core/testing";
import { manifest as tddManifest, tddExtension } from "@agent-studio/ext-tdd";
import { MemoryTaskStore } from "@agent-studio/task-engine";
import type { Workspace } from "@agent-studio/workspace";
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

async function setup(store = new MemoryTaskStore(), runtime = new ScriptedRuntime()) {
  runtime.behave("diabeo.tdd/tdd-planner", async (t) => {
    await t.callTool("submit_plan", { steps: [{ id: "s1", behavior: "plafonne la dose" }] });
  });
  let runtimeLoads = 0;
  const cards: TaskCardDto[] = [];
  const pending: InteractionDto[][] = [];
  const posts: string[] = [];
  const services = await workspaceServicesFactory({
    extensions: [{ manifest: tddManifest, module: tddExtension }],
    stack: { id: "typescript", detect: async () => true, isTestFile: (p) => p.startsWith("tests/"), runTests: async () => ({ results: [], exitCode: 0, timedOut: false, output: "", durationMs: 0 }) },
    tasksDir: "/inutile",
    taskStore: store,
    evidenceStore: new MemoryEvidenceStore(),
    clock: fixedClock(),
    ids: sequentialIds("id-"),
  })({
    workspace: fakeWorkspace(),
    runtime: async () => (runtimeLoads++, runtime),
    onTask: (c) => cards.push(c),
    onInteractions: (p) => pending.push(p),
    onPost: (ext, md) => posts.push(`${ext}: ${md}`),
  });
  return { services, cards, pending, posts, getLoads: () => runtimeLoads, store };
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

    const card = cards.at(-1)!;
    expect(card).toMatchObject({ title: "Cycle TDD : Plafonner la dose", phase: "PLAN_REVIEW", phaseLabel: "Plan à valider", status: "waiting", alert: false });
    expect(card.step).toEqual({ index: 1, total: 1, behavior: "plafonne la dose" });
    expect(await services.tasks()).toHaveLength(1);
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

  it("reprend les tâches persistées à la création des services (redémarrage)", async () => {
    const store = new MemoryTaskStore();
    const first = await setup(store);
    await first.services.route("/tdd Plafonner la dose");
    await until(() => first.pending.some((p) => p.length === 1));
    await first.services.dispose();

    const second = await setup(store);
    const tasks = await second.services.tasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ phase: "PLAN_REVIEW", status: "waiting" });
  });
});
