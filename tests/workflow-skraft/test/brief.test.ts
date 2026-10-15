// @ts-nocheck — le workflow est en JavaScript, sans types (ADR 0055) : ce test vérifie son comportement, pas ses types.
/** Dossier de passation : la recherche transmise à DESIGN et DISTILL (skraft-plugin v1.15.1, docs/15 §5). */
import { describe, expect, it } from "vitest";
import { buildBrief } from "../../../workflows/skraft/brief.mjs";

const vue = (over = {}) => ({
  story: { id: "US-12", title: "Plafonner", statement: "En tant que patient…", criteria: [{ n: 1, text: "Plafond" }] },
  niveau: "medium-hard", slug: "us-12", phasesFaites: [], phasesSautees: [], adrs: [], questions: [], reponses: [], regressions: [], acceptanceHash: null,
  ...over,
});
const recherche = { conventions: "Doublures en mémoire pour les dépôts ; tests nommés d'après leur critère.", existant: "- `BolusCalculator` → `src/domain/bolus-calculator.ts`" };

describe("Recherche dans le dossier de passation", () => {
  it.each(["DESIGN", "DISTILL"])("%s : conventions et existant réutilisable, donnés comme acquis", (phase) => {
    const b = buildBrief(vue({ recherche }), phase, []);
    expect(b).toContain("Recherche (acquise : cite-la plutôt que de refaire l'enquête) :");
    expect(b).toContain("Doublures en mémoire pour les dépôts ; tests nommés d'après leur critère.");
    expect(b).toContain("`BolusCalculator` → `src/domain/bolus-calculator.ts`");
  });

  it("DELIVER : pas de recherche dans le dossier", () => {
    expect(buildBrief(vue({ recherche }), "DELIVER", [])).not.toContain("Recherche (acquise");
  });

  it("RESEARCH sautée : le dossier le dit, l'agent relève l'existant lui-même", () => {
    expect(buildBrief(vue({ phasesSautees: ["RESEARCH"] }), "DESIGN", [])).toContain(
      "RESEARCH a été sautée : aucun inventaire de l'existant. Relève toi-même, dans le code, les conventions et ce qui peut être réutilisé.",
    );
  });
});
