/**
 * Détection du BDD d'un composant (ADR 0074 §2.5) : un lanceur nommé dans un manifeste, un dossier qui
 * contient des `.feature`, un dossier d'étapes. Pure : elle reçoit les fichiers et les manifestes lus,
 * et ne devine rien — un couple complet est proposé, une moitié est signalée à compléter.
 */
import { describe, expect, it } from "vitest";
import { bddNonDeclare, blocBdd, detecterBdd } from "../src/profile/detection-bdd.js";
import { diagnoseProfile, proposeProfile } from "../src/profile/stack-doctor.js";
import { parseStackProfile } from "../src/profile/stack-profile.js";

const csproj = (paquets: string[]) => ({ path: "tests/Tarif.UnitTests/Tarif.UnitTests.csproj", content: `<Project>${paquets.map((p) => `<PackageReference Include="${p}" Version="3.3.4" />`).join("")}</Project>` });

describe("detecterBdd", () => {
  it("couple complet : lanceur du manifeste, dossier des .feature, dossier des étapes (le projet BDD d'exemple-dotnet-tdd)", () => {
    const d = detecterBdd({
      fichiers: ["tests/Tarif.UnitTests/Features/panier.feature", "tests/Tarif.UnitTests/Steps/PanierSteps.cs", "src/Tarif/Panier.cs"],
      manifestes: [csproj(["xunit", "Reqnroll.xUnit"])],
    });
    expect(d).toEqual({ lanceur: "reqnroll", features: "tests/Tarif.UnitTests/Features", etapes: "tests/Tarif.UnitTests/Steps" });
  });

  it("les .feature dispersés : leur dossier parent commun", () => {
    const d = detecterBdd({ fichiers: ["features/panier/a.feature", "features/remise/b.feature"], manifestes: [] });
    expect(d.features).toBe("features");
  });

  it("noms d'étapes reconnus sans casse : steps, stepdefinitions, step_definitions, bindings, glue", () => {
    for (const nom of ["steps", "StepDefinitions", "step_definitions", "Bindings", "glue"])
      expect(detecterBdd({ fichiers: [`tests/${nom}/a.ts`], manifestes: [] }).etapes).toBe(`tests/${nom}`);
  });

  it("plusieurs dossiers d'étapes, ou plusieurs lanceurs : aucun n'est choisi, on ne devine pas", () => {
    expect(detecterBdd({ fichiers: ["a/steps/x.ts", "b/steps/y.ts"], manifestes: [] }).etapes).toBeUndefined();
    const deux = { path: "package.json", content: '{"devDependencies":{"@cucumber/cucumber":"10","jest-cucumber":"4"}}' };
    expect(detecterBdd({ fichiers: [], manifestes: [deux] }).lanceur).toBeUndefined();
  });

  it("les dossiers de dépendances et cachés sont écartés", () => {
    expect(detecterBdd({ fichiers: ["node_modules/x/steps/a.js", "node_modules/x/a.feature", ".git/steps/b"], manifestes: [] })).toEqual({});
  });

  it("une marque se lit comme un nom entier : « behaves » n'est pas behave", () => {
    expect(detecterBdd({ fichiers: [], manifestes: [{ path: "requirements.txt", content: "behaves==1.0\n" }] }).lanceur).toBeUndefined();
    expect(detecterBdd({ fichiers: [], manifestes: [{ path: "requirements.txt", content: "behave==1.2.6\n" }] }).lanceur).toBe("behave");
    expect(detecterBdd({ fichiers: [], manifestes: [{ path: "pyproject.toml", content: 'dependencies = ["pytest-bdd>=7"]' }] }).lanceur).toBe("pytest-bdd");
  });
});

describe("blocBdd — ce que /stack init ajoute au profil proposé", () => {
  const PROFIL = proposeProfile({ fichiers: ["package.json"], dependances: ["vitest"] })!;

  it("couple complet : une section `bdd` que le profil accepte", () => {
    const bloc = blocBdd({ lanceur: "cucumber-js", features: "features", etapes: "features/steps" });
    const r = parseStackProfile(`${PROFIL}${bloc}`, { allowedPrograms: ["npx", "vitest", "eslint"] });
    expect("error" in r ? r.error : r.profile.bdd).toEqual([{ lanceur: "cucumber-js", features: "features", etapes: "features/steps" }]);
  });

  it("une moitié : un commentaire qui dit ce qui est trouvé et ce qui manque, sans rien écrire de deviné", () => {
    const bloc = blocBdd({ lanceur: "reqnroll", features: "tests/Features" });
    expect(bloc).toBe("# bdd (ADR 0074) : à compléter. Trouvé : lanceur reqnroll, dossier des .feature tests/Features. Introuvable : dossier des étapes.\n");
    const r = parseStackProfile(`${PROFIL}${bloc}`, { allowedPrograms: ["npx", "vitest", "eslint"] });
    expect("error" in r ? r.error : r.profile.bdd).toBeUndefined();
  });

  it("rien : rien n'est ajouté, et sans section `bdd` le composant n'est pas en BDD", () => {
    expect(blocBdd({})).toBe("");
  });
});

