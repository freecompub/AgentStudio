import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHeartbeat, runTurn, TurnBudgetError, TurnCostError, TurnTimeoutError, EnvFailureError } from "../src/turns/run-turn.js";
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

describe("runTurn — plafond de durée du tour (ADR 0026)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("un agent qui parle sans fin est coupé au plafond, là où le chronomètre d'inactivité ne l'aurait jamais vu", async () => {
    // Le 28/09, un tour de skraft-architect-model a duré 1 h 55 : l'agent émettait sans cesse,
    // donc le chronomètre d'inactivité était réarmé à chaque fois et n'a fini par se déclencher
    // qu'une fois l'agent réellement muet. Rien ne bornait la durée totale.
    const s = new ScriptedSession("s1");
    const turn = runTurn(s, "boucle", { idleMs: 1_000, maxMs: 10_000 });
    const caught = turn.catch((e: unknown) => e);
    for (let i = 0; i < 30; i++) {
      await vi.advanceTimersByTimeAsync(900);
      s.emit({ type: "activity" });
    }
    const err = await caught;
    expect(err).toBeInstanceOf(TurnBudgetError);
    expect(s.aborted).toBe(true);
  });

  it("le plafond n'est réarmé ni par un événement ni par un battement : c'est un plafond, pas un chronomètre", async () => {
    const s = new ScriptedSession("s1");
    const beat = createHeartbeat();
    const turn = runTurn(s, "x", { idleMs: 1_000, maxMs: 5_000, heartbeat: beat });
    const caught = turn.catch((e: unknown) => e);
    for (let i = 0; i < 9; i++) {
      await vi.advanceTimersByTimeAsync(600);
      s.emit({ type: "activity" });
      beat.beat();
    }
    expect(await caught).toBeInstanceOf(TurnBudgetError);
  });

  it("distingue le plafond du silence : l'humain doit savoir lequel des deux s'est produit", async () => {
    const s = new ScriptedSession("s1");
    const turn = runTurn(s, "x", { idleMs: 1_000, maxMs: 4_000 });
    const caught = turn.catch((e: unknown) => e);
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(500);
      s.emit({ type: "activity" });
    }
    const err = await caught;
    expect(err).not.toBeInstanceOf(TurnTimeoutError);
    expect(String((err as Error).message)).toMatch(/plafond|budget/i);
    expect(String((err as Error).message)).not.toMatch(/inactivit|aucune activité/i);
  });

  it("un tour qui finit avant le plafond n'est pas coupé", async () => {
    const s = new ScriptedSession("s1");
    const turn = runTurn(s, "x", { idleMs: 1_000, maxMs: 10_000 });
    await vi.advanceTimersByTimeAsync(900);
    s.emit({ type: "idle" });
    await expect(turn).resolves.toBeUndefined();
    expect(s.aborted).toBe(false);
  });

  it("le plafond n'écourte jamais le chronomètre d'inactivité : un silence reste un silence", async () => {
    const s = new ScriptedSession("s1");
    const turn = runTurn(s, "muet", { idleMs: 1_000, maxMs: 60_000 });
    const caught = turn.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await caught).toBeInstanceOf(TurnTimeoutError);
  });

  it("le plafond par défaut existe : aucun tour n'est illimité, même sans option", async () => {
    const s = new ScriptedSession("s1");
    const turn = runTurn(s, "boucle", { idleMs: 1_000 });
    const caught = turn.catch((e: unknown) => e);
    // Une demi-heure d'agent bavard, par pas plus courts que le seuil d'inactivité.
    for (let i = 0; i < 4000; i++) {
      await vi.advanceTimersByTimeAsync(900);
      s.emit({ type: "activity" });
    }
    expect(await caught).toBeInstanceOf(TurnBudgetError);
  });

  it("se désabonne quand le plafond coupe", async () => {
    const s = new ScriptedSession("s1");
    const turn = runTurn(s, "x", { idleMs: 1_000, maxMs: 2_000 });
    const caught = turn.catch((e: unknown) => e);
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(500);
      s.emit({ type: "activity" });
    }
    await caught;
    expect(s.listenerCount).toBe(0);
  });
});

