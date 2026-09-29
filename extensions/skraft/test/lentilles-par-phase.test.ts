/**
 * Quelles lentilles siègent, selon la phase (ADR 0028).
 *
 * Le 28/09, la revue de DESIGN a été refusée deux fois de suite par `quality-gates`, sur ce motif :
 *
 *   « Le texte présente le flux cible comme l'implémentation actuelle et le référence à
 *     CalculDuPanier.cs:15-22. Or le code cité ne contient ni port injecté ni ResultatDeChiffrage. »
 *
 * Le reproche est mécaniquement insatisfaisable : un document de **conception** décrit toujours ce
 * qui n'existe pas encore. Et il sort de son mandat — cette lentille confronte les livrables aux
 * faits MESURÉS. En DESIGN, rien n'est mesuré : aucun test n'existe. Sommée de rendre un verdict
 * sans matière, elle a inventé un grief dans une catégorie voisine.
 *
 * C'est le motif que le projet traque, retourné : une porte ne doit pas attester ce qu'elle n'a pas
 * mesuré — ni **reprocher** ce qu'elle n'a pas mesuré.
 */
import { describe, expect, it } from "vitest";
import { levelEffects, lensesForPhase, type LensName } from "../src/difficulty.js";
import { REVIEW_QUESTIONS, uncoveredQuestions, type LensVerdict } from "../src/review.js";
import { REVIEWED_PHASES } from "../src/config.js";
import { lensBrief } from "../src/review-brief.js";
import { initialState } from "../src/reducer.js";

const DIFFICULTES = ["simple", "medium", "medium-hard", "challenging"] as const;
const approuve = (lens: string): LensVerdict => ({ lens, verdict: "APPROVED", defects: [] });

describe("lensesForPhase", () => {
  it("`quality-gates` ne siège pas en DESIGN : aucun fait n'y est mesuré", () => {
    expect(lensesForPhase(levelEffects("medium-hard").lenses, "DESIGN")).not.toContain("quality-gates");
  });

  it("elle siège en DISTILL et en DELIVER, où le code mesure vraiment quelque chose", () => {
    for (const phase of ["DISTILL", "DELIVER"] as const)
      expect(lensesForPhase(levelEffects("medium-hard").lenses, phase), phase).toContain("quality-gates");
  });

  it("les autres lentilles ne sont jamais retirées : on n'en écarte qu'une, et pour une raison nommée", () => {
    for (const phase of REVIEWED_PHASES) {
      const retenues = lensesForPhase(levelEffects("challenging").lenses, phase);
      for (const l of ["cold-reader", "test-integrity", "architecture"] as LensName[]) expect(retenues, `${phase}/${l}`).toContain(l);
    }
  });

  it("aucune des quatre questions ne reste sans réponse, quel que soit le couple (niveau, phase)", () => {
    // C'est l'invariant qui rend le retrait légitime. Sans lui, écarter une lentille laisserait une
    // question ouverte et la synthèse refuserait d'approuver — la revue tournerait en rond autrement.
    for (const niveau of DIFFICULTES)
      for (const phase of REVIEWED_PHASES) {
        const retenues = lensesForPhase(levelEffects(niveau).lenses, phase);
        expect(retenues.length, `${niveau}/${phase}`).toBeGreaterThan(0);
        expect(uncoveredQuestions(retenues.map(approuve)), `${niveau}/${phase}`).toEqual([]);
      }
  });

  it("le niveau simple, déjà sans `quality-gates`, n'est pas affecté", () => {
    expect(lensesForPhase(levelEffects("simple").lenses, "DESIGN")).toEqual(["cold-reader", "test-integrity"]);
  });

  it("chaque question reste couverte par au moins une lentille présente, question par question", () => {
    const retenues = lensesForPhase(levelEffects("medium-hard").lenses, "DESIGN");
    for (const [q, def] of Object.entries(REVIEW_QUESTIONS))
      expect(def.answeredBy.some((l) => (retenues as string[]).includes(l)), q).toBe(true);
  });
});

describe("lensBrief — quand rien n'a été mesuré", () => {
  const etat = { ...initialState({ storyPath: "stories/US-1.md" }), phase: "DELIVER" as const };
  const fichiers = { artifacts: ["a.md"], code: [], tests: [] };

  it("dit explicitement qu'aucune mesure n'existe, au lieu de présenter des empreintes comme des faits", () => {
    // Filet pour les phases où la lentille siège mais où l'outillage n'a rien produit : une stack
    // sans couverture, un DISTILL sans exécution de tests. Elle doit le lire, pas le deviner.
    const b = lensBrief("quality-gates", etat, "DELIVER", fichiers, []);
    expect(b).toMatch(/aucune mesure/i);
  });

  it("et lui interdit d'inventer un défaut qu'elle ne peut confronter à aucune mesure", () => {
    const b = lensBrief("quality-gates", etat, "DELIVER", fichiers, []);
    expect(b).toMatch(/n'invente|n'en invente|pas de ton ressort/i);
  });

  it("mais laisse intact son vrai mandat : dénoncer un livrable qui se prévaut d'une qualité non mesurée", () => {
    const b = lensBrief("quality-gates", etat, "DELIVER", fichiers, []);
    expect(b).toMatch(/se prévaut|prévaloir|passent sous silence/i);
  });

  it("quand des mesures existent, le texte reste celui d'avant", () => {
    const b = lensBrief("quality-gates", etat, "DELIVER", fichiers, ["Tests : 12 réussis, 0 en échec."]);
    expect(b).toContain("Faits établis par le code");
    expect(b).not.toMatch(/aucune mesure/i);
  });
});
