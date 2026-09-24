import { describe, expect, it } from "vitest";
import { parseMuterReport } from "../src/swift/muter-report.js";

/** Forme du rapport JSON de Muter supposée d'après sa documentation : À VÉRIFIER sur la version installée. */
const REPORT = {
  globalMutationScore: 75,
  totalAppliedMutationOperators: 4,
  fileReports: [
    {
      fileName: "Bolus.swift",
      path: "/projet/Sources/Domain/Bolus.swift",
      mutationScore: 75,
      appliedOperators: [
        { mutationPoint: { mutationOperatorId: "RelationalOperatorReplacement", filePath: "/projet/Sources/Domain/Bolus.swift", position: { line: 3, column: 10 } }, testSuiteOutcome: "failed" },
        { mutationPoint: { mutationOperatorId: "RemoveSideEffects", filePath: "/projet/Sources/Domain/Bolus.swift", position: { line: 7, column: 4 } }, testSuiteOutcome: "passed" },
      ],
    },
  ],
};

describe("Rapport Muter", () => {
  it("score global et mutants survivants (suite de tests restée verte)", () => {
    expect(parseMuterReport(REPORT, "/projet")).toEqual({
      score: 75,
      files: [{ file: "Sources/Domain/Bolus.swift", score: 75, survived: [{ line: 7, operator: "RemoveSideEffects" }] }],
    });
  });

  it("rapport illisible : erreur explicite", () => {
    expect(() => parseMuterReport({}, "/projet")).toThrow(/Rapport Muter illisible/);
  });
});
