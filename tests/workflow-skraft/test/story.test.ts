// Repris de extensions/skraft-workflow/test/story.test.ts (2026-10-10) : teste le workflow en dossier (ADR 0055).
// @ts-nocheck — le workflow est en JavaScript, sans types (ADR 0055) : ce test vérifie son comportement, pas ses types.
import { describe, expect, it } from "vitest";
import { extractLiterals, ligneValeursRetirees, normalizeLiteral, parseStory, questionDeValeur, sansValeur, slugOf, valeursDouteuses } from "../../../workflows/skraft/story.mjs";

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

describe("Références et valeurs douteuses de la porte des valeurs (ADR 0080)", () => {
  it.each([
    ["Un défaut réfuté par le réfutateur (ADR 0069) n'est jamais écrit.", []],
    ["Comme l'ADR-069 et l'issue #32, plafond de 12,5 U.", ["12,5 U"]],
    ["Suivi dans freecompub/AgentStudio#32 : 3 essais.", ["3"]],
  ])("une référence d'ADR ou d'issue n'est pas une valeur : %s → %j", (text, literals) => {
    expect(extractLiterals(text)).toEqual(literals);
  });

  const criteres = [
    { n: 1, text: "Entre 3 essais et 12,5 U, message « Trop haut ».", literals: ["3", "12,5 U", "Trop haut"] },
    { n: 2, text: "Depuis 2026.", literals: ["2026"] },
  ];

  it("un nombre seul est douteux ; un nombre avec unité ou un texte entre guillemets est sûr", () => {
    expect(valeursDouteuses(criteres)).toEqual([
      { critere: 1, valeur: "3" },
      { critere: 2, valeur: "2026" },
    ]);
  });

  it("une valeur retirée ne l'est que de son critère", () => {
    expect(sansValeur(criteres, { critere: 1, valeur: "3" }).map((c) => c.literals)).toEqual([["12,5 U", "Trop haut"], ["2026"]]);
  });

  it("la question cite la valeur, son critère, et dit ce que change la réponse", () => {
    const q = questionDeValeur({ critere: 2, valeur: "2026" }, "Depuis 2026.");
    expect(q).toContain("critère 2");
    expect(q).toContain("« 2026 »");
    expect(q).toContain("« Depuis 2026. »");
    expect(q).toContain("porte des valeurs");
  });
});

describe("Bilan des valeurs retirées (ADR 0080)", () => {
  it("le bilan nomme chaque valeur retirée et son critère ; rien si aucune", () => {
    const questions = [
      { id: "q1", text: "?", answer: "oui" },
      { id: "v1", text: "?", valeur: { critere: 3, valeur: "0069" }, retiree: true },
      { id: "v2", text: "?", valeur: { critere: 4, valeur: "2" }, answer: "Oui" },
    ];
    expect(ligneValeursRetirees(questions)).toBe("Valeurs retirées de la porte des valeurs par l'utilisateur : « 0069 » (critère 3).");
    expect(ligneValeursRetirees(questions.slice(0, 1))).toBeNull();
  });
});
