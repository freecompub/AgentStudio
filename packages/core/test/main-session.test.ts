import { describe, expect, it, vi } from "vitest";
import { createMainSession, type MainSessionDeps } from "../src/session/main-session.js";
import { reply } from "../src/testing/scripted-session.js";
import { ScriptedRuntime } from "../src/testing/scripted-runtime.js";
import {
  fixedClock,
  MemoryConversationStore,
  RecordingCheckpoints,
  sequentialIds,
} from "../src/testing/memory-doubles.js";

const ROOT = "/projets/demo";

function setup(overrides: Partial<MainSessionDeps> = {}) {
  const runtime = new ScriptedRuntime();
  const store = new MemoryConversationStore();
  const checkpoints = new RecordingCheckpoints();
  const deps: MainSessionDeps = {
    runtime,
    store,
    checkpoints,
    workspaceRoot: ROOT,
    systemPrompt: "Tu es l'assistant.",
    guard: { check: async () => ({ decision: "allow" }) },
    clock: fixedClock(),
    ids: sequentialIds(),
    idleMs: 1_000,
    ...overrides,
  };
  return { runtime, store, checkpoints, deps, session: createMainSession(deps) };
}

describe("Session principale — démarrage et reprise", () => {
  it("ouvre une session neuve quand aucune conversation n'existe, et l'enregistre", async () => {
    const { runtime, store, session } = setup();
    expect(await session.start()).toEqual([]);
    const cfg = runtime.configs.get("fake-1");
    expect(cfg?.role).toBe("main");
    expect(cfg?.workingDirectory).toBe(ROOT);
    expect(store.records.get(ROOT)?.runtimeSessionId).toBe("fake-1");
  });

  it("reprend la session du runtime et restaure les messages après redémarrage", async () => {
    const first = setup();
    await first.session.start();
    first.runtime.last.onNextSend(reply("Bonjour !"));
    await first.session.send("Salut");

    const again = createMainSession({ ...first.deps, ids: sequentialIds("n") });
    const messages = await again.start();

    expect(messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "Salut"],
      ["assistant", "Bonjour !"],
    ]);
    expect(first.runtime.configs.size).toBe(1); // reprise, pas de nouvelle session
  });

  it("ouvre une nouvelle session si la reprise échoue, sans perdre l'historique affiché", async () => {
    const first = setup();
    await first.session.start();
    first.runtime.last.onNextSend(reply("Bonjour !"));
    await first.session.send("Salut");
    first.runtime.unresumable.add("fake-1");

    const again = createMainSession(first.deps);
    const messages = await again.start();

    expect(messages).toHaveLength(3);
    expect(messages[2]).toMatchObject({ role: "notice" });
    expect(messages[2]?.text).toMatch(/n'a pas pu être reprise/);
    expect(first.store.records.get(ROOT)?.runtimeSessionId).toBe("fake-2");
  });
});

