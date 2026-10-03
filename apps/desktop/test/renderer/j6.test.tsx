// @vitest-environment jsdom
/**
 * Critères de J6 côté interface : un profil non-développeur mène une tâche sans aide (mode simple,
 * actions guidées, décisions en une phrase) ; une extension s'installe depuis un fichier avec
 * accord sur des permissions en langage clair.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/renderer/App";
import type { TaskCardDto } from "../../src/shared/ipc-contract";
import { FakeApi } from "./fake-api";

const OAUTH = { loggedIn: true, user: "claire", tokenKind: "oauth", copilotCompatible: true } as const;
const WS = { root: "/projets/bolus", name: "bolus" };
const PO = { role: "po", roleLabel: "PO / BA", defaultMode: "simple", permissionPolicy: "prudente", developerMode: false, adminSource: "/etc/agent-studio/admin.json" } as const;
const TDD = { invocation: "tdd", title: "Implémenter en TDD", description: "Découpe la fonctionnalité en comportements, puis écrit tests et code sous contrôle." };

let api: FakeApi;
let mode: "simple" | "advanced";
beforeEach(() => {
  api = new FakeApi();
  mode = "simple";
  window.agentStudio = api;
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  Element.prototype.scrollIntoView = () => {};
  api
    .handle("profile:get", () => PO)
    .handle("ui:get-mode", () => mode)
    .handle("ui:set-mode", (i) => void (mode = (i as { mode: typeof mode }).mode))
    .handle("auth:status", () => OAUTH)
    .handle("workspace:current", () => WS)
    .handle("chat:start", () => [])
    .handle("chat:send", () => undefined)
    .handle("commands:list", () => [TDD])
    .handle("tasks:list", () => [])
    .handle("interactions:list", () => [])
    .handle("interaction:respond", () => undefined);
});
afterEach(cleanup);


/**
 * Attendre que `TaskPanel` soit ABONNÉ avant d'émettre.
 *
 * `FakeApi.emit` parcourt les auditeurs enregistrés et ne garde rien : un événement émis avant le
 * montage du panneau est perdu en silence. Attendre « (PO / BA) » ne suffit pas — ce libellé vient
 * d'un autre composant. Dans l'effet du panneau, les abonnements précèdent les appels
 * `tasks:list` / `interactions:list` : voir l'appel prouve que les auditeurs sont là.
 */
const panneauAbonne = () => waitFor(() => expect(api.calls.some((c) => c.channel === "interactions:list")).toBe(true));

const card = (over: Partial<TaskCardDto>): TaskCardDto => ({
  id: "t1",
  title: "Cycle TDD : plafonner la dose",
  phase: "PLANNING",
  phaseLabel: "Découpage en comportements",
  status: "running",
  alert: false,
  milestone: false,
  updatedAt: new Date().toISOString(),
  ...over,
});

