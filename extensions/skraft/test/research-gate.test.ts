import { describe, expect, it } from "vitest";
import { checkResearch, extractOpenQuestions, extraireInventaire, RESEARCH_SECTIONS } from "../src/research.js";

function doc(over: Partial<Record<string, string>> = {}): string {
  const body: Record<string, string> = {
    "Périmètre et critères de succès": "Plafonner la dose proposée.",
    "Fichiers analysés": "- `Sources/Bolus/BolusCalculator.swift:10-30`\n- `Sources/Settings/MaxBolusSetting.swift`",
    "Recherches effectuées": "Documentation XCTest : https://developer.apple.com/documentation/xctest",
    "Conventions du projet": "Objets-valeurs immuables ; tests XCTest nommés d'après leur critère.",
    Découvertes: "Le calcul est fait dans `Sources/Bolus/BolusCalculator.swift:12-20`.",
    "Approches évaluées": "1. Plafond dans le domaine.\n2. Plafond dans l'interface.",
    Recommandation: "Appliquer le plafond dans le domaine.",
    "Passage de relais": "Décisions à valider : emplacement du plafond.\n\n### Existant réutilisable\n- `BolusCalculator` → `Sources/Bolus/BolusCalculator.swift`\n\n### Questions ouvertes\n- Le plafond est-il affiché au patient ?",
    ...over,
  };
  return ["# Recherche US-12", ...Object.entries(body).map(([h, t]) => `## ${h}\n\n${t}`)].join("\n\n");
}

const files: Record<string, number> = { "Sources/Bolus/BolusCalculator.swift": 55, "Sources/Settings/MaxBolusSetting.swift": 12, "Package.swift": 20 };
const contenus: Record<string, string> = { "Sources/Bolus/BolusCalculator.swift": "struct BolusCalculator {}", "Sources/Settings/MaxBolusSetting.swift": "struct MaxBolusSetting {}" };
const index = { lineCount: (p: string) => files[p] ?? null, contains: (p: string, nom: string) => (contenus[p] ?? "").includes(nom) };

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

describe("Inventaire de l'existant dans la recherche (skraft-plugin v1.15.1, solution-researcher)", () => {
  // v1.15.1 ajoute au gabarit l'existant réutilisable dans « Handoff to DESIGN » ; le code vérifie
  // qu'un élément inventorié existe dans le fichier qu'il cite. Les commandes de build et de test
  // qu'il ajoute aussi ne sont pas reprises : chez nous, l'adaptateur de pile en est l'autorité.
  it("conventions sans fichier cité : acceptées, les commandes de test viennent de l'adaptateur de pile, pas de la recherche", () => {
    expect(checkResearch(doc({ "Conventions du projet": "Objets-valeurs immuables ; doublures en mémoire pour les dépôts." }), index).reasons).toEqual([]);
  });

  it("passage de relais sans inventaire de l'existant : rejet ; « aucun » est accepté", () => {
    const sans = "Décisions à valider : emplacement du plafond.\n\n### Questions ouvertes\n- Le plafond est-il affiché au patient ?";
    expect(checkResearch(doc({ "Passage de relais": sans }), index).reasons).toEqual([
      "Passage de relais : sous-section « Existant réutilisable » absente (une ligne « `Nom` → `chemin` » par élément, ou « aucun »).",
    ]);
    const aucun = "Décisions à valider.\n\n### Existant réutilisable\n- aucun : projet vierge.\n";
    expect(checkResearch(doc({ "Passage de relais": aucun }), index).reasons).toEqual([]);
  });

  it("un élément inventorié absent du fichier cité, ou un fichier inexistant : rejet", () => {
    const relais = "Décisions.\n\n### Existant réutilisable\n- `DoseLimiter` → `Sources/Bolus/BolusCalculator.swift`\n- `CapPolicy` → `Sources/Bolus/CapPolicy.swift`\n";
    expect(checkResearch(doc({ "Passage de relais": relais }), index).reasons).toEqual([
      "`Sources/Bolus/CapPolicy.swift` : fichier inexistant dans le dépôt.",
      "Existant réutilisable : `DoseLimiter` n'apparaît pas dans `Sources/Bolus/BolusCalculator.swift`.",
      "Existant réutilisable : `CapPolicy` → `Sources/Bolus/CapPolicy.swift` : fichier inexistant.",
    ]);
  });
});

describe("Inventaire transmis à DESIGN et DISTILL", () => {
  it("le code extrait les conventions et l'existant réutilisable du document validé", () => {
    expect(extraireInventaire(doc())).toEqual({
      conventions: "Objets-valeurs immuables ; tests XCTest nommés d'après leur critère.",
      existant: "- `BolusCalculator` → `Sources/Bolus/BolusCalculator.swift`",
    });
  });
});
