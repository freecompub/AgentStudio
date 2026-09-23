import { EnvFailureError, TurnTimeoutError, WorkDefectError } from "@agent-studio/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRpcEndpoint, memoryChannelPair, RpcClosedError } from "../src/rpc/endpoint.js";

function pair(aHandlers = {}, bHandlers = {}) {
  const [ca, cb] = memoryChannelPair();
  return { a: createRpcEndpoint(ca, aHandlers), b: createRpcEndpoint(cb, bHandlers) };
}

describe("RPC", () => {
  afterEach(() => vi.useRealTimers());

  it("appel et réponse, dans les deux sens", async () => {
    const { a, b } = pair({ ping: async ([x]: unknown[]) => `pong ${x}` }, { add: async ([x, y]: unknown[]) => (x as number) + (y as number) });
    expect(await b.call("ping", [1])).toBe("pong 1");
    expect(await a.call("add", [2, 3])).toBe(5);
  });

  it("méthode inconnue : erreur explicite", async () => {
    const { a } = pair();
    await expect(a.call("absente", [])).rejects.toThrow(/Méthode RPC inconnue : absente/);
  });

  it("les erreurs traversent avec leur nature (défaut de travail, panne d'environnement)", async () => {
    const { a } = pair({}, {
      timeout: async () => Promise.reject(new TurnTimeoutError(1000)),
      work: async () => Promise.reject(new WorkDefectError("pas d'outil de fin")),
      env: async () => Promise.reject(new EnvFailureError("quota")),
      other: async () => Promise.reject(new TypeError("bogue")),
    });
    await expect(a.call("timeout", [])).rejects.toBeInstanceOf(WorkDefectError);
    await expect(a.call("work", [])).rejects.toBeInstanceOf(WorkDefectError);
    await expect(a.call("env", [])).rejects.toBeInstanceOf(EnvFailureError);
    const err = await a.call("other", []).catch((e: Error) => e);
    expect(err).toMatchObject({ name: "TypeError", message: "bogue" });
  });

  it("annulation : le signal de l'appelant déclenche celui du traitement distant", async () => {
    let remoteAborted = false;
    const { a } = pair({}, {
      long: async (_args: unknown[], { signal }: { signal: AbortSignal }) =>
        new Promise((_res, rej) => signal.addEventListener("abort", () => ((remoteAborted = true), rej(new Error("interrompu"))))),
    });
    const ac = new AbortController();
    const p = a.call("long", [], { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 0));
    ac.abort();
    await expect(p).rejects.toThrow();
    expect(remoteAborted).toBe(true);
  });

  it("délai par appel dépassé : rejet", async () => {
    vi.useFakeTimers();
    const { a } = pair({}, { lent: () => new Promise(() => {}) });
    const p = a.call("lent", [], { timeoutMs: 100 }).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(100);
    expect(await p).toMatchObject({ message: expect.stringMatching(/délai/) });
  });

  it("fermeture (plantage de l'hôte) : les appels en cours échouent comme panne d'environnement", async () => {
    const { a } = pair({}, { lent: () => new Promise(() => {}) });
    const p = a.call("lent", []);
    a.close("hôte arrêté");
    await expect(p).rejects.toBeInstanceOf(RpcClosedError);
    await expect(p).rejects.toBeInstanceOf(EnvFailureError);
    await expect(a.call("x", [])).rejects.toThrow(/hôte arrêté/);
  });

  it("arguments non sérialisables refusés à l'envoi", async () => {
    const { a } = pair({}, { f: async () => 1 });
    await expect(a.call("f", [() => 1])).rejects.toThrow(/sérialisable/);
  });
});
