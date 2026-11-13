// @ts-nocheck — le workflow est en JavaScript, sans types (ADR 0055) : ce test vérifie son comportement, pas ses types.
/** L'outil `verifier_scenarios` montre aussi les avertissements de la porte des valeurs (ADR 0090). */
import { describe, expect, it } from "vitest";
import { texteDeVerification } from "../../../workflows/skraft/distillation.mjs";

describe("réponse de verifier_scenarios", () => {
  const avertissements = ["La valeur « 12,5 U » du critère 2 n'apparaît pas dans le scénario @ac-2 (f.feature)."];
  it("sans motif : accepté, et les avertissements suivent, dits non bloquants", () => {
    const t = texteDeVerification({ motifs: [], porte: "", avertissements });
    expect(t).toMatch(/^Aucun motif/);
    expect(t).toContain("Avertissements non bloquants de la porte des valeurs");
    expect(t).toContain("- La valeur « 12,5 U »");
  });
  it("avec un motif : le refus d'abord, puis les avertissements ; sans avertissement, rien de plus", () => {
    const t = texteDeVerification({ motifs: ["Plan de test absent"], porte: "plan de test", avertissements });
    expect(t.indexOf("refuserait")).toBeLessThan(t.indexOf("Avertissements"));
    expect(texteDeVerification({ motifs: [], porte: "" })).not.toContain("Avertissements");
  });
});