describe("Un profil non-développeur mène une tâche sans aide (J6)", () => {
  it("PO en mode simple : action guidée, décision en une phrase, suivi jusqu'au bout, sans détail technique", async () => {
    render(<App />);

    // Profil attribué, affiché mais pas modifiable ; mode simple par défaut.
    expect(await screen.findByText("(PO / BA)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Simple" }).getAttribute("aria-pressed")).toBe("true");

    // Lancer une tâche sans connaître la syntaxe « / ».
    fireEvent.click(await screen.findByRole("button", { name: /Implémenter en TDD/ }));
    fireEvent.change(screen.getByLabelText("Décrivez ce que vous voulez obtenir"), { target: { value: "plafonner la dose au maximum du médecin" } });
    fireEvent.click(screen.getByRole("button", { name: "Lancer" }));
    await waitFor(() => expect(api.calls).toContainEqual({ channel: "chat:send", input: { text: "/tdd plafonner la dose au maximum du médecin" } }));

    // Pendant le travail : pas de nom d'outil ni d'argument, juste une phrase.
    act(() => {
      api.emit("chat:busy", { busy: true });
      api.emit("chat:agent", { event: { type: "tool-start", toolCallId: "x", toolName: "str_replace_editor" } });
    });
    expect(screen.getByText(/L'agent travaille \(1 action\)/)).toBeTruthy();
    expect(screen.queryByText("str_replace_editor")).toBeNull();
    act(() => api.emit("chat:busy", { busy: false }));

    // Décision : résumé en une phrase et boutons.
    act(() => {
      api.emit("task:update", card({ phase: "PLAN_REVIEW", phaseLabel: "Plan à valider", status: "waiting" }));
      api.emit("interactions:changed", {
        pending: [
          {
            id: "int-1",
            taskId: "t1",
            extensionId: "diabeo.tdd",
            title: "Valider le plan TDD : plafonner la dose",
            detail: "1. dose sous le plafond inchangée\n2. dose au-dessus plafonnée\n3. alerte expliquée",
            options: [
              { id: "approve", label: "Valider le plan" },
              { id: "reject", label: "Refuser et replanifier" },
            ],
            createdAt: "",
          },
        ],
      });
    });
    const waiting = screen.getByText("En attente de vous").closest("section")!;
    expect(within(waiting).getByText("1. dose sous le plafond inchangée (et 2 autres points)")).toBeTruthy();
    fireEvent.click(within(waiting).getByRole("button", { name: "Valider le plan" }));
    await waitFor(() => expect(api.calls).toContainEqual({ channel: "interaction:respond", input: { id: "int-1", option: "approve" } }));

    // Suivi jusqu'à la fin : carte en place, usage en une ligne (pas de tableau), jalon dans le fil.
    const usageRow = { phase: "CYCLE", label: "Test puis code (un tour)", requests: 2, inputTokens: 5000, outputTokens: 600, retries: 0, durationMs: 42_000 };
    act(() => {
      api.emit("interactions:changed", { pending: [] });
      api.emit(
        "task:update",
        card({ phase: "DONE", phaseLabel: "Terminé", status: "finished", milestone: true, step: { index: 3, total: 3, behavior: "alerte expliquée" }, usage: { unit: "requests", rows: [usageRow], total: { ...usageRow, phase: "total", label: "Total" } } }),
      );
      api.emit("chat:messages", {
        messages: [
          { id: "m1", role: "user", text: "/tdd plafonner la dose au maximum du médecin", createdAt: "" },
          { id: "m2", role: "notice", text: "Cycle TDD : plafonner la dose : Terminé", createdAt: "", origin: "diabeo.tdd" },
        ],
      });
    });
    expect(screen.getByText("Terminé")).toBeTruthy();
    expect(screen.getByText("Usage : 2 requêtes")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Cycle TDD : plafonner la dose : Terminé")).toBeTruthy();
  });

  it("mode avancé choisi par l'utilisateur : détail technique visible, choix mémorisé", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Avancé" }));
    await waitFor(() => expect(api.calls).toContainEqual({ channel: "ui:set-mode", input: { mode: "advanced" } }));
    act(() => {
      api.emit("chat:busy", { busy: true });
      api.emit("chat:agent", { event: { type: "tool-start", toolCallId: "x", toolName: "str_replace_editor" } });
    });
    expect(screen.getByText("str_replace_editor")).toBeTruthy();
  });
});

describe("Question ouverte à réponse libre (S2)", () => {
  it("le texte saisi accompagne la réponse", async () => {
    render(<App />);
    await screen.findByText("(PO / BA)");
    await panneauAbonne();
    act(() =>
      api.emit("interactions:changed", {
        pending: [
          {
            id: "int-q1",
            taskId: "t1",
            extensionId: "agent-studio.skraft",
            title: "Question ouverte (US-12)",
            detail: "Le plafond s'applique-t-il par prise ou par jour ?",
            options: [
              { id: "answer:q1", label: "Répondre" },
              { id: "defer:q1", label: "Reporter" },
            ],
            freeText: true,
            createdAt: "",
          },
        ],
      }),
    );
    fireEvent.change(screen.getByLabelText("Votre réponse"), { target: { value: "par prise" } });
    fireEvent.click(screen.getByRole("button", { name: "Répondre" }));
    await waitFor(() => expect(api.calls).toContainEqual({ channel: "interaction:respond", input: { id: "int-q1", option: "answer:q1", comment: "par prise" } }));
  });
});

describe("Installation d'une extension tierce depuis un fichier (J6)", () => {
  it("écran Extensions : installation, accord sur des permissions en langage clair, confirmation", async () => {
    let resolveInstall: (v: unknown) => void = () => {};
    api
      .handle("extensions:list", () => [{ id: "diabeo.tdd", version: "0.1.0", publisher: "diabeo", builtIn: true, signed: true, status: "active", commands: ["Implémenter en TDD"] }])
      .handle("extensions:install", () => new Promise((r) => (resolveInstall = r)))
      .handle("extension-consent:respond", () => undefined);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Extensions" }));
    expect(await screen.findByText("diabeo.tdd")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Installer depuis un fichier" }));
    act(() =>
      api.emit("extension-consent:request", {
        id: "c1",
        kind: "install",
        extensionId: "tiers.lint",
        version: "1.0.0",
        publisher: "tiers",
        signed: true,
        commands: ["Vérifier le style : signale les écarts"],
        permissions: [
          { permission: "fs:read", description: "Lire les fichiers du projet" },
          { permission: "net:none", description: "Aucun accès à Internet" },
        ],
        added: [],
        warnings: [],
      }),
    );
    expect(await screen.findByText("Installer tiers.lint 1.0.0 ?")).toBeTruthy();
    expect(screen.getByText("Lire les fichiers du projet")).toBeTruthy();
    expect(screen.getByText("Éditeur : tiers, signature vérifiée")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Installer" }));
    await waitFor(() => expect(api.calls).toContainEqual({ channel: "extension-consent:respond", input: { id: "c1", accept: true } }));

    act(() => resolveInstall({ status: "installed", id: "tiers.lint", version: "1.0.0" }));
    expect(await screen.findByText("Extension installée : tiers.lint 1.0.0. Ses commandes sont disponibles.")).toBeTruthy();
  });

  it("paquet refusé : la raison est affichée", async () => {
    api.handle("extensions:list", () => []).handle("extensions:install", () => ({ status: "rejected", reason: "Signature invalide : clé inconnue" }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Extensions" }));
    fireEvent.click(screen.getByRole("button", { name: "Installer depuis un fichier" }));
    expect(await screen.findByText("Signature invalide : clé inconnue")).toBeTruthy();
  });
});

/**
 * Un événement plus frais ne doit pas être écrasé par l'instantané initial.
 *
 * `TaskPanel` s'abonne aux événements **et** demande un instantané au montage. Les événements sont
 * synchrones, l'instantané est une promesse : un `interactions:changed` reçu pendant le chargement
 * était écrasé, à la résolution, par une liste déjà périmée.
 *
 * Le test « le texte saisi accompagne la réponse » tombait une fois sur huit à cause de ça —
 * découvert en rejouant la suite huit fois, pas en la lisant. Ici la course est **provoquée** :
 * l'instantané ne se résout qu'après l'événement, donc le test échouait à coup sûr avant correction.
 */
describe("Démarrage : l'instantané initial ne périme pas un événement déjà reçu", () => {
  const DEMANDE = {
    id: "int-q1",
    taskId: "t1",
    extensionId: "agent-studio.skraft",
    title: "Question ouverte (US-12)",
    detail: "Par prise ou par jour ?",
    options: [{ id: "answer:q1", label: "Répondre" }],
    freeText: true,
    createdAt: "",
  };

  it("une demande reçue pendant le chargement survit à la résolution de la liste", async () => {
    let resoudre!: (l: unknown[]) => void;
    api.handle("interactions:list", () => new Promise((r) => (resoudre = r as (l: unknown[]) => void)));
    render(<App />);
    await screen.findByText("(PO / BA)");
    await panneauAbonne();

    act(() => api.emit("interactions:changed", { pending: [DEMANDE] }));
    expect(screen.getByText("Question ouverte (US-12)")).toBeTruthy();

    // La liste initiale se résout MAINTENANT, et elle est vide : elle ne doit rien effacer.
    await act(async () => resoudre([]));
    expect(screen.getByText("Question ouverte (US-12)")).toBeTruthy();
  });

  it("une carte de tâche reçue pendant le chargement survit aussi : la liste remplace, l'événement fusionne", async () => {
    let resoudre!: (l: unknown[]) => void;
    api.handle("tasks:list", () => new Promise((r) => (resoudre = r as (l: unknown[]) => void)));
    render(<App />);
    await screen.findByText("(PO / BA)");
    await panneauAbonne();

    act(() => api.emit("task:update", card({ id: "t9", title: "Cycle TDD : plafonner la dose" })));
    expect(screen.getByText("Cycle TDD : plafonner la dose")).toBeTruthy();
    await act(async () => resoudre([]));
    expect(screen.getByText("Cycle TDD : plafonner la dose")).toBeTruthy();
  });
});
