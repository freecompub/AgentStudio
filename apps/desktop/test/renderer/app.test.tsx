// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/renderer/App";
import type { ChatMessageDto } from "../../src/shared/ipc-contract";
import { FakeApi } from "./fake-api";

const OAUTH = { loggedIn: true, user: "octo", tokenKind: "oauth", copilotCompatible: true, hostname: "github.com" } as const;
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

/**
 * `FakeApi.emit` ne garde rien : un événement émis avant que `TaskPanel` ne se soit abonné est
 * perdu en silence. Attendre « Votre message » ne prouve que le montage de la conversation ; le
 * panneau s'abonne puis demande ses instantanés, donc voir l'appel prouve l'abonnement.
 */
const panneauAbonne = () => waitFor(() => expect(api.calls.some((c) => c.channel === "interactions:list")).toBe(true));


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
      .handle("auth:status", () => ({ loggedIn: true, user: "octo", tokenKind: "classic-pat", copilotCompatible: false, hostname: "github.com" }))
      .handle("auth:login", () => new Promise(() => {}))
      .handle("shell:open-device-page", () => undefined);
    render(<App />);
    expect(await screen.findByText(/jeton personnel classique/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Se connecter avec GitHub" }));
    act(() => api.emit("auth:device-code", { code: "AB12-CD34", verificationUrl: "https://github.com/login/device" }));
    expect(await screen.findByText("AB12-CD34")).toBeTruthy();
    await waitFor(() => expect(api.calls).toContainEqual({ channel: "shell:open-device-page", input: {} }));
  });

  it("si le navigateur ne s'ouvre pas, conserve le code et montre l'adresse Enterprise et l'erreur", async () => {
    api
      .handle("auth:status", () => ({ loggedIn: false, hostname: "byb.ghe.com" }))
      .handle("auth:login", () => new Promise(() => {}))
      .handle("shell:open-device-page", () => { throw new Error("Navigateur indisponible"); });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Se connecter avec GitHub" }));
    act(() => api.emit("auth:device-code", { code: "AB12-CD34", verificationUrl: "https://byb.ghe.com/login/device" }));
    expect(await screen.findByText("AB12-CD34")).toBeTruthy();
    expect(await screen.findByText("https://byb.ghe.com/login/device")).toBeTruthy();
    expect(await screen.findByText(/Navigateur indisponible/)).toBeTruthy();
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
    await waitFor(() => expect(api.calls).toContainEqual({ channel: "confirm:respond", input: { id: "c1", answer: "allow-once" } }));
  });
});

