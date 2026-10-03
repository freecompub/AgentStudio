// @vitest-environment jsdom
/**
 * Réglage des modèles par classe de rôle (ADR 0048) : en mode avancé seulement, un panneau associe
 * chaque classe à un modèle de l'abonnement, ou la laisse au modèle du projet.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/renderer/App";
import { FakeApi } from "./fake-api";

const OAUTH = { loggedIn: true, user: "claire", tokenKind: "oauth", copilotCompatible: true } as const;
const WS = { root: "/projets/bolus", name: "bolus" };
const DEV = { role: "developpeur", roleLabel: "Développeur", defaultMode: "advanced", permissionPolicy: "prudente", developerMode: false, adminSource: "/etc/agent-studio/admin.json" } as const;
const MODELS = [
  { id: "gpt-5-mini", name: "GPT-5 mini", multiplier: 0.33 },
  { id: "claude-sonnet-5.5", name: "Claude Sonnet 5.5" },
];

let api: FakeApi;
let mode: "simple" | "advanced";
beforeEach(() => {
  api = new FakeApi();
  mode = "advanced";
  window.agentStudio = api;
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  Element.prototype.scrollIntoView = () => {};
  api
    .handle("profile:get", () => DEV)
    .handle("ui:get-mode", () => mode)
    .handle("ui:set-mode", (i) => void (mode = (i as { mode: typeof mode }).mode))
    .handle("auth:status", () => OAUTH)
    .handle("workspace:current", () => WS)
    .handle("chat:start", () => [])
    .handle("commands:list", () => [])
    .handle("tasks:list", () => [])
    .handle("interactions:list", () => [])
    .handle("models:list", () => ({ models: MODELS, selected: null }))
    .handle("model-classes:list", () => ({ models: MODELS, classes: { strong: "claude-sonnet-5.5" } }))
    .handle("model-class:set", () => undefined);
});
afterEach(cleanup);

describe("Modèles des agents (ADR 0048)", () => {
  it("mode avancé : chaque classe se règle sur un modèle de l'abonnement, ou reste au défaut", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Modèles des agents" }));
    const panneau = await screen.findByRole("dialog", { name: "Modèles des agents" });

    const conception = (await within(panneau).findByLabelText(/Conception/)) as HTMLSelectElement;
    await waitFor(() => expect(conception.value).toBe("claude-sonnet-5.5"));
    const leger = within(panneau).getByLabelText(/Tâches légères/) as HTMLSelectElement;
    expect(leger.value).toBe("");
    expect([...leger.options].map((o) => o.textContent)).toEqual(["Par défaut (modèle du projet)", "GPT-5 mini (×0.33)", "Claude Sonnet 5.5"]);

    fireEvent.change(leger, { target: { value: "gpt-5-mini" } });
    await waitFor(() => expect(api.calls.find((c) => c.channel === "model-class:set")?.input).toEqual({ modelClass: "light", id: "gpt-5-mini" }));

    fireEvent.change(conception, { target: { value: "" } });
    await waitFor(() => expect(api.calls.filter((c) => c.channel === "model-class:set").at(-1)?.input).toEqual({ modelClass: "strong", id: null }));
  });

  it("mode simple : le réglage n'est pas proposé", async () => {
    mode = "simple";
    render(<App />);
    await screen.findByLabelText("Votre message");
    expect(screen.queryByRole("button", { name: "Modèles des agents" })).toBeNull();
  });
});
