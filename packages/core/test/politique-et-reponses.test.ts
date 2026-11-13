import { describe, expect, it } from "vitest";
import { createInteractionService } from "../src/interactions/interaction-service.js";
import { createMemoryPermissionRules, createPermissionArbiter } from "../src/guards/permission-arbiter.js";
import type { InteractionRequest } from "../src/protocols/interactions.js";
import { fixedClock, MemoryInteractionStore, sequentialIds } from "../src/testing/memory-doubles.js";

/** Plus de profil (ADR 0087) : la politique de permissions est un réglage, et personne n'est exclu d'une réponse. */
describe("politique de permissions dans l'arbitre", () => {
  const arbiter = (policy: "prudente" | "souple") => {
    const asked: string[] = [];
    const guard = createPermissionArbiter({
      root: "/projets/demo",
      confirmer: { confirm: async (q) => (asked.push(q.detail), "allow-once") },
      rules: createMemoryPermissionRules(),
      extensionGuards: () => [],
      permissionPolicy: policy,
    });
    return { guard, asked };
  };

  it("souple : lancer les tests est autorisé sans question ; le reste est demandé", async () => {
    const { guard, asked } = arbiter("souple");
    for (const command of ["npm test", "pnpm test", "pnpm vitest run", "dotnet test", "npx vitest run --reporter=json"])
      expect(await guard.check({ kind: "shell", toolName: "bash", command })).toEqual({ decision: "allow" });
    expect(asked).toEqual([]);
    await guard.check({ kind: "shell", toolName: "bash", command: "npm install left-pad" });
    await guard.check({ kind: "shell", toolName: "bash", command: "npm test && rm -rf /" });
    expect(asked).toHaveLength(2);
  });

  it("prudente : même les tests sont demandés", async () => {
    const { guard, asked } = arbiter("prudente");
    await guard.check({ kind: "shell", toolName: "bash", command: "npm test" });
    expect(asked).toHaveLength(1);
  });
});

describe("qui peut répondre à une demande (ADR 0087)", () => {
  function service(store = new MemoryInteractionStore()) {
    const delivered: string[] = [];
    const s = createInteractionService({ store, clock: fixedClock(), ids: sequentialIds("i"), deliver: async (_t, option) => void delivered.push(option) });
    return { s, delivered };
  }

  it("toute demande reçoit la réponse de quiconque", async () => {
    const { s, delivered } = service();
    const id = await s.request({ taskId: "t", extensionId: "x", title: "Ratifier ADR-008", options: [{ id: "accept", label: "Accepter" }] });
    await s.respond(id, "accept");
    expect(delivered).toEqual(["accept"]);
  });

  it("une demande enregistrée avant, encore réservée à un profil, reçoit elle aussi la réponse de quiconque", async () => {
    const store = new MemoryInteractionStore();
    const ancienne = { id: "i-old", kind: "decision", status: "pending", createdAt: "2026-11-01T00:00:00.000Z", taskId: "t", extensionId: "x", title: "Ratifier ADR-008", options: [{ id: "accept", label: "Accepter" }], requiredRoles: ["architecte"] };
    await store.save(ancienne as unknown as InteractionRequest);
    const { s, delivered } = service(store);
    await s.respond("i-old", "accept");
    expect(delivered).toEqual(["accept"]);
  });
});