describe("Session principale — tours", () => {
  it("prend un checkpoint avant chaque tour et le rattache au message utilisateur", async () => {
    const { runtime, checkpoints, session } = setup();
    await session.start();
    runtime.last.onNextSend(reply("Fait."));
    await session.send("Ajoute un README");

    expect(checkpoints.created).toEqual(["Avant : Ajoute un README"]);
    expect(session.messages()).toEqual([
      { id: "m1", role: "user", text: "Ajoute un README", createdAt: "2026-09-23T10:00:00.000Z", checkpointId: "cp-1" },
      { id: "m2", role: "assistant", text: "Fait.", createdAt: "2026-09-23T10:00:00.000Z" },
    ]);
  });

  it("chaque message complet de l'agent devient un message ; le flux est relayé aux abonnés", async () => {
    const { runtime, session } = setup();
    await session.start();
    const streamed: string[] = [];
    session.onEvent((e) => {
      if (e.type === "agent") streamed.push(e.event.type);
    });
    runtime.last.onNextSend((_p, s) => {
      s.emit({ type: "message-delta", text: "Je " });
      s.emit({ type: "message", text: "Je regarde." });
      s.emit({ type: "tool-start", toolCallId: "t1", toolName: "view" });
      s.emit({ type: "tool-end", toolCallId: "t1", success: true });
      s.emit({ type: "message", text: "C'est fait." });
      s.emit({ type: "idle" });
    });
    await session.send("Regarde");

    expect(session.messages().filter((m) => m.role === "assistant").map((m) => m.text)).toEqual([
      "Je regarde.",
      "C'est fait.",
    ]);
    expect(streamed).toEqual(["message-delta", "message", "tool-start", "tool-end", "message", "idle"]);
  });

  it("persiste le message utilisateur avant le tour (survit à un plantage en plein tour)", async () => {
    const { runtime, store, session } = setup();
    await session.start();
    let persistedDuringTurn: string[] = [];
    runtime.last.onNextSend(async (_p, s) => {
      persistedDuringTurn = (store.records.get(ROOT)?.messages ?? []).map((m) => m.text);
      reply("ok")(_p, s);
    });
    await session.send("Bonjour");
    expect(persistedDuringTurn).toEqual(["Bonjour"]);
  });

  it("refuse un envoi pendant qu'un tour est en cours", async () => {
    const { session } = setup();
    await session.start();
    const pending = session.send("premier");
    await expect(session.send("second")).rejects.toThrow(/déjà en cours/);
    await session.abort();
    await pending;
  });

  it("signale l'inactivité de l'agent par un avis, sans planter", async () => {
    vi.useFakeTimers();
    try {
      const { session } = setup();
      await session.start();
      const done = session.send("…");
      await vi.advanceTimersByTimeAsync(1_000);
      await done;
      expect(session.messages().at(-1)).toMatchObject({ role: "notice" });
      expect(session.messages().at(-1)?.text).toMatch(/ne répond plus/);
      expect(session.busy).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("signale une panne d'environnement par un avis", async () => {
    const { runtime, session } = setup();
    await session.start();
    runtime.last.onNextSend((_p, s) => s.emit({ type: "error", message: "quota épuisé" }));
    await session.send("x");
    expect(session.messages().at(-1)?.text).toMatch(/quota épuisé/);
  });

  it("refuse un message vide", async () => {
    const { session } = setup();
    await session.start();
    await expect(session.send("   ")).rejects.toThrow(/vide/);
  });
});

describe("Session principale — annulation en un geste", () => {
  async function twoTurns() {
    const ctx = setup();
    await ctx.session.start();
    ctx.runtime.last.onNextSend(reply("un"));
    await ctx.session.send("Tour 1");
    ctx.runtime.last.onNextSend(reply("deux"));
    await ctx.session.send("Tour 2");
    return ctx;
  }

  it("restaure le checkpoint du tour et marque ce tour et les suivants comme annulés", async () => {
    const { checkpoints, session } = await twoTurns();
    const tour1 = session.messages().find((m) => m.text === "Tour 1")!;

    await session.undo(tour1.id);

    expect(checkpoints.rolledBack).toEqual(["cp-1"]);
    const users = session.messages().filter((m) => m.role === "user");
    expect(users.map((m) => m.undone)).toEqual([true, true]);
    expect(session.messages().at(-1)).toMatchObject({ role: "notice" });
  });

  it("informe l'agent de l'annulation au tour suivant", async () => {
    const { runtime, session } = await twoTurns();
    const tour2 = session.messages().find((m) => m.text === "Tour 2")!;
    await session.undo(tour2.id);

    runtime.last.onNextSend(reply("compris"));
    await session.send("Tour 3");

    const prompt = runtime.last.sent.at(-1)!;
    expect(prompt).toMatch(/annulé/);
    expect(prompt).toMatch(/Tour 2/);
    expect(prompt.endsWith("Tour 3")).toBe(true);

    runtime.last.onNextSend(reply("ok"));
    await session.send("Tour 4");
    expect(runtime.last.sent.at(-1)).toBe("Tour 4");
  });

  it("refuse d'annuler un message inconnu, non utilisateur ou déjà annulé", async () => {
    const { session } = await twoTurns();
    const assistant = session.messages().find((m) => m.role === "assistant")!;
    await expect(session.undo("inconnu")).rejects.toThrow(/introuvable/);
    await expect(session.undo(assistant.id)).rejects.toThrow(/introuvable/);
    const tour1 = session.messages().find((m) => m.text === "Tour 1")!;
    await session.undo(tour1.id);
    await expect(session.undo(tour1.id)).rejects.toThrow(/déjà annulé/);
  });

  it("l'annulation est persistée", async () => {
    const { store, session } = await twoTurns();
    const tour1 = session.messages().find((m) => m.text === "Tour 1")!;
    await session.undo(tour1.id);
    expect(store.records.get(ROOT)?.messages.find((m) => m.id === tour1.id)?.undone).toBe(true);
  });
});
