import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyFailure, parseVitestReport } from "../src/typescript/vitest-report.js";

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/vitest-report.json"), "utf8"));

describe("parseVitestReport", () => {
  const results = parseVitestReport(fixture, "/projet");
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));

  it("identifie chaque test par fichier relatif et titre complet", () => {
    expect(Object.keys(byId).sort()).toEqual([
      "tests/bolus.test.ts > cap assertion",
      "tests/bolus.test.ts > cap ignoré",
      "tests/bolus.test.ts > cap passe",
      "tests/bolus.test.ts > cap symbole",
      "tests/missing.test.ts",
      "tests/syntax.test.ts",
    ]);
  });

  it("statuts : passé, échoué, ignoré", () => {
    expect(byId["tests/bolus.test.ts > cap passe"]).toMatchObject({ status: "passed", file: "tests/bolus.test.ts" });
    expect(byId["tests/bolus.test.ts > cap ignoré"]?.status).toBe("skipped");
  });

  it("échec sur assertion", () => {
    expect(byId["tests/bolus.test.ts > cap assertion"]).toMatchObject({ status: "failed", failureKind: "assertion" });
  });

  it("symbole manquant : fonction non définie ou module introuvable", () => {
    expect(byId["tests/bolus.test.ts > cap symbole"]?.failureKind).toBe("missing_symbol");
    expect(byId["tests/missing.test.ts"]).toMatchObject({ status: "failed", failureKind: "missing_symbol" });
  });

  it("erreur de syntaxe : autre erreur (mauvaise raison d'échouer)", () => {
    expect(byId["tests/syntax.test.ts"]).toMatchObject({ status: "failed", failureKind: "other_error" });
  });

  it("rejette un rapport illisible", () => {
    expect(() => parseVitestReport({ nope: true }, "/projet")).toThrow(/Rapport de tests illisible/);
  });
});

describe("classifyFailure", () => {
  it.each([
    ["AssertionError: expected 10 to be 11", "assertion"],
    ["Error: expect(received).toBe(expected)\n\nExpected: 1\nReceived: 2", "assertion"],
    ["ReferenceError: notThere is not defined", "missing_symbol"],
    ["TypeError: cap is not a function", "missing_symbol"],
    ["TypeError: Bolus is not a constructor", "missing_symbol"],
    ["Cannot find module '../src/alert' imported from x", "missing_symbol"],
    ["Failed to load url ../src/alert (resolved id: ../src/alert)", "missing_symbol"],
    ["SyntaxError: The requested module './a' does not provide an export named 'b'", "missing_symbol"],
    ["TypeError: Cannot read properties of undefined (reading 'x')", "other_error"],
    ["Transform failed with 1 error: Unexpected token", "other_error"],
    ["", "other_error"],
  ] as const)("%s → %s", (msg, kind) => {
    expect(classifyFailure(msg)).toBe(kind);
  });
});
