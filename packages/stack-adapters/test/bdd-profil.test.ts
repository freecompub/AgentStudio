/**
 * BDD décidé par composant (ADR 0074, partie 2) : le TDD toujours, le BDD au choix. `bdd` absent ou
 * `false` : comme avant. Une liste de couples `{ lanceur, features, etapes }` : les `.feature` du
 * projet sont les tests d'acceptance ; leurs dossiers rejoignent les emplacements des tests
 * d'acceptance, que le gel de DISTILL couvre déjà.
 */
import { describe, expect, it } from "vitest";
import { createComposedAdapter } from "../src/composants.js";
import { createProfileAdapter } from "../src/profile/profile-adapter.js";
import { parseStackProfile } from "../src/profile/stack-profile.js";

const PROFIL = (bdd: string) => `
id: dotnet
detect: [Tarification.sln]
tests:
  command: [dotnet, test]
  report: junit-xml
layout:
  acceptanceTests: ["tests/Tarification.Tests/**"]
  unitTests: ["tests/**"]
  sources: ["src/**"]
${bdd}`;
const lire = (bdd: string) => parseStackProfile(PROFIL(bdd), { allowedPrograms: ["dotnet"] });
const adaptateur = (bdd: string) => {
  const r = lire(bdd);
  if ("error" in r) throw new Error(r.error);
  return createProfileAdapter(r.profile);
};
const REQNROLL = "bdd:\n  - lanceur: reqnroll\n    features: tests/Tarification.UnitTests/Features\n    etapes: tests/Tarification.UnitTests/Steps\n";

describe("BDD dans le profil de pile (ADR 0074)", () => {
  it("absent ou false : pas de BDD, emplacements inchangés", () => {
    expect(adaptateur("").bdd).toBeUndefined();
    expect(adaptateur("bdd: false\n").bdd).toBeUndefined();
    expect(adaptateur("bdd: false\n").layout.acceptanceTests).toEqual(["tests/Tarification.Tests/**"]);
  });

  // Décision du 08/11 : `bdd: false` est un choix déclaré, `bdd` absent n'est rien décidé. skraft refuse
  // de démarrer quand un composant non décidé montre des signes de BDD.
  it("`bdd` décidé ou non : les racines des composants dont la pile n'en dit rien", () => {
    expect(adaptateur("").bddNonDecide).toEqual(["."]);
    expect(adaptateur("bdd: false\n").bddNonDecide).toEqual([]);
    expect(adaptateur(REQNROLL).bddNonDecide).toEqual([]);
    const r = lire("bdd: false\n");
    expect("error" in r ? r.error : r.profile.bdd).toEqual([]);
  });

  it("composants : chaque racine non décidée, ramenée à la racine du projet", () => {
    const c = createComposedAdapter([
      { nom: "api", racine: "services/api", adapter: adaptateur("") },
      { nom: "web", racine: "web", adapter: adaptateur("bdd: false\n") },
      { nom: "principal", racine: ".", adapter: adaptateur("") },
    ]);
    expect(c.bddNonDecide).toEqual(["services/api", "."]);
  });

  it("un couple : exposé, et ses dossiers rejoignent les emplacements des tests d'acceptance", () => {
    const a = adaptateur(REQNROLL);
    expect(a.bdd).toEqual([{ lanceur: "reqnroll", features: "tests/Tarification.UnitTests/Features", etapes: "tests/Tarification.UnitTests/Steps" }]);
    expect(a.layout.acceptanceTests).toEqual(["tests/Tarification.Tests/**", "tests/Tarification.UnitTests/Features/**", "tests/Tarification.UnitTests/Steps/**"]);
    expect(a.isTestFile("tests/Tarification.UnitTests/Features/panier.feature")).toBe(true);
  });

  it("lanceur inconnu, `bdd: true` sans dossiers, chemin absolu ou qui remonte, couple incomplet : refusé", () => {
    expect(lire("bdd:\n  - { lanceur: inconnu, features: f, etapes: e }\n")).toEqual({ error: expect.stringMatching(/bdd\.0\.lanceur/) });
    expect(lire("bdd: true\n")).toEqual({ error: expect.stringMatching(/bdd/) });
    expect(lire("bdd:\n  - { lanceur: reqnroll, features: /abs, etapes: e }\n")).toEqual({ error: expect.stringMatching(/bdd\.0\.features/) });
    expect(lire("bdd:\n  - { lanceur: reqnroll, features: f, etapes: ../e }\n")).toEqual({ error: expect.stringMatching(/bdd\.0\.etapes/) });
    expect(lire("bdd:\n  - { lanceur: reqnroll, features: f }\n")).toEqual({ error: expect.stringMatching(/bdd\.0\.etapes/) });
  });

  it("composants : les couples sont ramenés à la racine du projet", () => {
    const c = createComposedAdapter([{ nom: "api", racine: "services/api", adapter: adaptateur(REQNROLL) }, { nom: "web", racine: "web", adapter: adaptateur("") }]);
    expect(c.bdd).toEqual([{ lanceur: "reqnroll", features: "services/api/tests/Tarification.UnitTests/Features", etapes: "services/api/tests/Tarification.UnitTests/Steps" }]);
    expect(createComposedAdapter([{ nom: "web", racine: "web", adapter: adaptateur("") }]).bdd).toBeUndefined();
  });
});
