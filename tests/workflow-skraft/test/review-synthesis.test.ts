// Repris de extensions/skraft-workflow/test/review-synthesis.test.ts (2026-10-10) : teste le workflow en dossier (ADR 0055).
// @ts-nocheck — le workflow est en JavaScript, sans types (ADR 0055) : ce test vérifie son comportement, pas ses types.
/**
 * Synthèse de revue (SPEC-skraft §9.3). Deux familles de règles y cohabitent, et leur ordre
 * compte : les **contributions pondérées** éclairent le verdict, les **règles de gravité** le
 * décident. Un calcul ne doit jamais pouvoir rattraper une porte.
 */
import { describe, expect, it } from "vitest";
import { assessQuestions, synthesize, uncoveredQuestions, REVIEW_QUESTIONS, type LensVerdict } from "../../../workflows/skraft/review.mjs";

type Severite = "blocker" | "major" | "minor";

const lens = (name: string, verdict: LensVerdict["verdict"], severities: Severite[] = []): LensVerdict => ({
  lens: name,
  verdict,
  defects: severities.map((severity) => ({ severity, description: `défaut ${severity}` })),
});

/** Jeu couvrant les quatre questions : sans lui, aucune approbation n'est possible. */
const couvrant = (over: Partial<Record<string, LensVerdict>> = {}): LensVerdict[] =>
  ["cold-reader", "test-integrity", "architecture", "quality-gates"].map((n) => over[n] ?? lens(n, "APPROVED"));

describe("Règles de gravité (§9.3)", () => {
  it.each([
    ["toutes APPROVED sans défaut major", couvrant({ "cold-reader": lens("cold-reader", "APPROVED", ["minor"]) }), "APPROVED"],
    ["un blocker dans une lentille", couvrant({ architecture: lens("architecture", "APPROVED", ["blocker"]) }), "CHANGES_REQUESTED"],
    [
      "deux lentilles REJECTED",
      couvrant({ "cold-reader": lens("cold-reader", "REJECTED"), "test-integrity": lens("test-integrity", "REJECTED") }),
      "REJECTED",
    ],
    ["un major suffit à demander des changements", couvrant({ "quality-gates": lens("quality-gates", "APPROVED", ["major"]) }), "CHANGES_REQUESTED"],
    ["une seule REJECTED", couvrant({ "cold-reader": lens("cold-reader", "REJECTED") }), "CHANGES_REQUESTED"],
    ["CHANGES_REQUESTED explicite", couvrant({ architecture: lens("architecture", "CHANGES_REQUESTED") }), "CHANGES_REQUESTED"],
    [
      "deux REJECTED priment sur un blocker",
      couvrant({ "cold-reader": lens("cold-reader", "REJECTED", ["blocker"]), architecture: lens("architecture", "REJECTED") }),
      "REJECTED",
    ],
  ] as const)("%s → %s", (_label, lenses, expected) => {
    expect(synthesize([...lenses])).toBe(expected);
  });

  it("déterministe : mêmes JSON de lentilles, même verdict", () => {
    const input = couvrant({ "cold-reader": lens("cold-reader", "APPROVED", ["major"]), architecture: lens("architecture", "REJECTED") });
    expect(synthesize(structuredClone(input))).toBe(synthesize(structuredClone(input)));
  });

  it("aucune lentille : jamais d'approbation implicite", () => {
    expect(synthesize([])).toBe("CHANGES_REQUESTED");
  });
});

describe("Les quatre questions et leurs poids", () => {
  it("les poids sont ceux de la procédure, et ils ne sont jamais additionnés en un score", () => {
    expect(Object.fromEntries(Object.entries(REVIEW_QUESTIONS).map(([q, v]) => [q, v.weight]))).toEqual({
      completeness: 0.3,
      businessFit: 0.3,
      quality: 0.15,
      risk: 0.25,
    });
  });

  it("une question retient la note LA PLUS BASSE des lentilles qui y répondent", () => {
    // `risk` est répondue par les quatre ; une seule inquiète suffit à la faire baisser.
    const q = assessQuestions(couvrant({ architecture: lens("architecture", "APPROVED", ["minor"]) }));
    expect(q.find((x) => x.question === "risk")).toMatchObject({ rating: 0.5, contribution: 0.125 });
    // `businessFit` ne dépend que de cold-reader, restée propre.
    expect(q.find((x) => x.question === "businessFit")).toMatchObject({ rating: 1, contribution: 0.3 });
  });

  it("un blocker met la note à zéro, un rejet franc aussi", () => {
    const zero = (l: LensVerdict) => assessQuestions([l]).find((x) => x.question === "businessFit")?.rating;
    expect(zero(lens("cold-reader", "APPROVED", ["blocker"]))).toBe(0);
    expect(zero(lens("cold-reader", "REJECTED"))).toBe(0);
    expect(zero(lens("cold-reader", "APPROVED", ["major"]))).toBe(0.5);
    expect(zero(lens("cold-reader", "APPROVED"))).toBe(1);
  });

  it("une question qu'aucune lentille ne traite reste ouverte, et interdit l'approbation", () => {
    // cold-reader seule ne répond ni à `completeness` ni à `quality`.
    const seule = [lens("cold-reader", "APPROVED")];
    expect(uncoveredQuestions(seule)).toEqual(["completeness", "quality"]);
    expect(synthesize(seule)).toBe("CHANGES_REQUESTED");
  });

  it("retirer `quality-gates` ne suffit pas à rouvrir une question : `test-integrity` y répond aussi", () => {
    const sansQg = couvrant().filter((l) => l.lens !== "quality-gates");
    expect(uncoveredQuestions(sansQg)).toEqual([]);
    expect(synthesize(sansQg)).toBe("APPROVED");
  });

  it("une lentille inconnue ne répond à aucune question : elle ne couvre rien", () => {
    expect(uncoveredQuestions([lens("inventée", "APPROVED")])).toEqual(["completeness", "businessFit", "quality", "risk"]);
  });
});
