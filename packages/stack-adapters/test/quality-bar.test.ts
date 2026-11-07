/**
 * Barre de qualité du projet (ADR 0049) : `.agent-studio/quality.yaml`, décidée par l'utilisateur,
 * commune aux extensions. Elle dit CE QUI est exigé ; `stack.yaml` dit COMMENT lancer les outils.
 */
import { describe, expect, it } from "vitest";
import { coreFilesMissing, layerOf, parseQualityBar } from "../src/profile/quality-bar.js";

const YAML = `
coeur:
  domaine: ["src/Tarification.Domaine/**"]
  application: ["src/Tarification.Application/**"]
couverture:
  domaine: 100
  application: 90
  reste: 70
mutation:
  active: true
  domaine: 100
  application: 90
  reste: 80
  moment: fin-de-phase
dependances:
  - module: Tarification.Domaine
    interdits: [Tarification.Application, System.Data]
`;

describe("parseQualityBar", () => {
  it("lit la barre déclarée par l'utilisateur", () => {
    const r = parseQualityBar({ yaml: YAML });
    if ("error" in r) throw new Error(r.error);
    expect(r.source).toBe(".agent-studio/quality.yaml");
    expect(r.bar).toEqual({
      core: { domain: ["src/Tarification.Domaine/**"], application: ["src/Tarification.Application/**"] },
      coverage: { domain: 100, application: 90, rest: 70 },
      mutation: { active: true, domain: 100, application: 90, rest: 80, moment: "phase-end" },
      dependencyRules: [{ module: "Tarification.Domaine", forbidden: ["Tarification.Application", "System.Data"] }],
    });
  });

  it("sans fichier : aucune couverture exigée, mutation active aux seuils par défaut, cœur reconnu aux noms usuels", () => {
    const r = parseQualityBar({});
    if ("error" in r) throw new Error(r.error);
    expect(r.source).toBe("défaut");
    expect(r.bar.coverage).toEqual({});
    expect(r.bar.mutation).toEqual({ active: true, domain: 100, application: 100, rest: 90, moment: "phase-end" });
    // Le nom en français et préfixé du projet d'essai fait partie des noms usuels reconnus.
    expect(layerOf("src/Tarification.Domaine/Montant.cs", r.bar)).toBe("domain");
    expect(layerOf("src/domain/bolus.ts", r.bar)).toBe("domain");
    expect(layerOf("src/Tarification.Application/CalculDuPanier.cs", r.bar)).toBe("application");
    expect(layerOf("src/Infra/Db.cs", r.bar)).toBe("rest");
  });

  it("chaque seuil est facultatif ; la mutation peut être désactivée", () => {
    const r = parseQualityBar({ yaml: "couverture:\n  domaine: 95\nmutation:\n  active: false\n" });
    if ("error" in r) throw new Error(r.error);
    expect(r.bar.coverage).toEqual({ domain: 95 });
    expect(r.bar.mutation.active).toBe(false);
  });

  it("une clé inconnue ou un seuil hors de 0 à 100 est refusé et nommé, jamais ignoré", () => {
    expect(parseQualityBar({ yaml: "couverture:\n  domain: 90\n" })).toEqual({ error: expect.stringMatching(/quality\.yaml.*domain/) });
    expect(parseQualityBar({ yaml: "couverture:\n  domaine: 120\n" })).toEqual({ error: expect.stringMatching(/couverture\.domaine/) });
    expect(parseQualityBar({ yaml: "mutation:\n  moment: parfois\n" })).toEqual({ error: expect.stringMatching(/mutation\.moment/) });
    expect(parseQualityBar({ yaml: "coeur: [pas, une, table]" })).toEqual({ error: expect.stringMatching(/coeur/) });
    expect(parseQualityBar({ yaml: "a: [" })).toEqual({ error: expect.stringMatching(/YAML/) });
  });

  it("ancien emplacement .skraft/quality.json : relu, converti, avec un avertissement", () => {
    const legacy = JSON.stringify({ coverage: { core: 90, edge: 70 }, mutation: { coreLayers: ["Domain", "Application"], core: 100, edge: 90 }, dependencyRules: [] });
    const r = parseQualityBar({ legacyJson: legacy });
    if ("error" in r) throw new Error(r.error);
    expect(r.source).toBe(".skraft/quality.json");
    expect(r.warnings).toEqual([expect.stringMatching(/ancien emplacement.*\.agent-studio\/projet\.yaml/)]);
    expect(r.bar.coverage).toEqual({ domain: 90, application: 90, rest: 70 });
    expect(r.bar.mutation).toMatchObject({ domain: 100, application: 100, rest: 90 });
    expect(layerOf("src/Domain/A.cs", r.bar)).toBe("domain");
  });

  it("le nouveau fichier l'emporte sur l'ancien", () => {
    const r = parseQualityBar({ yaml: "couverture:\n  reste: 50\n", legacyJson: JSON.stringify({ coverage: { edge: 99 } }) });
    if ("error" in r) throw new Error(r.error);
    expect(r.bar.coverage).toEqual({ rest: 50 });
  });
});

describe("coreFilesMissing", () => {
  it("signale une couche du cœur déclarée qui ne correspond à aucun fichier, au lieu d'appliquer le seuil du reste en silence", () => {
    // Le 03/10 : `Montant.cs`, dans le domaine, est passé au seuil du reste (70 %) au lieu de 90 %.
    const r = parseQualityBar({ yaml: 'coeur:\n  domaine: ["src/Domain/**"]\n  application: ["src/Tarification.Application/**"]\n' });
    if ("error" in r) throw new Error(r.error);
    const files = ["src/Tarification.Domaine/Montant.cs", "src/Tarification.Application/CalculDuPanier.cs"];
    expect(coreFilesMissing(r.bar, files)).toEqual(["domaine"]);
  });
});
