/**
 * Profil de stack déclaratif (J5, O11) : un projet décrit sa chaîne — commandes, emplacements,
 * format de rapport — au lieu qu'un adaptateur soit écrit pour lui.
 *
 * Ce fichier vient du dépôt du projet : son contenu n'est pas digne de confiance. Tout ce qui
 * s'y trouve est validé, et les commandes sont soumises à une liste de programmes autorisés
 * (D47, O12) — sans quoi un dépôt hostile ferait exécuter n'importe quoi.
 */
import { describe, expect, it } from "vitest";
import { parseStackProfile } from "../src/profile/stack-profile.js";

const MINIMAL = `
id: python
detect: [pyproject.toml]
tests:
  command: [pytest, "--junit-xml={rapport}"]
  report: junit-xml
layout:
  acceptanceTests: ["tests/acceptance/**"]
  unitTests: ["tests/**"]
  sources: ["src/**"]
`;

const ok = (yaml: string, programmes = ["pytest", "ruff"]) => {
  const r = parseStackProfile(yaml, { allowedPrograms: programmes });
  if ("error" in r) throw new Error(r.error);
  return r.profile;
};
const erreur = (yaml: string, programmes = ["pytest", "ruff"]) => {
  const r = parseStackProfile(yaml, { allowedPrograms: programmes });
  return "error" in r ? r.error : null;
};

describe("Lecture d'un profil de stack", () => {
  it("lit un profil minimal", () => {
    const p = ok(MINIMAL);
    expect(p.id).toBe("python");
    expect(p.detect).toEqual(["pyproject.toml"]);
    expect(p.tests).toEqual({ command: ["pytest", "--junit-xml={rapport}"], report: "junit-xml" });
    expect(p.layout.unitTests).toEqual(["tests/**"]);
  });

  it("les sections facultatives restent absentes plutôt que devinées", () => {
    const p = ok(MINIMAL);
    expect(p.lint).toBeUndefined();
    expect(p.mutation).toBeUndefined();
    expect(p.infrastructureModules).toEqual([]);
  });

  it("YAML invalide : message clair, pas d'exception", () => {
    expect(erreur("id: [python")).toMatch(/pas un YAML valide/i);
  });

  it("champ obligatoire manquant : le chemin du champ est nommé", () => {
    expect(erreur("id: python\n")).toMatch(/tests/);
    expect(erreur(MINIMAL.replace("id: python", "id: ''"))).toMatch(/id/);
  });

  it("un format de rapport inconnu est refusé", () => {
    // Les lecteurs sont nommés et écrits par nous : un profil ne peut pas en inventer un.
    expect(erreur(MINIMAL.replace("report: junit-xml", "report: mon-format"))).toMatch(/mon-format/);
  });

  it("un programme hors de la liste autorisée est refusé", () => {
    // Le profil vient du dépôt : il pourrait demander n'importe quoi.
    expect(erreur(MINIMAL.replace("pytest", "curl"))).toMatch(/curl/);
    expect(erreur(MINIMAL.replace("pytest", "rm"))).toMatch(/autorisé/i);
  });

  it("le refus dit quels programmes sont autorisés, et d'où vient la liste (09/11)", () => {
    // Sur un autre poste, `uv` refusé sans autre explication : l'utilisateur a corrigé un
    // `admin.json` que le serveur ne lisait pas, et ne pouvait pas le savoir.
    const r = parseStackProfile(MINIMAL.replace("pytest", "uv"), { allowedPrograms: ["pytest", "ruff"], origine: "Liste par défaut : aucun fichier à /etc/agent-studio/admin.json." });
    expect("error" in r && r.error).toBe(
      "Profil de stack refusé : « uv » (tests) n'est pas un programme autorisé. Programmes autorisés : pytest, ruff. Liste par défaut : aucun fichier à /etc/agent-studio/admin.json.",
    );
  });

  it("aucun programme autorisé : le refus le dit plutôt que de citer une liste vide", () => {
    expect(erreur(MINIMAL, [])).toBe("Profil de stack refusé : « pytest » (tests) n'est pas un programme autorisé. Aucun programme n'est autorisé.");
  });

  it("une commande vide est refusée", () => {
    expect(erreur(MINIMAL.replace(/command: \[pytest.*\]/, "command: []"))).toMatch(/command/);
  });

  it("le lint et la mutation suivent les mêmes règles que les tests", () => {
    const avecLint = `${MINIMAL}
lint:
  command: [eslint, --format, json]
  report: eslint-json
`;
    const programmes = ["pytest", "eslint"];
    expect(ok(avecLint, programmes).lint).toEqual({ command: ["eslint", "--format", "json"], report: "eslint-json" });
    expect(erreur(avecLint.replace("eslint, --format", "wget, x"), programmes)).toMatch(/wget/);
  });

  it("les modules d'infrastructure sont déclarés par le projet, jamais devinés", () => {
    const p = ok(`${MINIMAL}\ninfrastructureModules: [django, sqlalchemy]\n`);
    expect(p.infrastructureModules).toEqual(["django", "sqlalchemy"]);
  });
});
