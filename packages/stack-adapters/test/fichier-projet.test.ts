/**
 * Un seul fichier de projet (ADR 0071) : `.agent-studio/projet.yaml`, section `pile` (comment lancer
 * les outils) et section `qualite` (ce qui est exigé), chacune validée selon ses règles. Les anciens
 * fichiers restent lus pendant la transition, avec un avertissement.
 */
import { describe, expect, it } from "vitest";
import { ecrirePileDansProjet, lireFichierProjet } from "../src/profile/fichier-projet.js";
import { parseQualityBar } from "../src/profile/quality-bar.js";

const PROJET = `
pile:
  id: dotnet
  detect: [Tarification.sln]
qualite:
  couverture:
    reste: 70
`;

describe("lireFichierProjet", () => {
  it("rend chaque section, en YAML, pour son propre validateur ; une section absente est absente", () => {
    const r = lireFichierProjet(PROJET);
    if ("error" in r) throw new Error(r.error);
    expect(r.pile).toMatch(/id: dotnet/);
    expect(r.qualite).toMatch(/reste: 70/);
    const seule = lireFichierProjet("qualite:\n  couverture:\n    reste: 50\n");
    expect(seule).toEqual({ qualite: expect.stringMatching(/reste: 50/) });
    expect(lireFichierProjet("")).toEqual({});
  });

  it("une clé de premier niveau inconnue, ou un YAML invalide, est refusé avec le fichier et la clé", () => {
    expect(lireFichierProjet("pile: {}\nqualité: {}\n")).toEqual({ error: expect.stringMatching(/\.agent-studio\/projet\.yaml.*« qualité ».*pile, qualite/s) });
    expect(lireFichierProjet("pile: [\n")).toEqual({ error: expect.stringMatching(/\.agent-studio\/projet\.yaml.*YAML/) });
    expect(lireFichierProjet("- a\n")).toEqual({ error: expect.stringMatching(/\.agent-studio\/projet\.yaml/) });
  });
});

describe("parseQualityBar et projet.yaml (ADR 0071)", () => {
  it("la barre vient de la section qualite de projet.yaml ; une erreur nomme le fichier et la section", () => {
    const r = parseQualityBar({ projet: PROJET });
    if ("error" in r) throw new Error(r.error);
    expect(r.source).toBe(".agent-studio/projet.yaml");
    expect(r.bar.coverage).toEqual({ rest: 70 });
    expect(r.warnings).toEqual([]);
    expect(parseQualityBar({ projet: "qualite:\n  couverture:\n    reste: 120\n" })).toEqual({ error: expect.stringMatching(/\.agent-studio\/projet\.yaml.*section qualite/) });
  });

  it("projet.yaml fait foi : les anciens fichiers sont ignorés, et c'est dit s'ils sont encore là", () => {
    const r = parseQualityBar({ projet: PROJET, yaml: "couverture:\n  reste: 10\n", legacyJson: "{}" });
    if ("error" in r) throw new Error(r.error);
    expect(r.bar.coverage).toEqual({ rest: 70 });
    expect(r.warnings).toEqual([expect.stringMatching(/quality\.yaml.*\.skraft\/quality\.json.*ignorés.*projet\.yaml/s)]);
  });

  it("projet.yaml sans section qualite : valeurs par défaut", () => {
    const r = parseQualityBar({ projet: "pile:\n  id: x\n" });
    if ("error" in r) throw new Error(r.error);
    expect(r.source).toBe(".agent-studio/projet.yaml");
    expect(r.bar.coverage).toEqual({});
  });

  it("sans projet.yaml, quality.yaml est encore lu, avec un avertissement qui dit de le regrouper", () => {
    const r = parseQualityBar({ yaml: "couverture:\n  reste: 50\n" });
    if ("error" in r) throw new Error(r.error);
    expect(r.source).toBe(".agent-studio/quality.yaml");
    expect(r.warnings).toEqual([expect.stringMatching(/regroupe.*projet\.yaml.*section qualite/s)]);
  });
});

describe("ecrirePileDansProjet (`/stack init`, ADR 0071)", () => {
  const PILE = "id: python\ndetect: [pyproject.toml]\n";

  it("sans fichier : un projet.yaml qui n'a que la section pile", () => {
    const r = ecrirePileDansProjet(null, PILE);
    if (typeof r !== "string") throw new Error(r.error);
    expect(lireFichierProjet(r)).toEqual({ pile: expect.stringMatching(/id: python/) });
  });

  it("fichier existant : la section pile est ajoutée ou remplacée ; la section qualite et ses commentaires restent", () => {
    const existant = "# Barre décidée par l'équipe\nqualite:\n  couverture:\n    reste: 70 # minimum\npile:\n  id: ancienne\n";
    const r = ecrirePileDansProjet(existant, PILE);
    if (typeof r !== "string") throw new Error(r.error);
    expect(r).toContain("# Barre décidée par l'équipe");
    expect(r).toContain("reste: 70 # minimum");
    expect(r).toMatch(/pile:\n\s+id: python/);
    expect(r).not.toContain("ancienne");
  });

  it("fichier existant illisible : rien n'est écrit, l'erreur dit pourquoi", () => {
    expect(ecrirePileDansProjet("qualite: [\n", PILE)).toEqual({ error: expect.stringMatching(/projet\.yaml.*YAML/) });
  });
});
