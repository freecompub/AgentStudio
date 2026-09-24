import { describe, expect, it } from "vitest";
import { buildBrief } from "../src/brief.js";
import type { TddState } from "../src/model.js";
import { initialState } from "../src/reducer.js";

function state(over: Partial<TddState> = {}): TddState {
  return {
    ...initialState({ feature: "Plafonner le bolus" }),
    steps: [
      { id: "s1", behavior: "dose sous le plafond inchangée", status: "done" },
      { id: "s2", behavior: "dose plafonnée", status: "pending" },
      { id: "s3", behavior: "alerte affichée", status: "pending" },
    ],
    current: 1,
    phase: "RED",
    reports: [{ stepId: "s1", phase: "GREEN", summary: "fonction cap ajoutée", files: ["src/cap.ts"] }],
    ...over,
  };
}

describe("Dossier de passation (§6.6)", () => {
  it("contient tâche, plan avec statuts, étape en cours, travail déjà fait", () => {
    const b = buildBrief(state(), { phase: "RED" });
    expect(b).toContain("Tâche : TDD — Plafonner le bolus");
    expect(b).toContain("[fait] s1 — dose sous le plafond inchangée");
    expect(b).toContain("[en cours] s2 — dose plafonnée");
    expect(b).toContain("[à faire] s3 — alerte affichée");
    expect(b).toContain("Étape en cours : s2 — dose plafonnée (phase rouge : écrire le test)");
    expect(b).toContain("- s1, vert : fonction cap ajoutée (src/cap.ts)");
    expect(b).not.toContain("Rejet précédent");
  });

  it("transmet tel quel le motif du rejet précédent", () => {
    const b = buildBrief(state(), { phase: "RED", feedback: "Aucun nouveau test détecté." });
    expect(b).toContain("Rejet précédent : Aucun nouveau test détecté.");
  });

  it("en phase verte : liste les tests à faire passer", () => {
    const b = buildBrief(state({ phase: "GREEN" }), { phase: "GREEN", testIds: ["tests/cap.test.ts > plafonne"] });
    expect(b).toContain("phase verte : faire passer le test");
    expect(b).toContain("Tests à faire passer : tests/cap.test.ts > plafonne");
  });

  it("n'inclut jamais de transcription d'agent, seulement des résumés", () => {
    const b = buildBrief(state(), { phase: "REFACTOR" });
    expect(b).toContain("phase de nettoyage");
    expect(b.split("\n").length).toBeLessThan(20);
  });
});
