import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHeartbeat, runTurn, TurnTimeoutError, EnvFailureError } from "../src/turns/run-turn.js";
import { ScriptedSession } from "../src/testing/scripted-session.js";

describe("runTurn — watchdog d'inactivité (D30)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("se termine à l'événement idle", async () => {
    const s = new ScriptedSession("s1");
    const turn = runTurn(s, "bonjour", { idleMs: 1_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.sent).toEqual(["bonjour"]);
    s.emit({ type: "idle" });
    await expect(turn).resolves.toBeUndefined();
  });

  it("chaque événement réarme le chronomètre : un agent actif n'est jamais coupé", async () => {
    const s = new ScriptedSession("s1");
    const turn = runTurn(s, "long", { idleMs: 1_000 });
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(900);
      s.emit({ type: "activity" });
    }
    s.emit({ type: "idle" });
    await expect(turn).resolves.toBeUndefined();
    expect(s.aborted).toBe(false);
  });

  it("un silence au-delà du seuil interrompt la session et lève TurnTimeoutError", async () => {
    const s = new ScriptedSession("s1");
    const turn = runTurn(s, "muet", { idleMs: 1_000 });
    const caught = turn.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await caught).toBeInstanceOf(TurnTimeoutError);
    expect(s.aborted).toBe(true);
  });

  it("un événement error devient EnvFailureError", async () => {
    const s = new ScriptedSession("s1");
    const turn = runTurn(s, "x", { idleMs: 1_000 });
    s.emit({ type: "error", message: "quota épuisé" });
    await expect(turn).rejects.toThrow(EnvFailureError);
    await expect(turn).rejects.toThrow(/quota épuisé/);
  });

  it("un échec de send() est propagé", async () => {
    const s = new ScriptedSession("s1");
    s.failNextSend(new Error("runtime injoignable"));
    await expect(runTurn(s, "x", { idleMs: 1_000 })).rejects.toThrow(/runtime injoignable/);
  });

  it("se désabonne à la fin du tour", async () => {
    const s = new ScriptedSession("s1");
    const turn = runTurn(s, "x", { idleMs: 1_000 });
    s.emit({ type: "idle" });
    await turn;
    expect(s.listenerCount).toBe(0);
  });

  it("transmet les événements au rappel onEvent", async () => {
    const s = new ScriptedSession("s1");
    const seen: string[] = [];
    const turn = runTurn(s, "x", { idleMs: 1_000, onEvent: (e) => seen.push(e.type) });
    s.emit({ type: "message", text: "salut" });
    s.emit({ type: "idle" });
    await turn;
    expect(seen).toEqual(["message", "idle"]);
  });

  it("un battement externe (outil long qui produit de la sortie) réarme aussi le chronomètre", async () => {
    const s = new ScriptedSession("s1");
    const hb = createHeartbeat();
    const turn = runTurn(s, "tests longs", { idleMs: 1_000, heartbeat: hb });
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(900);
      hb.beat();
    }
    s.emit({ type: "idle" });
    await expect(turn).resolves.toBeUndefined();
    expect(s.aborted).toBe(false);
  });
});
