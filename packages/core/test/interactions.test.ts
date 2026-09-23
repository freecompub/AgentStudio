import { describe, expect, it } from "vitest";
import { createInteractionService } from "../src/interactions/interaction-service.js";
import { MemoryInteractionStore } from "../src/testing/memory-doubles.js";
import { fixedClock, sequentialIds } from "../src/testing/memory-doubles.js";

function setup(store = new MemoryInteractionStore()) {
  const delivered: { taskId: string; option: string; comment?: string }[] = [];
  const changes: number[] = [];
  const service = createInteractionService({
    store,
    clock: fixedClock(),
    ids: sequentialIds("int-"),
    deliver: async (taskId, option, comment) => void delivered.push({ taskId, option, ...(comment ? { comment } : {}) }),
  });
  service.onChange((pending) => changes.push(pending.length));
  return { service, delivered, store, changes };
}

const REQ = {
  taskId: "t1",
  extensionId: "diabeo.tdd",
  title: "Valider le plan",
  options: [
    { id: "approve", label: "Valider" },
    { id: "reject", label: "Refuser" },
  ],
};

describe("Demandes d'interaction", () => {
  it("crée une demande en attente, persistée, et notifie", async () => {
    const { service, store, changes } = setup();
    const id = await service.request(REQ);
    expect(id).toBe("int-1");
    expect((await store.list())[0]).toMatchObject({ id: "int-1", status: "pending", kind: "decision", createdAt: "2026-09-23T10:00:00.000Z" });
    expect(await service.pending()).toHaveLength(1);
    expect(changes).toEqual([1]);
  });

  it("une réponse valide est livrée à la tâche et clôt la demande", async () => {
    const { service, delivered } = setup();
    const id = await service.request(REQ);
    await service.respond(id, "reject", "trop gros");
    expect(delivered).toEqual([{ taskId: "t1", option: "reject", comment: "trop gros" }]);
    expect(await service.pending()).toEqual([]);
  });

  it("refuse une option non proposée, une demande inconnue ou déjà traitée", async () => {
    const { service } = setup();
    const id = await service.request(REQ);
    await expect(service.respond(id, "supprimer-tout")).rejects.toThrow(/Option non autorisée/);
    await expect(service.respond("int-99", "approve")).rejects.toThrow(/introuvable/);
    await service.respond(id, "approve");
    await expect(service.respond(id, "approve")).rejects.toThrow(/déjà été traitée/);
  });

  it("annule les demandes d'une tâche (tâche terminée ou annulée)", async () => {
    const { service } = setup();
    await service.request(REQ);
    await service.request({ ...REQ, taskId: "t2" });
    await service.cancelForTask("t1");
    expect((await service.pending()).map((r) => r.taskId)).toEqual(["t2"]);
  });

  it("survit au redémarrage : une nouvelle instance relit les demandes en attente", async () => {
    const store = new MemoryInteractionStore();
    const first = setup(store);
    const id = await first.service.request(REQ);
    const second = setup(store);
    expect((await second.service.pending()).map((r) => r.id)).toEqual([id]);
    await second.service.respond(id, "approve");
    expect(second.delivered).toHaveLength(1);
  });

  it("si la livraison échoue, la demande reste en attente", async () => {
    const store = new MemoryInteractionStore();
    const service = createInteractionService({
      store,
      clock: fixedClock(),
      ids: sequentialIds("int-"),
      deliver: async () => Promise.reject(new Error("tâche terminée")),
    });
    const id = await service.request(REQ);
    await expect(service.respond(id, "approve")).rejects.toThrow(/tâche terminée/);
    expect(await service.pending()).toHaveLength(1);
  });
});
