import { describe, expect, it } from "vitest";
import { synthesize, type LensVerdict } from "../src/review.js";

const lens = (verdict: LensVerdict["verdict"], severities: ("blocker" | "major" | "minor")[] = [], name = "cold-reader"): LensVerdict => ({
  lens: name,
  verdict,
  defects: severities.map((severity) => ({ severity, description: `défaut ${severity}` })),
});

describe("Synthèse de revue par le code (SPEC-skraft §9.3)", () => {
  it.each([
    ["toutes APPROVED sans défaut major", [lens("APPROVED"), lens("APPROVED", ["minor"])], "APPROVED"],
    ["un blocker dans une lentille", [lens("APPROVED", ["blocker"]), lens("APPROVED")], "CHANGES_REQUESTED"],
    ["deux lentilles REJECTED", [lens("REJECTED"), lens("REJECTED"), lens("APPROVED")], "REJECTED"],
    ["un major suffit à demander des changements", [lens("APPROVED", ["major"]), lens("APPROVED")], "CHANGES_REQUESTED"],
    ["une seule REJECTED", [lens("REJECTED"), lens("APPROVED")], "CHANGES_REQUESTED"],
    ["CHANGES_REQUESTED explicite", [lens("CHANGES_REQUESTED"), lens("APPROVED")], "CHANGES_REQUESTED"],
    ["deux REJECTED priment sur un blocker", [lens("REJECTED", ["blocker"]), lens("REJECTED")], "REJECTED"],
  ] as const)("%s → %s", (_label, lenses, expected) => {
    expect(synthesize([...lenses])).toBe(expected);
  });

  it("déterministe : mêmes JSON de lentilles, même verdict", () => {
    const input = [lens("APPROVED", ["major"]), lens("REJECTED")];
    expect(synthesize(structuredClone(input))).toBe(synthesize(structuredClone(input)));
  });

  it("aucune lentille : jamais d'approbation implicite", () => {
    expect(synthesize([])).toBe("CHANGES_REQUESTED");
  });
});
