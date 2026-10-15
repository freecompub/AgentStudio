/** Dossier de passation : la recherche transmise à DESIGN et DISTILL (skraft-plugin v1.15.1, docs/15 §5). */
import { describe, expect, it } from "vitest";
import { buildBrief } from "../src/brief.js";
import { initialState } from "../src/reducer.js";
import type { SkraftState } from "../src/model.js";

const base: SkraftState = { ...initialState({ storyPath: "stories/us-12.md" }), slug: "us-12" };
const recherche = { conventions: "Doublures en mémoire pour les dépôts ; tests nommés d'après leur critère.", existant: "- `BolusCalculator` → `src/domain/bolus-calculator.ts`" };

describe("Recherche dans le dossier de passation", () => {
  it.each(["DESIGN", "DISTILL"] as const)("%s : conventions et existant réutilisable, donnés comme acquis", (phase) => {
    const b = buildBrief({ ...base, recherche }, phase, []);
    expect(b).toContain("Recherche (acquise : cite-la plutôt que de refaire l'enquête) :");
    expect(b).toContain("Doublures en mémoire pour les dépôts ; tests nommés d'après leur critère.");
    expect(b).toContain("`BolusCalculator` → `src/domain/bolus-calculator.ts`");
  });

  it("DELIVER : pas de recherche dans le dossier", () => {
    expect(buildBrief({ ...base, recherche }, "DELIVER", [])).not.toContain("Recherche (acquise");
  });

  it("RESEARCH sautée : le dossier le dit, l'agent relève l'existant lui-même", () => {
    expect(buildBrief({ ...base, skipPhases: ["RESEARCH"] }, "DESIGN", [])).toContain(
      "RESEARCH a été sautée : aucun inventaire de l'existant. Relève toi-même, dans le code, les conventions et ce qui peut être réutilisé.",
    );
  });
});
