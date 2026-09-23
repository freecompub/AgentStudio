import { afterEach, describe, expect, it, vi } from "vitest";
import { composeGuards } from "../src/guards/compose-guards.js";
import type { ToolCallGuard } from "../src/protocols/agent-runtime.js";

const req = { kind: "write" as const, toolName: "edit", path: "tests/a.ts" };
const allow: ToolCallGuard = { check: async () => ({ decision: "allow" }) };
const deny = (reason: string): ToolCallGuard => ({ check: async () => ({ decision: "deny", reason }) });

describe("composeGuards (D28)", () => {
  afterEach(() => vi.useRealTimers());

  it("toutes autorisent : autorisé", async () => {
    expect(await composeGuards([allow, allow]).check(req)).toEqual({ decision: "allow" });
  });

  it("le premier refus l'emporte et les gardes suivantes ne sont pas consultées", async () => {
    const later = vi.fn(async () => ({ decision: "allow" as const }));
    expect(await composeGuards([allow, deny("gelé"), { check: later }]).check(req)).toEqual({ decision: "deny", reason: "gelé" });
    expect(later).not.toHaveBeenCalled();
  });

  it("une garde qui plante vaut refus", async () => {
    const boom: ToolCallGuard = { check: async () => Promise.reject(new Error("boum")) };
    expect(await composeGuards([boom, allow]).check(req)).toMatchObject({ decision: "deny", reason: expect.stringMatching(/indisponible/) });
  });

  it("une garde qui dépasse son délai vaut refus", async () => {
    vi.useFakeTimers();
    const slow: ToolCallGuard = { check: () => new Promise(() => {}) };
    const p = composeGuards([slow], { timeoutMs: 100 }).check(req);
    await vi.advanceTimersByTimeAsync(100);
    expect(await p).toMatchObject({ decision: "deny" });
  });

  it("liste vide : autorisé", async () => {
    expect(await composeGuards([]).check(req)).toEqual({ decision: "allow" });
  });
});
