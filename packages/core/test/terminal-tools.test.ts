/** Contrat de l'outil terminal report_phase : écarts au plan de test (ADR 0067). */
import { describe, expect, it } from "vitest";
import { terminalSchemas } from "../src/agents/terminal-tools.js";

const base = { summary: "test écrit", files: ["test/plafond.test.ts"] };

describe("report_phase : écarts au plan de test", () => {
  it("facultatifs : un compte rendu sans écart reste valide", () => {
    expect(terminalSchemas.report_phase.safeParse(base).success).toBe(true);
  });

  it("un écart porte le critère, le prévu, le réel et la règle qui l'impose", () => {
    const ecart = { criterion: "ac-1", planned: "Application, dépôt en mémoire", actual: "Domaine, aucune", rule: "clean-architecture-testing" };
    expect(terminalSchemas.report_phase.safeParse({ ...base, planDeviations: [ecart] }).success).toBe(true);
    expect(terminalSchemas.report_phase.safeParse({ ...base, planDeviations: [{ ...ecart, rule: "" }] }).success).toBe(false);
  });
});

// L'architecte qui décide signale les défauts du modèle au lieu de le corriger lui-même : le code
// relance son auteur avec ces remarques (11/11).
describe("report_phase : défauts du modèle signalés", () => {
  it("facultatifs ; chacun est une remarque non vide", () => {
    expect(terminalSchemas.report_phase.safeParse({ ...base, modelDefects: ["`BolusCap` manque au modèle de domaine."] }).success).toBe(true);
    expect(terminalSchemas.report_phase.safeParse({ ...base, modelDefects: [""] }).success).toBe(false);
  });
});

describe("submit_lens_verdict : contrat de défaut enrichi", () => {
  const defaut = { severity: "major", target: "code", file: "src/a.ts", line: 3, description: "Nom flou.", severityReason: "Le nom cache la règle métier du plafond." };
  const verdict = (d: object) => ({ lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [d] });

  it("chaque défaut dit pourquoi il a cette gravité ; sans raison, le verdict est refusé", () => {
    expect(terminalSchemas.submit_lens_verdict.safeParse(verdict(defaut)).success).toBe(true);
    const { severityReason: _, ...sansRaison } = defaut;
    expect(terminalSchemas.submit_lens_verdict.safeParse(verdict(sansRaison)).success).toBe(false);
    expect(terminalSchemas.submit_lens_verdict.safeParse(verdict({ ...defaut, severityReason: "" })).success).toBe(false);
  });

  it("occurrences : les autres endroits du même défaut, en chemin:ligne, 20 au plus", () => {
    expect(terminalSchemas.submit_lens_verdict.safeParse(verdict({ ...defaut, occurrences: ["src/b.ts:12", "src/c.ts:4"] })).success).toBe(true);
    expect(terminalSchemas.submit_lens_verdict.safeParse(verdict({ ...defaut, occurrences: ["src/b.ts"] })).success).toBe(false);
    expect(terminalSchemas.submit_lens_verdict.safeParse(verdict({ ...defaut, occurrences: Array.from({ length: 21 }, (_, i) => `src/x.ts:${i + 1}`) })).success).toBe(false);
  });
});

/** La pile proposée par l'agent de découverte (ADR 0076) : une par racine, en YAML, avec sa justification. */
describe("submit_pile", () => {
  const pile = { racine: ".", yaml: "id: python\n" };
  it("une ou plusieurs piles, chacune avec sa racine et son YAML ; une justification", () => {
    expect(terminalSchemas.submit_pile.safeParse({ piles: [pile], justification: "pyproject.toml et pytest." }).success).toBe(true);
    expect(terminalSchemas.submit_pile.safeParse({ piles: [pile, { racine: "api", nom: "api", yaml: "id: x\n" }], justification: "deux sous-projets" }).success).toBe(true);
  });

  it("aucune pile, YAML vide ou justification absente : refusé, le modèle corrige", () => {
    expect(terminalSchemas.submit_pile.safeParse({ piles: [], justification: "x" }).success).toBe(false);
    expect(terminalSchemas.submit_pile.safeParse({ piles: [{ racine: ".", yaml: "" }], justification: "x" }).success).toBe(false);
    expect(terminalSchemas.submit_pile.safeParse({ piles: [pile] }).success).toBe(false);
  });
});

// LEC-2 : l'agent de classement rattache chaque groupe d'erreurs à une entrée de catalogue ; le code vérifie.
describe("submit_lecons", () => {
  const lecon = {
    groupe: "a1b2c3d4e5f6a7b8",
    regle: "Le domaine ne dépend d'aucun type d'infrastructure.",
    quand: "Une entité du domaine a besoin de persister.",
    aFaire: "Déclarer un port dans le domaine.",
    exemple: "us-4#2",
    sources: ["us-4#2", "us-7#1"],
    catalogue: { skill: "architecture-review-criteria/references/clean-arch-violations.md", section: "V-CA-01: Domain Importing from Infrastructure" },
  };
  it("une leçon par groupe, rattachée à une entrée existante ou à une nouvelle entrée proposée", () => {
    expect(terminalSchemas.submit_lecons.safeParse({ lecons: [lecon] }).success).toBe(true);
    expect(terminalSchemas.submit_lecons.safeParse({ lecons: [{ ...lecon, catalogue: { nouvelle: { skill: "craft-discipline/references/test-theater-patterns.md", titre: "Assertion sur un booléen nu" } } }] }).success).toBe(true);
  });
  it("chaque champ est obligatoire ; une leçon sans source est refusée", () => {
    const { regle: _, ...sansRegle } = lecon;
    expect(terminalSchemas.submit_lecons.safeParse({ lecons: [sansRegle] }).success).toBe(false);
    expect(terminalSchemas.submit_lecons.safeParse({ lecons: [{ ...lecon, sources: [] }] }).success).toBe(false);
  });
});
