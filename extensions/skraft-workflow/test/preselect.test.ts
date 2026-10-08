// Copie de extensions/skraft/test/preselect.test.ts (2026-10-08) : elle protège la copie du module.
import { describe, expect, it } from "vitest";
import { keywordsOf, preselectFiles } from "../src/preselect.js";
import { parseStory } from "../src/story.js";
import { US12 } from "./story.test.js";

const story = (() => {
  const r = parseStory(US12);
  if (!r.ok) throw new Error();
  return r.story;
})();

describe("Présélection des fichiers (SPEC-skraft §7.1)", () => {
  it("mots-clés de la story : termes métier, sans mots vides", () => {
    const k = keywordsOf(story);
    expect(k).toEqual(expect.arrayContaining(["plafond", "bolus", "dose", "alerte", "médecin"]));
    expect(k).not.toContain("quand");
    expect(k).not.toContain("pourquoi");
  });

  it("classe les fichiers par pertinence (nom puis contenu), vingt au plus, hors dossiers techniques", () => {
    const files = [
      "Sources/Bolus/BolusCalculator.swift",
      "Sources/Settings/MaxBolusSetting.swift",
      "Sources/UI/DoseView.swift",
      "Sources/Log/Logger.swift",
      ".build/debug/Bolus.o",
      "node_modules/x/bolus.js",
      ...Array.from({ length: 40 }, (_, i) => `Sources/Gen/Bolus${i}.swift`),
    ];
    const contents = { "Sources/Log/Logger.swift": "// journal des alertes de plafond" };
    const r = preselectFiles(story, files, contents);
    expect(r).toHaveLength(20);
    expect(r[0]).toBe("Sources/Bolus/BolusCalculator.swift");
    expect(r).not.toContain(".build/debug/Bolus.o");
    expect(r.some((f) => f.startsWith("node_modules/"))).toBe(false);
  });

  it("le contenu compte quand le nom ne dit rien", () => {
    const r = preselectFiles(story, ["Sources/A.swift", "Sources/B.swift"], { "Sources/B.swift": "let plafond = 10 // dose" });
    expect(r).toEqual(["Sources/B.swift"]);
  });
});