describe("Renderer — tâches et décisions (J2)", () => {
  function chatReady() {
    api
      .handle("auth:status", () => OAUTH)
      .handle("workspace:current", () => WS)
      .handle("chat:start", () => [])
      .handle("commands:list", () => [{ invocation: "tdd", title: "Implémenter en TDD", description: "Cycle rouge, vert, nettoyage" }])
      .handle("tasks:list", () => [])
      .handle("interactions:list", () => [])
      .handle("interaction:respond", () => undefined)
      .handle("task:cancel", () => undefined)
      .handle("models:list", () => ({ models: [], selected: null }))
      .handle("model:set", () => undefined);
  }

  it("propose les commandes quand on tape /", async () => {
    chatReady();
    render(<App />);
    const box = await screen.findByLabelText("Votre message");
    await waitFor(() => expect(api.calls.some((c) => c.channel === "commands:list")).toBe(true));
    fireEvent.change(box, { target: { value: "/t" } });
    fireEvent.click(await screen.findByRole("button", { name: "/tdd" }));
    expect((box as HTMLTextAreaElement).value).toBe("/tdd ");
  });

  it("affiche la carte de tâche mise à jour en place et la décision en attente", async () => {
    chatReady();
    render(<App />);
    await screen.findByLabelText("Votre message");
    await panneauAbonne();
    const card = { id: "t1", title: "Cycle TDD : Plafonner", phase: "RED", phaseLabel: "Écriture du test", status: "running" as const, alert: false, milestone: false, step: { index: 1, total: 2, behavior: "plafonne" }, updatedAt: new Date().toISOString() };
    act(() => api.emit("task:update", card));
    expect(await screen.findByText("Cycle TDD : Plafonner")).toBeTruthy();
    expect(screen.getByText(/Écriture du test/)).toBeTruthy();
    act(() => api.emit("task:update", { ...card, phase: "GREEN", phaseLabel: "Écriture du code" }));
    expect(screen.getAllByText("Cycle TDD : Plafonner")).toHaveLength(1);
    expect(screen.getByText(/Écriture du code/)).toBeTruthy();

    act(() =>
      api.emit("interactions:changed", {
        pending: [{ id: "int-1", taskId: "t1", extensionId: "diabeo.tdd", title: "Valider le plan TDD", detail: "1. plafonne", options: [{ id: "approve", label: "Valider le plan" }, { id: "reject", label: "Refuser et replanifier" }], createdAt: "" }],
      }),
    );
    expect(screen.getByText("En attente de vous")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Valider le plan" }));
    await waitFor(() => expect(api.calls).toContainEqual({ channel: "interaction:respond", input: { id: "int-1", option: "approve" } }));

    fireEvent.click(screen.getByRole("button", { name: "Annuler la tâche" }));
    await waitFor(() => expect(api.calls).toContainEqual({ channel: "task:cancel", input: { taskId: "t1" } }));
  });

  it("affiche l'usage par état de la tâche, dans l'unité du fournisseur", async () => {
    chatReady();
    render(<App />);
    await screen.findByLabelText("Votre message");
    await panneauAbonne();
    const row = (phase: string, label: string, requests: number, retries = 0) => ({ phase, label, requests, inputTokens: 1000, outputTokens: 100, retries, durationMs: 65_000 });
    act(() =>
      api.emit("task:update", {
        id: "t1", title: "Cycle TDD : X", phase: "CYCLE", phaseLabel: "Test puis code (un tour)", status: "running", alert: false, milestone: false, updatedAt: new Date().toISOString(),
        usage: { unit: "requests", rows: [row("PLANNING", "Découpage en comportements", 1), row("CYCLE", "Test puis code (un tour)", 2, 1)], total: row("total", "Total", 3, 1) },
      }),
    );
    expect(await screen.findByText("Usage : 3 requêtes, 1 réessai", {}, { timeout: 5_000 })).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: "Découpage en comportements" })).toBeTruthy();
    expect(screen.getAllByText("1 min 5 s")).toHaveLength(2);
  });

  it("affiche l'extension d'origine d'un message", async () => {
    chatReady();
    api.handle("chat:start", () => [{ id: "n1", role: "notice", text: "Cycle TDD lancé", createdAt: "", origin: "diabeo.tdd" }]);
    render(<App />);
    expect(await screen.findByText("diabeo.tdd")).toBeTruthy();
  });

  it("tient dans <StrictMode>, qui monte et démonte chaque effet deux fois", async () => {
    chatReady();
    // Un effet ne doit rien renvoyer d'autre qu'une fonction de nettoyage : React appelle sa
    // valeur de retour au démontage, et <StrictMode> démonte chaque effet une fois de plus.
    Element.prototype.scrollIntoView = () => "valeur inattendue" as unknown as void;
    const plantages: unknown[] = [];
    const onError = (e: ErrorEvent) => plantages.push(e.error ?? e.message);
    window.addEventListener("error", onError);
    try {
      render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
      expect(await screen.findByLabelText("Votre message")).toBeTruthy();
      await act(async () => {});
      // L'interface survit au double montage : l'arbre n'a pas été démonté par une erreur.
      expect(plantages).toEqual([]);
      expect(screen.getByLabelText("Votre message")).toBeTruthy();
    } finally {
      window.removeEventListener("error", onError);
    }
  });

  it("non connecté : propose GitHub.com ou une instance Enterprise", async () => {
    api.handle("auth:status", () => ({ loggedIn: false, hostname: "github.com" })).handle("auth:login", () => new Promise(() => {}));
    render(<App />);
    await screen.findByRole("button", { name: "Se connecter avec GitHub" });

    // Par défaut, github.com : aucun domaine à saisir.
    expect(screen.queryByLabelText("Adresse de votre instance")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "GitHub Enterprise" }));
    expect(screen.getByLabelText("Adresse de votre instance")).toBeTruthy();
  });

  it("connexion à une instance Enterprise : le domaine est transmis", async () => {
    api.handle("auth:status", () => ({ loggedIn: false, hostname: "github.com" })).handle("auth:login", () => new Promise(() => {}));
    render(<App />);
    await screen.findByRole("button", { name: "Se connecter avec GitHub" });

    fireEvent.click(screen.getByRole("radio", { name: "GitHub Enterprise" }));
    fireEvent.change(screen.getByLabelText("Adresse de votre instance"), { target: { value: "github.exemple.fr" } });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter avec GitHub" }));

    await waitFor(() => expect(api.calls.some((c) => c.channel === "auth:login")).toBe(true));
    expect(api.calls.find((c) => c.channel === "auth:login")?.input).toEqual({ hostname: "github.exemple.fr" });
  });

  it("GitHub.com : aucun domaine n'est transmis", async () => {
    api.handle("auth:status", () => ({ loggedIn: false, hostname: "github.com" })).handle("auth:login", () => new Promise(() => {}));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Se connecter avec GitHub" }));
    await waitFor(() => expect(api.calls.some((c) => c.channel === "auth:login")).toBe(true));
    expect(api.calls.find((c) => c.channel === "auth:login")?.input).toEqual({});
  });

  it("se déconnecter ramène à l'écran de connexion", async () => {
    chatReady();
    api.handle("auth:logout", () => undefined);
    render(<App />);
    await screen.findByLabelText("Votre message");

    fireEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));

    api.handle("auth:status", () => ({ loggedIn: false, hostname: "github.com" }));
    expect(await screen.findByRole("button", { name: "Se connecter avec GitHub" })).toBeTruthy();
    expect(api.calls.some((c) => c.channel === "auth:logout")).toBe(true);
  });

  it("propose les modèles disponibles avec leur coût relatif", async () => {
    chatReady();
    api.handle("models:list", () => ({
      models: [
        { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", multiplier: 1 },
        { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", multiplier: 3 },
      ],
      selected: "claude-sonnet-4.5",
    }));
    render(<App />);

    const liste = (await screen.findByLabelText("Modèle")) as HTMLSelectElement;
    expect(liste.value).toBe("claude-sonnet-4.5");
    expect([...liste.options].map((o) => o.textContent)).toEqual([
      "Automatique",
      "GPT-5.6 Luna (×1)",
      "Claude Sonnet 4.5 (×3)",
    ]);
  });

  it("choisir un modèle l'enregistre pour le projet", async () => {
    chatReady();
    api.handle("models:list", () => ({ models: [{ id: "gpt-5.6-luna", name: "GPT-5.6 Luna", multiplier: 1 }], selected: null }));
    render(<App />);

    const liste = await screen.findByLabelText("Modèle");
    fireEvent.change(liste, { target: { value: "gpt-5.6-luna" } });
    await waitFor(() => expect(api.calls.some((c) => c.channel === "model:set")).toBe(true));
    expect(api.calls.find((c) => c.channel === "model:set")?.input).toEqual({ id: "gpt-5.6-luna" });

    // Revenir à « Automatique » efface le choix.
    fireEvent.change(liste, { target: { value: "" } });
    await waitFor(() => expect(api.calls.filter((c) => c.channel === "model:set")).toHaveLength(2));
    expect(api.calls.filter((c) => c.channel === "model:set").at(-1)?.input).toEqual({ id: null });
  });

  it("aucun modèle proposé : la liste déroulante n'est pas affichée", async () => {
    chatReady();
    render(<App />);
    await screen.findByLabelText("Votre message");
    expect(screen.queryByLabelText("Modèle")).toBeNull();
  });

  it("clôture le projet et revient au choix d'un projet", async () => {
    chatReady();
    api.handle("workspace:close", () => undefined);
    render(<App />);
    await screen.findByLabelText("Votre message");

    fireEvent.click(screen.getByRole("button", { name: "Fermer le projet" }));

    expect(await screen.findByText("Sur quel projet travaille-t-on, octo ?")).toBeTruthy();
    expect(api.calls.some((c) => c.channel === "workspace:close")).toBe(true);
  });

  it("reste sur le projet si la clôture échoue", async () => {
    chatReady();
    api.handle("workspace:close", () => {
      throw new Error("Une tâche est en cours.");
    });
    render(<App />);
    await screen.findByLabelText("Votre message");

    fireEvent.click(screen.getByRole("button", { name: "Fermer le projet" }));

    expect(await screen.findByText("Une tâche est en cours.")).toBeTruthy();
    expect(screen.getByLabelText("Votre message")).toBeTruthy();
  });
});

