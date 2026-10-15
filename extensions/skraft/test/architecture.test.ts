import { describe, expect, it } from "vitest";
import { ligneArchitecture, skillDArchitecture } from "../src/architecture.js";

describe("Skill d'architecture transmise à l'appel (skills de skraft-plugin v1.15.1)", () => {
  it("absente : la clean architecture par défaut, architecture-patterns", () => {
    expect(skillDArchitecture(undefined)).toEqual({ skill: "architecture-patterns" });
    expect(skillDArchitecture("")).toEqual({ skill: "architecture-patterns" });
  });

  it("par son nom, ou par le seul langage", () => {
    expect(skillDArchitecture("clean-architecture-java")).toEqual({ skill: "clean-architecture-java" });
    expect(skillDArchitecture("java")).toEqual({ skill: "clean-architecture-java" });
    expect(skillDArchitecture("React")).toEqual({ skill: "clean-architecture-react" });
  });

  it("inconnue : la clean architecture par défaut, avec un avertissement", () => {
    expect(skillDArchitecture("cobol")).toEqual({
      skill: "architecture-patterns",
      avertissement: "Skill d'architecture « cobol » inconnue : skraft utilise la clean architecture par défaut (architecture-patterns). Connues : clean-architecture-dotnet, clean-architecture-java, clean-architecture-python, clean-architecture-react.",
    });
  });

  it("ligne du dossier de passation", () => {
    expect(ligneArchitecture("clean-architecture-java")).toBe("Architecture du projet : charge la skill `clean-architecture-java` ; ses règles de couches sont celles de `architecture-patterns`.");
    expect(ligneArchitecture("architecture-patterns")).toBe("Architecture du projet : clean architecture par défaut, skill `architecture-patterns`.");
  });
});
