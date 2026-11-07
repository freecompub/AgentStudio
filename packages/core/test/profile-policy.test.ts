import { describe, expect, it } from "vitest";
import { createInteractionService } from "../src/interactions/interaction-service.js";
import { createMemoryPermissionRules, createPermissionArbiter } from "../src/guards/permission-arbiter.js";
import { profileFor } from "../src/protocols/profile.js";
import { fixedClock, MemoryInteractionStore, sequentialIds } from "../src/testing/memory-doubles.js";

describe("Profils (D6, §10.3)", () => {
  it("valeurs par défaut : non-développeurs en mode simple et politique prudente", () => {
    expect(profileFor("po")).toEqual({ role: "po", defaultMode: "simple", permissionPolicy: "prudente" });
    expect(profileFor("testeur").defaultMode).toBe("simple");
    expect(profileFor("developpeur")).toEqual({ role: "developpeur", defaultMode: "advanced", permissionPolicy: "souple" });
    expect(profileFor("po", { defaultMode: "advanced" }).defaultMode).toBe("advanced");
  });

  describe("politique de permissions dans l'arbitre", () => {
    const arbiter = (policy: "prudente" | "souple") => {
      const asked: string[] = [];
      const guard = createPermissionArbiter({
        root: "/projets/demo",
        confirmer: { confirm: async (q) => (asked.push(q.detail), "allow-once") },
        rules: createMemoryPermissionRules(),
        extensionGuards: () => [],
        profilePolicy: policy,
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

  describe("qui peut répondre à quelle demande", () => {
    function service() {
      const delivered: string[] = [];
      const s = createInteractionService({
        store: new MemoryInteractionStore(),
        clock: fixedClock(),
        ids: sequentialIds("i"),
        deliver: async (_t, option) => void delivered.push(option),
      });
      return { s, delivered };
    }

    it("une demande réservée à un rôle est refusée aux autres profils", async () => {
      const { s, delivered } = service();
      const id = await s.request({ taskId: "t", extensionId: "x", title: "Ratifier ADR-008", options: [{ id: "accept", label: "Accepter" }], requiredRoles: ["architecte"] });
      await expect(s.respond(id, "accept", undefined, { role: "po" })).rejects.toThrow(/Architecte/);
      await s.respond(id, "accept", undefined, { role: "architecte" });
      expect(delivered).toEqual(["accept"]);
    });

    it("sans rôle requis, tout profil peut répondre", async () => {
      const { s } = service();
      const id = await s.request({ taskId: "t", extensionId: "x", title: "Valider le plan", options: [{ id: "ok", label: "OK" }] });
      await s.respond(id, "ok", undefined, { role: "testeur" });
      expect(await s.pending()).toEqual([]);
    });
  });
});