describe("diagnoseProfile — le BDD déclaré", () => {
  const profil = (() => {
    const r = parseStackProfile(
      `id: dotnet
detect: [x.sln]
tests: { command: [dotnet, test, "{rapport}"], report: junit-xml }
layout: { acceptanceTests: [], unitTests: ["tests/**"], sources: ["src/**"] }
infrastructureModules: []
bdd:
  - { lanceur: reqnroll, features: tests/A/Features, etapes: tests/A/Steps }
`,
      { allowedPrograms: ["dotnet"] },
    );
    if ("error" in r) throw new Error(r.error);
    return r.profile;
  })();
  const base = { programmeTrouvable: () => true, fichiersDeDetectionPresents: true };

  it("dossiers présents et lanceur dans un manifeste : constats favorables", () => {
    const c = diagnoseProfile(profil, { ...base, cheminExiste: () => true, manifestes: [csproj(["Reqnroll.xUnit"])] });
    expect(c.filter((x) => /BDD/.test(x.message)).map((x) => x.gravite)).toEqual(["ok", "ok", "ok"]);
  });

  it("aucun .feature, pas de dossier d'étapes, lanceur absent des manifestes : chacun est dit", () => {
    const c = diagnoseProfile(profil, { ...base, cheminExiste: (g) => !g.startsWith("tests/A/"), manifestes: [csproj(["xunit"])] });
    const bdd = c.filter((x) => /BDD/.test(x.message));
    expect(bdd.map((x) => x.gravite)).toEqual(["avertissement", "avertissement", "avertissement"]);
    expect(bdd.map((x) => x.message).join("\n")).toMatch(/tests\/A\/Features[\s\S]*tests\/A\/Steps[\s\S]*reqnroll/);
  });

  it("sans manifestes lus, le lanceur n'est pas vérifié plutôt que déclaré absent", () => {
    const c = diagnoseProfile(profil, { ...base, cheminExiste: () => true });
    expect(c.filter((x) => /BDD/.test(x.message))).toHaveLength(2);
  });
});

/**
 * Au démarrage de skraft (08/11) : un composant dont la pile ne dit rien du BDD, mais qui en montre les
 * signes, doit le déclarer — sinon le run part dans le mauvais mode sans que personne le sache.
 */
describe("bddNonDeclare — les composants muets qui montrent des signes de BDD", () => {
  const cucumber = { path: "web/package.json", content: '{"devDependencies":{"@cucumber/cucumber":"10"}}' };

  it("signes trouvés sous une racine non décidée : un motif qui dit ce qui est vu et comment déclarer", () => {
    expect(bddNonDeclare(["web"], ["web/features/a.feature", "web/src/a.ts"], [cucumber])).toEqual([
      "Composant `web` : sa pile ne dit rien du BDD, mais il en montre les signes (lanceur cucumber-js cité par `web/package.json` ; des `.feature` dans `web/features`). Déclare `bdd` dans sa pile (`lanceur`, `features`, `etapes`), ou `bdd: false` s'il ne fait pas de BDD ; `/stack init` peut le proposer.",
    ]);
  });

  it("la racine du projet est nommée « le projet »", () => {
    expect(bddNonDeclare(["."], ["features/a.feature"], [])[0]).toMatch(/^Le projet : sa pile ne dit rien du BDD, mais il en montre les signes \(des `\.feature` dans `features`\)/);
  });

  it("aucun signe, ou seulement un dossier `steps` : rien à dire", () => {
    expect(bddNonDeclare(["."], ["src/a.ts", "tests/steps/a.ts"], [{ path: "package.json", content: '{"devDependencies":{"vitest":"4"}}' }])).toEqual([]);
  });

  it("seules les racines non décidées sont regardées", () => {
    expect(bddNonDeclare([], ["features/a.feature"], [])).toEqual([]);
    expect(bddNonDeclare(["api"], ["web/features/a.feature"], [cucumber])).toEqual([]);
  });
});
