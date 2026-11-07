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

  it.each(["DESIGN", "DISTILL", "DELIVER"] as const)("%s : la skill d'architecture transmise à l'appel", (phase) => {
    expect(buildBrief({ ...base, architecture: "clean-architecture-java" }, phase, [])).toContain("Architecture du projet : charge la skill `clean-architecture-java`");
  });

  it("RESEARCH : pas de skill d'architecture dans le dossier", () => {
    expect(buildBrief({ ...base, architecture: "clean-architecture-java" }, "RESEARCH", [])).not.toContain("Architecture du projet");
  });
});

describe("Skill d'architecture dans l'état", () => {
  it("résolue dès le lancement ; absente : la clean architecture par défaut", () => {
    expect(initialState({ storyPath: "s.md", archi: "java" }).architecture).toBe("clean-architecture-java");
    expect(initialState({ storyPath: "s.md" }).architecture).toBe("architecture-patterns");
  });
});

/**
 * Réponses humaines citables (décidé le 07/11) : le code les écrit dans `.skraft/<slug>/passation.md`,
 * une par ligne, pour que la porte `citations` accepte qu'un agent s'y réfère. Le 29/09, faute de
 * source citable, l'agent avait reposé cinq fois la même question en DESIGN.
 */
describe("Réponses de l'utilisateur, citables", async () => {
  const { passationMd } = await import("../src/brief.js");
  const reponses = [{ question: "Le plafond est-il par prise ?", answer: "par prise" }, { question: "Arrondi ?", answer: "au dixième (affichage)" }];

  it("passation.md : une réponse par ligne, après un en-tête qui dit comment la citer", () => {
    expect(passationMd("US-12", reponses)).toBe(
      "# Réponses de l'utilisateur — US-12\n\nÉcrites par le code au fil du run, une par ligne : cite-les comme toute autre source (`passation.md:<ligne>`).\n\n- « Le plafond est-il par prise ? » → par prise\n- « Arrondi ? » → au dixième (affichage)\n",
    );
  });

  it("le dossier dit où elles sont écrites ; sans réponse, ni ligne ni fichier", () => {
    const b = buildBrief({ ...base, openQuestions: [{ id: "q1", text: "Le plafond est-il par prise ?", answer: "par prise" }] }, "DESIGN", []);
    expect(b).toContain("Réponses de l'utilisateur (écrites dans `.skraft/us-12/passation.md`, à citer comme source) :");
    expect(buildBrief(base, "DESIGN", [])).not.toContain("passation.md");
  });
});