describe("runTurn — plafond de coût du tour (ADR 0027)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Un appel au modèle : le contexte entier est renvoyé, donc facturé, à chaque fois. */
  const appel = (s: ScriptedSession, inputTokens: number) => s.emit({ type: "usage", inputTokens, outputTokens: 500 });

  it("coupe le tour quand le cumul des tokens d'entrée dépasse le plafond", async () => {
    // DESIGN du 28/09 : 4 230 824 tokens d'entrée cumulés. Chaque appel renvoie tout le contexte,
    // donc un tour de N appels coûte en O(N²). Rien ne bornait N.
    const s = new ScriptedSession("s1");
    const turn = runTurn(s, "boucle", { idleMs: 60_000, maxInputTokens: 100_000 });
    const caught = turn.catch((e: unknown) => e);
    for (let i = 0; i < 12; i++) {
      appel(s, 10_000);
      await vi.advanceTimersByTimeAsync(10);
    }
    const err = await caught;
    expect(err).toBeInstanceOf(TurnCostError);
    expect((err as TurnCostError).inputTokens).toBeGreaterThanOrEqual(100_000);
    expect(s.aborted).toBe(true);
  });

  it("le cumul ne décroît jamais : c'est ce qui a été payé, pas ce qui est en mémoire", async () => {
    const s = new ScriptedSession("s1");
    const turn = runTurn(s, "x", { idleMs: 60_000, maxInputTokens: 30_000 });
    const caught = turn.catch((e: unknown) => e);
    // Des appels de plus en plus PETITS : si l'on regardait le dernier appel au lieu du cumul,
    // on ne couperait jamais.
    for (const n of [12_000, 9_000, 6_000, 4_000, 3_000]) {
      appel(s, n);
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(await caught).toBeInstanceOf(TurnCostError);
  });

  it("un tour sobre n'est jamais coupé, même long", async () => {
    const s = new ScriptedSession("s1");
    const turn = runTurn(s, "x", { idleMs: 60_000, maxInputTokens: 1_000_000 });
    for (let i = 0; i < 20; i++) {
      appel(s, 15_000);
      await vi.advanceTimersByTimeAsync(1_000);
    }
    s.emit({ type: "idle" });
    await expect(turn).resolves.toBeUndefined();
    expect(s.aborted).toBe(false);
  });

  it("distingue le coût du temps et du silence : trois causes, trois motifs", async () => {
    const s = new ScriptedSession("s1");
    const turn = runTurn(s, "x", { idleMs: 60_000, maxInputTokens: 10_000 });
    const caught = turn.catch((e: unknown) => e);
    appel(s, 20_000);
    await vi.advanceTimersByTimeAsync(10);
    const err = await caught;
    expect(err).not.toBeInstanceOf(TurnTimeoutError);
    expect(err).not.toBeInstanceOf(TurnBudgetError);
    expect((err as Error).message).toMatch(/tokens/i);
  });

  it("un événement usage sans tokens ne compte rien, et ne fait pas planter le cumul", async () => {
    const s = new ScriptedSession("s1");
    const turn = runTurn(s, "x", { idleMs: 60_000, maxInputTokens: 10_000 });
    s.emit({ type: "usage", multiplier: 1 });
    s.emit({ type: "idle" });
    await expect(turn).resolves.toBeUndefined();
  });

  it("le plafond par défaut existe : aucun tour n'est illimité en coût", async () => {
    const s = new ScriptedSession("s1");
    const turn = runTurn(s, "x", { idleMs: 60_000, maxMs: 60 * 60_000 });
    const caught = turn.catch((e: unknown) => e);
    // Le rythme réel de DESIGN, par paliers de 100 k.
    for (let i = 0; i < 60; i++) {
      appel(s, 100_000);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(await caught).toBeInstanceOf(TurnCostError);
  });
});