/**
 * Runtime au choix (ADR 0070). Avec Claude, la connexion est celle de Claude Code, menée dans un
 * terminal : l'écran dit quoi taper et vérifie ensuite ; GitHub n'est pas demandé.
 */
describe("Renderer — runtime Claude (ADR 0070)", () => {
  const DEUX = (choisi: "copilot" | "claude", claude: unknown) => () => ({ choisi, disponibles: ["copilot", "claude"], claude });
  function conversation() {
    api
      .handle("workspace:current", () => WS)
      .handle("chat:start", () => [])
      .handle("commands:list", () => [])
      .handle("tasks:list", () => [])
      .handle("interactions:list", () => [])
      .handle("models:list", () => ({ models: [], selected: null }));
  }

  it("Claude choisi et connecté : pas d'écran GitHub, on va au projet", async () => {
    api.handle("runtime:status", DEUX("claude", { etat: "connecte", methode: "claude.ai" })).handle("auth:status", () => ({ loggedIn: false, hostname: "github.com" })).handle("workspace:current", () => null);
    render(<App />);
    expect(await screen.findByText("Sur quel projet travaille-t-on, Claude ?")).toBeTruthy();
  });

  it("Claude choisi, non connecté : l'écran dit de lancer `claude auth login`, puis vérifie", async () => {
    let claude: unknown = { etat: "non-connecte" };
    api.handle("runtime:status", () => DEUX("claude", claude)()).handle("auth:status", () => OAUTH).handle("workspace:current", () => null);
    render(<App />);
    expect(await screen.findByText(/claude auth login/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Se connecter avec GitHub" })).toBeNull();
    claude = { etat: "connecte" };
    fireEvent.click(screen.getByRole("button", { name: "Vérifier la connexion" }));
    expect(await screen.findByText("Sur quel projet travaille-t-on, octo ?")).toBeTruthy();
  });

  it("Claude Code absent : l'écran dit de l'installer", async () => {
    api.handle("runtime:status", DEUX("claude", { etat: "absent" })).handle("auth:status", () => OAUTH);
    render(<App />);
    expect(await screen.findByText(/Claude Code \(claude\) n'est pas installé/)).toBeTruthy();
  });

  it("à la connexion, choisir Claude l'enregistre et relit l'état ; Copilot seul : aucun choix proposé", async () => {
    let choisi: "copilot" | "claude" = "copilot";
    api
      .handle("runtime:status", () => DEUX(choisi, { etat: "non-connecte" })())
      .handle("runtime:set", (i) => void (choisi = (i as { runtime: typeof choisi }).runtime))
      .handle("auth:status", () => ({ loggedIn: false, hostname: "github.com" }));
    render(<App />);
    fireEvent.click(await screen.findByLabelText("Claude (Claude Code)"));
    expect(await screen.findByText(/claude auth login/)).toBeTruthy();
    expect(api.calls).toContainEqual({ channel: "runtime:set", input: { runtime: "claude" } });
    cleanup();

    api.handle("runtime:status", () => ({ choisi: "copilot", disponibles: ["copilot"], claude: null }));
    render(<App />);
    await screen.findByRole("button", { name: "Se connecter avec GitHub" });
    expect(screen.queryByLabelText("Claude (Claude Code)")).toBeNull();
  });

  it("dans la conversation (mode avancé) : changer de runtime l'enregistre et relance ; avec Claude, pas de déconnexion GitHub", async () => {
    let choisi: "copilot" | "claude" = "copilot";
    conversation();
    api
      .handle("auth:status", () => OAUTH)
      .handle("runtime:status", () => DEUX(choisi, { etat: "connecte" })())
      .handle("runtime:set", (i) => void (choisi = (i as { runtime: typeof choisi }).runtime));
    render(<App />);
    await screen.findByLabelText("Votre message");
    expect(screen.getByRole("button", { name: "Se déconnecter" })).toBeTruthy();
    const avant = api.calls.filter((c) => c.channel === "chat:start").length;
    fireEvent.change(screen.getByLabelText("Agents"), { target: { value: "claude" } });
    await waitFor(() => expect(api.calls).toContainEqual({ channel: "runtime:set", input: { runtime: "claude" } }));
    // La conversation a été fermée par le changement : elle est rouverte, sur Claude.
    await waitFor(() => expect(api.calls.filter((c) => c.channel === "chat:start").length).toBeGreaterThan(avant));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Se déconnecter" })).toBeNull());
    expect((screen.getByLabelText("Agents") as HTMLSelectElement).value).toBe("claude");
  });
});
