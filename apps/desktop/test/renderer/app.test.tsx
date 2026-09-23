// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/renderer/App";
import type { ChatMessageDto } from "../../src/shared/ipc-contract";
import { FakeApi } from "./fake-api";

const OAUTH = { loggedIn: true, user: "octo", tokenKind: "oauth", copilotCompatible: true } as const;
const WS = { root: "/projets/demo", name: "demo" };

let api: FakeApi;
beforeEach(() => {
  api = new FakeApi();
  window.agentStudio = api;
  // jsdom n'implémente pas <dialog>.showModal ni scrollIntoView.
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

const user = (id: string, text: string, extra: Partial<ChatMessageDto> = {}): ChatMessageDto => ({
  id,
  role: "user",
  text,
  createdAt: "",
  checkpointId: `cp-${id}`,
  ...extra,
});

describe("Renderer", () => {
  it("demande une reconnexion par navigateur quand le jeton est un PAT classique, et affiche le code", async () => {
    api
      .handle("auth:status", () => ({ loggedIn: true, user: "octo", tokenKind: "classic-pat", copilotCompatible: false }))
      .handle("auth:login", () => new Promise(() => {}));
    render(<App />);
    expect(await screen.findByText(/jeton personnel classique/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Se connecter avec GitHub" }));
    act(() => api.emit("auth:device-code", { code: "AB12-CD34", verificationUrl: "https://github.com/login/device" }));
    expect(await screen.findByText("AB12-CD34")).toBeTruthy();
  });

  it("propose de choisir un projet quand aucun n'est ouvert", async () => {
    api.handle("auth:status", () => OAUTH).handle("workspace:current", () => null);
    render(<App />);
    expect(await screen.findByText("Sur quel projet travaille-t-on, octo ?")).toBeTruthy();
  });

  it("affiche la conversation restaurée, avec les tours annulés barrés", async () => {
    api
      .handle("auth:status", () => OAUTH)
      .handle("workspace:current", () => WS)
      .handle("chat:start", () => [
        user("m1", "Crée a.txt", { undone: true }),
        { id: "m2", role: "assistant", text: "Fait.", createdAt: "" },
        user("m3", "Crée b.txt"),
      ]);
    render(<App />);
    expect(await screen.findByText("Crée b.txt")).toBeTruthy();
    expect(screen.getByText("Crée a.txt").closest("li")?.className).toContain("undone");
    expect(screen.getAllByRole("button", { name: "Annuler depuis ici" })).toHaveLength(1);
  });

  it("annulation en deux temps : armer puis confirmer", async () => {
    api
      .handle("auth:status", () => OAUTH)
      .handle("workspace:current", () => WS)
      .handle("chat:start", () => [user("m1", "Crée a.txt")])
      .handle("chat:undo", () => undefined);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Annuler depuis ici" }));
    expect(api.calls.some((c) => c.channel === "chat:undo")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Confirmer : tout annuler depuis ici" }));
    await waitFor(() => expect(api.calls).toContainEqual({ channel: "chat:undo", input: { messageId: "m1" } }));
  });

  it("envoie avec Entrée et affiche le flux de l'agent pendant le tour", async () => {
    api
      .handle("auth:status", () => OAUTH)
      .handle("workspace:current", () => WS)
      .handle("chat:start", () => [])
      .handle("chat:send", () => undefined);
    render(<App />);
    const box = await screen.findByLabelText("Votre message");
    fireEvent.change(box, { target: { value: "Bonjour" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(api.calls).toContainEqual({ channel: "chat:send", input: { text: "Bonjour" } }));

    act(() => {
      api.emit("chat:busy", { busy: true });
      api.emit("chat:agent", { event: { type: "tool-start", toolCallId: "t1", toolName: "view" } });
      api.emit("chat:agent", { event: { type: "message-delta", text: "Je regarde" } });
    });
    expect(screen.getByText("Je regarde")).toBeTruthy();
    expect(screen.getByText("view")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Arrêter l'agent" })).toBeTruthy();
  });

  it("les demandes d'autorisation s'affichent et la réponse est renvoyée", async () => {
    api
      .handle("auth:status", () => OAUTH)
      .handle("workspace:current", () => WS)
      .handle("chat:start", () => [])
      .handle("confirm:respond", () => undefined);
    render(<App />);
    await screen.findByLabelText("Votre message");
    act(() => api.emit("confirm:request", { id: "c1", title: "Exécuter une commande ?", detail: "npm test" }));
    fireEvent.click(await screen.findByRole("button", { name: "Autoriser une fois" }));
    await waitFor(() => expect(api.calls).toContainEqual({ channel: "confirm:respond", input: { id: "c1", allowed: true } }));
  });
});
