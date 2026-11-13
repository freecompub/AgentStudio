import { describe, expect, it } from "vitest";
import { repondre, type Reponses } from "./repondeur.js";

/**
 * Répondeur commun du banc de comparaison (`docs/10` P4) : la même décision, à la même question,
 * que la demande vienne de l'extension skraft ou du workflow skraft — leurs identifiants diffèrent.
 */

const REPONSES: Reponses = {
  difficulte: "medium-hard",
  questions: [{ motif: "paliers|référence", reponse: "Les mêmes paliers s'appliquent à toutes les références." }],
  questionParDefaut: "Pas de préférence : retiens l'option la plus simple.",
  ratification: "accepter",
  arbitrage: "lentille",
  relancesParEscalade: 2,
  blocages: [{ motif: "module", choix: "Facturation" }],
};

type D = Parameters<typeof repondre>[0];
const memoire = () => new Map<string, number>();

describe("même décision pour l'extension et le workflow", () => {
  it("difficulté : le niveau du fichier, quel que soit l'identifiant", () => {
    const ext: D = { title: "Difficulté de US-2 : Moyenne ?", options: [{ id: "medium", label: "Confirmer : Moyenne" }, { id: "medium-hard", label: "Assez difficile" }, { id: "simple", label: "Simple" }] };
    const wf: D = { title: "Difficulté de US-2 : Moyenne ?", options: [{ id: "4:medium", label: "Confirmer : Moyenne" }, { id: "4:medium-hard", label: "Assez difficile" }, { id: "4:simple", label: "Simple" }] };
    expect(repondre(ext, REPONSES, memoire())).toEqual({ nature: "difficulte", option: "medium-hard" });
    expect(repondre(wf, REPONSES, memoire())).toEqual({ nature: "difficulte", option: "4:medium-hard" });
  });

  it("question ouverte : « Répondre » avec le texte du fichier, choisi par motif ; sinon la réponse par défaut", () => {
    const ext: D = { title: "Question ouverte (US-2)", detail: "Les paliers sont-ils les mêmes pour toutes les références ?", options: [{ id: "answer:q1", label: "Répondre" }, { id: "defer:q1", label: "Reporter" }] };
    const wf: D = { ...ext, options: [{ id: "9:answer", label: "Répondre" }, { id: "9:defer", label: "Reporter" }] };
    expect(repondre(ext, REPONSES, memoire())).toEqual({ nature: "question", option: "answer:q1", commentaire: "Les mêmes paliers s'appliquent à toutes les références." });
    expect(repondre(wf, REPONSES, memoire())).toMatchObject({ option: "9:answer", commentaire: "Les mêmes paliers s'appliquent à toutes les références." });
    expect(repondre({ ...wf, detail: "Faut-il arrondir ?" }, REPONSES, memoire())).toMatchObject({ commentaire: "Pas de préférence : retiens l'option la plus simple." });
  });

  it("ratification : accepter", () => {
    const ext: D = { title: "Ratifier ADR-001", options: [{ id: "accept:ADR-001", label: "Accepter" }, { id: "reject:ADR-001", label: "Rejeter" }, { id: "amend:ADR-001", label: "Demander un amendement" }] };
    const wf: D = { ...ext, options: [{ id: "12:accept", label: "Accepter" }, { id: "12:reject", label: "Rejeter" }, { id: "12:amend", label: "Demander un amendement" }] };
    expect(repondre(ext, REPONSES, memoire())).toEqual({ nature: "ratification", option: "accept:ADR-001" });
    expect(repondre(wf, REPONSES, memoire())).toEqual({ nature: "ratification", option: "12:accept" });
  });

  it("arbitrage : donner raison à la lentille", () => {
    const ext: D = { title: "Arbitrer un désaccord de revue (architecture#3.1)", options: [{ id: "accept:architecture#3.1", label: "Donner raison à l'agent : le défaut tombe" }, { id: "maintain:architecture#3.1", label: "Donner raison à la lentille : à corriger" }] };
    const wf: D = { ...ext, options: [{ id: "20:accept", label: "Donner raison à l'agent : le défaut tombe" }, { id: "20:maintain", label: "Donner raison à la lentille : à corriger" }] };
    expect(repondre(ext, REPONSES, memoire())).toMatchObject({ option: "maintain:architecture#3.1" });
    expect(repondre(wf, REPONSES, memoire())).toMatchObject({ option: "20:maintain" });
  });

  it("escalade : relancer deux fois pour le même motif, puis abandonner — titres et identifiants des deux", () => {
    const ext: D = { title: "Pipeline skraft bloqué (DESIGN)", detail: "cohérence : X", options: [{ id: "retry", label: "Relancer la phase" }, { id: "skip", label: "Sauter la phase" }, { id: "abort", label: "Abandonner" }] };
    const wf: D = { title: "Phase DESIGN : cohérence : X", options: [{ id: "7:relancer", label: "Relancer la phase" }, { id: "7:sauter", label: "Sauter la phase" }, { id: "7:abandonner", label: "Abandonner la tâche" }] };
    for (const d of [ext, wf]) {
      const m = memoire();
      const suite = [1, 2, 3].map(() => repondre(d, REPONSES, m).option);
      expect(suite).toEqual(d === ext ? ["retry", "retry", "abort"] : ["7:relancer", "7:relancer", "7:abandonner"]);
    }
  });

  it("question bloquante d'un agent : le choix désigné par motif, sinon le premier", () => {
    const ext: D = { title: "Question de l'agent (RESEARCH)", detail: "Quel module porte la remise ?", options: [{ id: "Tarification", label: "Tarification" }, { id: "Facturation", label: "Facturation" }] };
    const wf: D = { ...ext, options: [{ id: "5:Tarification", label: "Tarification" }, { id: "5:Facturation", label: "Facturation" }] };
    expect(repondre(ext, REPONSES, memoire())).toMatchObject({ nature: "blocage", option: "Facturation" });
    expect(repondre(wf, REPONSES, memoire())).toMatchObject({ nature: "blocage", option: "5:Facturation" });
    expect(repondre({ ...wf, detail: "Autre chose ?" }, REPONSES, memoire())).toMatchObject({ option: "5:Tarification" });
  });

  it("question inconnue : première option, et signalée comme inconnue (le banc la consigne)", () => {
    expect(repondre({ title: "Nouvelle question", options: [{ id: "a", label: "A" }] }, REPONSES, memoire())).toEqual({ nature: "inconnue", option: "a" });
  });
});
