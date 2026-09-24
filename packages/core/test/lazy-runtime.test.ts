import { describe, expect, it } from "vitest";
import { createLazyRuntime } from "../src/agents/lazy-runtime.js";
import { ScriptedRuntime } from "../src/testing/scripted-runtime.js";

const cfg = { role: "r", workingDirectory: "/p", systemPrompt: "", tools: [], guard: { check: async () => ({ decision: "allow" as const }) } };

describe("Runtime paresseux", () => {
  it("n'obtient le runtime qu'au premier besoin, une seule fois, même en concurrence", async () => {
    const real = new ScriptedRuntime();
    let loads = 0;
    const lazy = createLazyRuntime(async () => (loads++, real));
    expect(loads).toBe(0);
    await Promise.all([lazy.openSession(cfg), lazy.openSession(cfg)]);
    await lazy.deleteSession("fake-1");
    expect(loads).toBe(1);
    expect(real.deleted).toEqual(["fake-1"]);
  });

  it("un échec de chargement est propagé puis retenté à l'appel suivant", async () => {
    let fail = true;
    const lazy = createLazyRuntime(async () => {
      if (fail) throw new Error("non connecté");
      return new ScriptedRuntime();
    });
    await expect(lazy.openSession(cfg)).rejects.toThrow(/non connecté/);
    fail = false;
    await expect(lazy.openSession(cfg)).resolves.toBeDefined();
  });
});
