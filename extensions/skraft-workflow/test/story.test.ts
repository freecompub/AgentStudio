// Copie de extensions/skraft/test/story.test.ts (2026-10-08) : elle protège la copie du module.
import { describe, expect, it } from "vitest";
import { extractLiterals, normalizeLiteral, parseStory, slugOf } from "../src/story.js";

export const US12 = `# US-12 — Plafonner le bolus proposé

En tant que patient, quand le calcul propose une dose de bolus supérieure au plafond défini par mon médecin,
je veux que la dose proposée soit limitée à ce plafond et qu'une alerte m'explique pourquoi.

## Critères d'acceptation
1. Plafond de 10 U, calcul à 6 U : dose proposée 6 U, pas d'alerte.
2. Plafond de 10 U, calcul à 12,5 U : dose proposée 10 U, alerte « Dose plafonnée à 10 U ».
3. Aucun plafond configuré : dose proposée égale au calcul, pas d'alerte.

## Questions ouvertes
- Le plafond s'applique-t-il par prise ou par jour ?
`;

describe("Lecture de la story (SPEC-skraft §6.1)", () => {
  it("identifiant, titre, énoncé, critères numérotés, questions ouvertes", () => {
    const r = parseStory(US12);
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.story.id).toBe("US-12");
    expect(r.story.title).toBe("Plafonner le bolus proposé");
    expect(r.story.statement).toMatch(/^En tant que patient/);
    expect(r.story.criteria.map((c) => c.n)).toEqual([1, 2, 3]);
    expect(r.story.openQuestions).toEqual(["Le plafond s'applique-t-il par prise ou par jour ?"]);
  });

  it("littéraux de chaque critère : nombres avec unité et chaînes entre guillemets", () => {
    const r = parseStory(US12);
    if (!r.ok) throw new Error();
    expect(r.story.criteria[0]?.literals).toEqual(["10 U", "6 U", "6 U"]);
    expect(r.story.criteria[1]?.literals).toEqual(["10 U", "12,5 U", "10 U", "Dose plafonnée à 10 U"]);
    expect(r.story.criteria[2]?.literals).toEqual([]);
  });

  it("refuse une story sans identifiant dans le titre ou sans critère numéroté", () => {
    expect(parseStory("# Plafonner\n\n## Critères d'acceptation\n1. x")).toMatchObject({ ok: false, errors: [expect.stringMatching(/identifiant/)] });
    expect(parseStory("# US-1 — X\n\nTexte.")).toMatchObject({ ok: false, errors: [expect.stringMatching(/critère/)] });
  });

  it("section Questions ouvertes absente ou vide : aucune question", () => {
    const r = parseStory("# US-3 — X\n\n## Critères d'acceptation\n1. Fait 2 choses.\n");
    expect(r.ok && r.story.openQuestions).toEqual([]);
  });

  it("slug stable dérivé de l'identifiant", () => {
    expect(slugOf("US-12")).toBe("us-12");
    expect(slugOf("PROJ 7/b")).toBe("proj-7-b");
  });
});

describe("Littéraux et normalisation (porte valeurs, §7.3)", () => {
  it.each([
    ["dose de 12,5 U", ["12,5 U"]],
    ["dose de 12.5 U et 3 mg/dL", ["12.5 U", "3 mg/dL"]],
    ["«  Dose  plafonnée »", ["Dose plafonnée"]],
    ['message "Trop haut"', ["Trop haut"]],
    ["pas de valeur", []],
    ["entre 3 et 4 fois", ["3", "4"]],
  ])("%s → %j", (text, literals) => {
    expect(extractLiterals(text)).toEqual(literals);
  });

  it("normalisation : séparateur décimal, espaces insécables, casse conservée", () => {
    expect(normalizeLiteral("12,5 U")).toBe("12.5 U");
    expect(normalizeLiteral("12.5 U")).toBe("12.5 U");
    expect(normalizeLiteral("Dose plafonnée à 10 U")).toBe("Dose plafonnée à 10 U");
  });
});
