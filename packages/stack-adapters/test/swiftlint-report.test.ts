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
  it("chemins relatifs à la racine", () => {
    const r = parseSwiftLintReport(rapport, "/projets/demo");
    expect(r.available).toBe(true);
    expect(r.violations[0]).toEqual({
      file: "Sources/Domain/Bolus.swift",
      line: 12,
      rule: "function_body_length",
      message: "Function body should span 40 lines or less excluding comments: currently spans 61 lines",
    });
  });

  it("un projet sans faute donne un rapport disponible et vide", () => {
    expect(parseSwiftLintReport([], "/projets/demo")).toEqual({ available: true, violations: [] });
  });

  it("les avertissements comptent : dans SwiftLint, c'est la règle activée qui est le choix du projet", () => {
    // Contrairement à ESLint, où `warn` est un niveau choisi règle par règle, SwiftLint met
    // `warning` par défaut sur presque toutes ses règles. Les écarter reviendrait à ne jamais
    // rien reprocher, donc à attester la conformité de tout projet Swift.
    const r = parseSwiftLintReport(rapport, "/projets/demo");
    expect(r.violations).toHaveLength(2);
    expect(r.violations.map((v) => v.rule)).toEqual(["function_body_length", "line_length"]);
  });

  it("une entrée mal formée n'invalide pas les autres", () => {
    const r = parseSwiftLintReport(
      [{ file: null, line: 1, severity: "Error", reason: "sans fichier", rule_id: "x" }, ...rapport],
      "/projets/demo",
    );
    expect(r.available).toBe(true);
    expect(r.violations.map((v) => v.rule)).toEqual(["function_body_length", "line_length"]);
  });

  it("un rapport illisible ne fait pas échouer la porte", () => {
    expect(parseSwiftLintReport("pas du json", "/projets/demo")).toEqual({ available: false, violations: [] });
  });
});
