/** Contrat de l'outil terminal report_phase : écarts au plan de test (ADR 0067). */
import { describe, expect, it } from "vitest";
import { terminalSchemas } from "../src/agents/terminal-tools.js";

const base = { summary: "test écrit", files: ["test/plafond.test.ts"] };

describe("report_phase : écarts au plan de test", () => {
  it("facultatifs : un compte rendu sans écart reste valide", () => {
    expect(terminalSchemas.report_phase.safeParse(base).success).toBe(true);
  });

  it("un écart porte le critère, le prévu, le réel et la règle qui l'impose", () => {
    const ecart = { criterion: "ac-1", planned: "Application, dépôt en mémoire", actual: "Domaine, aucune", rule: "clean-architecture-testing" };
    expect(terminalSchemas.report_phase.safeParse({ ...base, planDeviations: [ecart] }).success).toBe(true);
    expect(terminalSchemas.report_phase.safeParse({ ...base, planDeviations: [{ ...ecart, rule: "" }] }).success).toBe(false);
  });
});
