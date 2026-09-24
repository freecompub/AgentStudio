/**
 * Lecture du rapport JSON de SwiftLint. Comme pour ESLint, les seuils sont ceux que le projet
 * a inscrits dans son `.swiftlint.yml`, pas ceux que nous imposerions.
 */
import { describe, expect, it } from "vitest";
import { parseSwiftLintReport } from "../src/swift/swiftlint-report.js";

const rapport = [
  {
    file: "/projets/demo/Sources/Domain/Bolus.swift",
    line: 12,
    severity: "Error",
    reason: "Function body should span 40 lines or less excluding comments: currently spans 61 lines",
    rule_id: "function_body_length",
  },
  {
    file: "/projets/demo/Sources/Domain/Bolus.swift",
    line: 30,
    severity: "Warning",
    reason: "Line should be 120 characters or less",
    rule_id: "line_length",
  },
];

describe("parseSwiftLintReport", () => {
  it("ne retient que les erreurs, chemins relatifs à la racine", () => {
    const r = parseSwiftLintReport(rapport, "/projets/demo");
    expect(r.available).toBe(true);
    expect(r.violations).toEqual([
      {
        file: "Sources/Domain/Bolus.swift",
        line: 12,
        rule: "function_body_length",
        message: "Function body should span 40 lines or less excluding comments: currently spans 61 lines",
      },
    ]);
  });

  it("un projet sans faute donne un rapport disponible et vide", () => {
    expect(parseSwiftLintReport([], "/projets/demo")).toEqual({ available: true, violations: [] });
  });

  it("un rapport illisible ne fait pas échouer la porte", () => {
    expect(parseSwiftLintReport("pas du json", "/projets/demo")).toEqual({ available: false, violations: [] });
  });
});
