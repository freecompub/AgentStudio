import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgressReporter, type ProgressSnapshot } from "../src/progress/progress-reporter.js";

const snap = (over: Partial<ProgressSnapshot> = {}): ProgressSnapshot => ({
  taskId: "t1",
  extensionId: "diabeo.tdd",
  title: "Cycle TDD : Plafonner",
  phase: "RED",
  phaseLabel: "Écriture du test",
  milestone: false,
  alert: false,
  ...over,
});

function setup() {
  const cards: ProgressSnapshot[] = [];
  const milestones: string[] = [];
  const alerts: string[] = [];
  const reporter = createProgressReporter({
    onCard: (c) => cards.push(c),
    onMilestone: (_s, text) => milestones.push(text),
    onAlert: (_s, text) => alerts.push(text),
  });
  return { reporter, cards, milestones, alerts };
}

describe("Progression (§7.2, D33)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("carte mise à jour en place, au plus deux fois par seconde, dernier état toujours publié", async () => {
    const { reporter, cards } = setup();
    reporter.update(snap({ phase: "RED" }));
    reporter.update(snap({ phase: "RED_VERIFY" }));
    reporter.update(snap({ phase: "GREEN" }));
    expect(cards.map((c) => c.phase)).toEqual(["RED"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(cards.map((c) => c.phase)).toEqual(["RED", "GREEN"]);
  });

  it("les cartes de tâches différentes ne se freinent pas entre elles", () => {
    const { reporter, cards } = setup();
    reporter.update(snap({ taskId: "a" }));
    reporter.update(snap({ taskId: "b" }));
    expect(cards.map((c) => c.taskId)).toEqual(["a", "b"]);
  });

  it("un jalon à l'entrée d'un état déclaré, pas à chaque mise à jour dans cet état", () => {
    const { reporter, milestones } = setup();
    reporter.update(snap({ phase: "DONE", phaseLabel: "Terminé", milestone: true }));
    reporter.update(snap({ phase: "DONE", phaseLabel: "Terminé", milestone: true }));
    expect(milestones).toEqual(["Cycle TDD : Plafonner : Terminé"]);
  });

  it("jalon avec l'étape en cours", () => {
    const { reporter, milestones } = setup();
    reporter.update(snap({ phase: "STEP_START", phaseLabel: "Nouvelle étape", milestone: true, step: { index: 2, total: 3, behavior: "plafonne" } }));
    expect(milestones).toEqual(["Cycle TDD : Plafonner : Nouvelle étape (étape 2 sur 3 : plafonne)"]);
  });

  it("plus d'un jalon toutes les dix secondes : regroupés en un résumé", async () => {
    const { reporter, milestones } = setup();
    reporter.update(snap({ phase: "A", phaseLabel: "Un", milestone: true }));
    reporter.update(snap({ phase: "B", phaseLabel: "Deux", milestone: true }));
    reporter.update(snap({ phase: "C", phaseLabel: "Trois", milestone: true }));
    expect(milestones).toEqual(["Cycle TDD : Plafonner : Un"]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(milestones).toEqual(["Cycle TDD : Plafonner : Un", "Cycle TDD : Plafonner : 2 jalons (Deux, Trois)"]);
  });

  it("une alerte est immédiate, même juste après un jalon", () => {
    const { reporter, alerts, milestones } = setup();
    reporter.update(snap({ phase: "DONE", phaseLabel: "Terminé", milestone: true }));
    reporter.update(snap({ phase: "ESCALATED", phaseLabel: "Décision requise", alert: true, detail: "budget épuisé" }));
    expect(milestones).toHaveLength(1);
    expect(alerts).toEqual(["Cycle TDD : Plafonner : Décision requise. budget épuisé"]);
  });

  it("dispose : plus rien n'est publié", async () => {
    const { reporter, cards } = setup();
    reporter.update(snap({ phase: "RED" }));
    reporter.update(snap({ phase: "GREEN" }));
    reporter.dispose();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(cards).toHaveLength(1);
  });
});
