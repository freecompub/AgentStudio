import { describe, expect, it } from "vitest";
import { createIpcRouter } from "../src/main/ipc-router.js";

const APP = "file:///opt/agent-studio/out/renderer/index.html";

function router(handlers: Record<string, (i: unknown) => Promise<unknown>>) {
  return createIpcRouter(handlers as never, { isTrustedSender: (url) => url === APP });
}

describe("Routeur IPC", () => {
  it("valide l'entrée puis délègue au handler", async () => {
    const seen: unknown[] = [];
    const r = router({ "chat:send": async (i) => void seen.push(i) });
    await r.handle("chat:send", { text: "salut" }, APP);
    expect(seen).toEqual([{ text: "salut" }]);
  });

  it("refuse un canal inconnu", async () => {
    const r = router({});
    await expect(r.handle("fs:rm-rf", {}, APP)).rejects.toThrow(/Canal inconnu/);
  });

  it("refuse une entrée mal formée ou avec des champs en trop", async () => {
    const r = router({ "chat:send": async () => {} });
    await expect(r.handle("chat:send", { text: 42 }, APP)).rejects.toThrow(/invalide/);
    await expect(r.handle("chat:send", { text: "x", extra: true }, APP)).rejects.toThrow(/invalide/);
    await expect(r.handle("chat:send", { text: "x".repeat(100_001) }, APP)).rejects.toThrow(/invalide/);
  });

  it("refuse un expéditeur qui n'est pas la fenêtre de l'application", async () => {
    const r = router({ "auth:status": async () => ({ loggedIn: false }) });
    await expect(r.handle("auth:status", {}, "https://evil.example")).rejects.toThrow(/non autorisé/);
  });

  it("valide aussi la sortie : rien d'inattendu ne part vers le renderer", async () => {
    const r = router({ "auth:status": async () => ({ loggedIn: true, user: "o", token: "gho_secret" }) });
    await expect(r.handle("auth:status", {}, APP)).rejects.toThrow(/Réponse invalide/);
  });

  it("transmet le message des erreurs métier, sans pile", async () => {
    const r = router({ "chat:start": async () => Promise.reject(new Error("Aucun projet ouvert.")) });
    await expect(r.handle("chat:start", {}, APP)).rejects.toThrow("Aucun projet ouvert.");
  });
});
