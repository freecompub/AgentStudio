import { describe, expect, it } from "vitest";
import { computeIndicators, DEFAULT_THRESHOLDS, gradeDifficulty, levelEffects, shift } from "../src/difficulty.js";
import { parseStory } from "../src/story.js";
import { US12 } from "./story.test.js";

const ind = (o: Partial<Parameters<typeof gradeDifficulty>[0]> = {}) => ({
  acceptanceCriteria: 1,
  modulesTouched: 1,
  newExternalIntegration: false,
  openBusinessQuestions: 0,
  ...o,
});

describe("Grille de difficulté (SPEC-skraft §8.2)", () => {
  it.each([
    [ind({ newExternalIntegration: true, modulesTouched: 3 }), "challenging"],
    [ind({ openBusinessQuestions: 2 }), "challenging"],
    [ind({ newExternalIntegration: true, modulesTouched: 2 }), "medium"],
    [ind({ acceptanceCriteria: 6 }), "medium-hard"],
    [ind({ modulesTouched: 3 }), "medium-hard"],
    [ind({ openBusinessQuestions: 1 }), "medium-hard"],
    [ind({ acceptanceCriteria: 3 }), "medium"],
    [ind({ modulesTouched: 2 }), "medium"],
    [ind(), "simple"],
    [ind({ acceptanceCriteria: 2, newExternalIntegration: true }), "simple"],
  ] as const)("%j → %s", (indicators, level) => {
    expect(gradeDifficulty(indicators, DEFAULT_THRESHOLDS)).toBe(level);
  });

  it("US-12 : 3 critères, 2 modules, pas d'intégration, 1 question métier → medium-hard", () => {
    const r = parseStory(US12);
    if (!r.ok) throw new Error();
    const indicators = computeIndicators(r.story, {
      modules: ["Domain", "Settings", "UI"],
      files: ["Sources/Domain/BolusCalculator.swift", "Sources/Settings/MaxBolusSetting.swift", "Sources/UI/BolusView.swift"],
      keywords: { Domain: ["bolus", "dose", "plafond"], Settings: ["plafond", "médecin"], UI: ["écran"] },
    });
    expect(indicators).toEqual({ acceptanceCriteria: 3, modulesTouched: 2, newExternalIntegration: false, openBusinessQuestions: 1 });
    expect(gradeDifficulty(indicators, DEFAULT_THRESHOLDS)).toBe("medium-hard");
  });

  it("intégration externe détectée par mention d'une API ou d'une base absente du code", () => {
    const r = parseStory("# US-9 — Export\n\nEn tant que médecin, je veux exporter vers l'API FHIR du dossier patient.\n\n## Critères d'acceptation\n1. Export envoyé.\n");
    if (!r.ok) throw new Error();
    expect(computeIndicators(r.story, { modules: [], files: [], keywords: {} }).newExternalIntegration).toBe(true);
  });

  it("un cran de plus ou de moins, bornés", () => {
    expect(shift("medium", 1)).toBe("medium-hard");
    expect(shift("challenging", 1)).toBe("challenging");
    expect(shift("simple", -1)).toBe("simple");
  });

  it("effets du niveau (§8.3)", () => {
    expect(levelEffects("simple")).toEqual({ skipResearch: true, granularity: "turn-per-scenario", lenses: ["cold-reader", "test-integrity"], maxAttempts: 2 });
    expect(levelEffects("medium")).toMatchObject({ skipResearch: true, maxAttempts: 3, lenses: ["cold-reader", "test-integrity", "architecture", "quality-gates"] });
    expect(levelEffects("medium-hard")).toMatchObject({ skipResearch: false, granularity: "turn-per-scenario" });
    expect(levelEffects("challenging")).toMatchObject({ skipResearch: false, granularity: "session-per-step" });
  });
});

describe("gradeDifficulty — seuils personnalisés", () => {
  it("compte les modules à partir du seuil, pas seulement à sa valeur exacte", () => {
    // Avec les seuils par défaut (2 et 3), l'écart ne se voit pas : ils sont adjacents.
    // `Thresholds` étant un paramètre exporté, un écart plus large révèle le défaut.
    const t = { challengingModules: 9, challengingQuestions: 9, hardCriteria: 9, hardModules: 5, mediumCriteria: 9, mediumModules: 2 };
    const story = (modulesTouched: number) => ({ acceptanceCriteria: 1, modulesTouched, openBusinessQuestions: 0, newExternalIntegration: false });
    expect(gradeDifficulty(story(1), t)).toBe("simple");
    expect(gradeDifficulty(story(2), t)).toBe("medium");
    expect(gradeDifficulty(story(3), t)).toBe("medium");
    expect(gradeDifficulty(story(4), t)).toBe("medium");
    expect(gradeDifficulty(story(5), t)).toBe("medium-hard");
  });
});
