import { describe, expect, it } from "vitest";
import { checkResearch, extractOpenQuestions, RESEARCH_SECTIONS } from "../src/research.js";

function doc(over: Partial<Record<string, string>> = {}): string {
  const body: Record<string, string> = {
    "Périmètre et critères de succès": "Plafonner la dose proposée.",
    "Fichiers analysés": "- `Sources/Bolus/BolusCalculator.swift:10-30`\n- `Sources/Settings/MaxBolusSetting.swift`",
    "Recherches effectuées": "Documentation XCTest : https://developer.apple.com/documentation/xctest",
    "Conventions du projet": "Objets-valeurs immuables.",
    Découvertes: "Le calcul est fait dans `Sources/Bolus/BolusCalculator.swift:12-20`.",
    "Approches évaluées": "1. Plafond dans le domaine.\n2. Plafond dans l'interface.",
    Recommandation: "Appliquer le plafond dans le domaine.",
    "Passage de relais": "Décisions à valider : emplacement du plafond.\n\n### Questions ouvertes\n- Le plafond est-il affiché au patient ?",
    ...over,
  };
  return ["# Recherche US-12", ...Object.entries(body).map(([h, t]) => `## ${h}\n\n${t}`)].join("\n\n");
}

const files: Record<string, number> = { "Sources/Bolus/BolusCalculator.swift": 55, "Sources/Settings/MaxBolusSetting.swift": 12 };
const index = { lineCount: (p: string) => files[p] ?? null };

describe("Porte citations (SPEC-skraft §7.1, fixtures §13.2)", () => {
  it("document conforme : aucune raison de rejet, questions ouvertes extraites", () => {
    expect(checkResearch(doc(), index)).toEqual({ reasons: [], openQuestions: ["Le plafond est-il affiché au patient ?"] });
  });

  it("citation hors limites : rejet mentionnant la longueur réelle du fichier", () => {
    const r = checkResearch(doc({ Découvertes: "Voir `Sources/Bolus/BolusCalculator.swift:40-72`." }), index);
    expect(r.reasons).toEqual(["`Sources/Bolus/BolusCalculator.swift:40-72` : plage hors du fichier, qui compte 55 lignes."]);
  });

  it("plage inversée, fichier inexistant, URL mal formée", () => {
    const r = checkResearch(
      doc({ Découvertes: "`Sources/Bolus/BolusCalculator.swift:30-10`, `Sources/Bolus/Absent.swift:1-2`, http://pas un lien" }),
      index,
    );
    expect(r.reasons).toEqual([
      "`Sources/Bolus/BolusCalculator.swift:30-10` : plage inversée.",
      "`Sources/Bolus/Absent.swift:1-2` : fichier inexistant dans le dépôt.",
      "URL mal formée : http://pas",
    ]);
  });

  it("section du gabarit manquante", () => {
    const md = doc().replace("## Conventions du projet", "## Autre chose");
    expect(checkResearch(md, index).reasons).toEqual(["Section manquante : « Conventions du projet »."]);
  });

  it("recommandation absente ou multiple", () => {
    expect(checkResearch(doc({ Recommandation: "" }), index).reasons).toEqual(["La recommandation est absente."]);
    expect(checkResearch(doc({ Recommandation: "- Option A\n- Option B" }), index).reasons).toEqual(["Une seule recommandation est attendue (2 trouvées)."]);
  });

  it("les chemins sous .skraft/ et les noms de fichiers sans dossier ne sont pas contrôlés comme citations du code", () => {
    const r = checkResearch(doc({ "Fichiers analysés": "`.skraft/us-12/story.md` et Package.swift" }), index);
    expect(r.reasons).toEqual([]);
  });

  it("gabarit : huit sections", () => {
    expect(RESEARCH_SECTIONS).toHaveLength(8);
  });

  it("questions ouvertes : puces d'une section « Questions ouvertes », ou lignes interrogatives du passage de relais", () => {
    expect(extractOpenQuestions("## Passage de relais\n\nFaut-il un journal ?\n- Plafond par prise ?\n\n### Questions ouvertes\n- Unités en mmol/L ?")).toEqual([
      "Unités en mmol/L ?",
    ]);
    expect(extractOpenQuestions("## Passage de relais\n\nFaut-il un journal ?\nRien d'autre.")).toEqual(["Faut-il un journal ?"]);
  });
});
