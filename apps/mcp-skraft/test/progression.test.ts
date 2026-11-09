/**
 * Progression d'un run, pour que l'utilisateur la suive (09/11) : une ligne lisible, écrite par le code,
 * et la liste de ce qui a changé entre deux instantanés de l'état. Pur : aucun LLM, aucun disque.
 */
import { describe, expect, it } from "vitest";
import { changements, ligneDeProgression, type Instantane } from "../src/progression.js";

const tache = { id: "t1", titre: "US-2 — Remise par palier", status: "running" as const, phase: "DESIGN", phaseLabel: "Conception" };
const vide: Instantane = { taches: [], questions: [], messages: [] };

describe("ligneDeProgression", () => {
  it("phase, étape, statut, durée, coût, dernier rejet, questions : ce qu'on montre à l'utilisateur", () => {
    expect(
      ligneDeProgression({ ...tache, etape: { index: 2, total: 5 }, dernierRejet: "cohérence : context-map.md : la relation « `A` → `B` » ne nomme aucun patron" }, { questions: 0, dureeMs: 394_000, coutUsd: 2.9385 }),
    ).toBe("US-2 — Remise par palier · Conception, étape 2/5 · en cours · 6 min 34 s · 2,94 $ · dernier rejet : cohérence : context-map.md : la relation « `A` → `B` » ne nomme aucun patron · aucune question en attente");
  });

  it("en attente d'une réponse, sans coût mesuré (Copilot) : le coût est omis, pas affiché à zéro", () => {
    expect(ligneDeProgression({ ...tache, status: "waiting" }, { questions: 2, coutUsd: 0 })).toBe("US-2 — Remise par palier · Conception · attend une réponse · 2 questions en attente");
  });

  it("un coût faible mais non nul ne s'affiche pas « 0,00 $ » (run du 09/11)", () => {
    expect(ligneDeProgression(tache, { questions: 0, coutUsd: 0.0016 })).toContain("· < 0,01 $ ·");
  });

  it("un rejet long est coupé, et seule sa première ligne compte", () => {
    const l = ligneDeProgression({ ...tache, dernierRejet: `${"x".repeat(300)}\nsuite` }, { questions: 0 });
    expect(l).toContain(`dernier rejet : ${"x".repeat(160)}…`);
    expect(l).not.toContain("suite");
  });

  it("terminé", () => {
    expect(ligneDeProgression({ ...tache, status: "finished", phase: "DONE", phaseLabel: "Terminé" }, { questions: 0, dureeMs: 905_000 })).toBe("US-2 — Remise par palier · Terminé · terminé · 15 min 05 s · aucune question en attente");
  });
});

describe("changements", () => {
  const avant: Instantane = { taches: [tache], questions: [], messages: ["Stack du projet : dotnet."] };

  it("rien n'a bougé : aucun changement", () => {
    expect(changements(avant, avant)).toEqual([]);
  });

  it("un run lancé, puis une phase, une étape, un rejet, un message : chacun dit en une phrase", () => {
    expect(changements(vide, avant)).toEqual(["Run lancé : US-2 — Remise par palier.", "Message : Stack du projet : dotnet."]);
    const apres: Instantane = {
      taches: [{ ...tache, phase: "DISTILL", phaseLabel: "Scénarios d'acceptance", etape: { index: 1, total: 3 }, dernierRejet: "gherkin : titre sans AC-1" }],
      questions: [],
      messages: ["Stack du projet : dotnet.", "Précontrôle : couverture non mesurée."],
    };
    expect(changements(avant, apres)).toEqual([
      "Phase : Scénarios d'acceptance (DISTILL).",
      "Étape 1/3.",
      "Rejet, la phase recommence : gherkin : titre sans AC-1.",
      "Message : Précontrôle : couverture non mesurée.",
    ]);
  });

  it("une question apparaît : elle est à poser à l'utilisateur ; une question tranchée n'est plus citée", () => {
    const q = { id: "q1", tache: "t1", title: "Question ouverte (US-2)", detail: "Les paliers sont-ils les mêmes pour toutes les références ?" };
    const avecQuestion: Instantane = { ...avant, taches: [{ ...tache, status: "waiting" }], questions: [q] };
    expect(changements(avant, avecQuestion)).toEqual([
      "Question à poser à l'utilisateur : Question ouverte (US-2) — Les paliers sont-ils les mêmes pour toutes les références ?",
    ]);
    expect(changements(avecQuestion, { ...avecQuestion, taches: [tache], questions: [] })).toEqual(["Réponse reçue : le run reprend."]);
  });

  it("la fin du run", () => {
    expect(changements(avant, { ...avant, taches: [{ ...tache, status: "finished", phase: "DONE", phaseLabel: "Terminé" }] })).toEqual(["Phase : Terminé (DONE).", "Run terminé : US-2 — Remise par palier."]);
  });

  it("filtré sur un run : les autres runs ne comptent pas", () => {
    const autre = { ...tache, id: "t2", titre: "US-3" };
    expect(changements(avant, { ...avant, taches: [tache, autre] }, "t1")).toEqual([]);
  });
});
