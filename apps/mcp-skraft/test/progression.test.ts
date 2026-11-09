/**
 * Progression d'un run, pour que l'utilisateur la suive (09/11) : une ligne lisible, écrite par le code,
 * et la liste de ce qui a changé entre deux instantanés de l'état. Pur : aucun LLM, aucun disque.
 */
import { describe, expect, it } from "vitest";
import { changements, ligneDeProgression, vueDeTache, type Instantane } from "../src/progression.js";

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
      "Rejet, Scénarios d'acceptance recommence : gherkin : titre sans AC-1.",
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

/**
 * Une tâche de workflow ne porte ni son dernier rejet ni son étape dans sa carte (run du 09/11 : 5 rejets,
 * aucun signalé). Ils sont dans la trace du run : on les y lit, comme `skraft_rapport`.
 */
describe("vueDeTache : rejets et essais lus dans la trace", () => {
  const carte = { id: "t1", title: "skraft-workflow", status: "running" as const, phase: "DISTILL", phaseLabel: "Scénarios d'acceptance" };
  const etape = (phase: string, essai: number, rejets: { porte: string; motifs: string[] }[] = [], coutUsd = 0.1) => ({
    phase,
    essai,
    début: `2026-11-09T11:0${essai}:00.000Z`,
    fin: `2026-11-09T11:0${essai}:30.000Z`,
    rejets,
    coûtUsd: coutUsd,
  });

  it("le dernier rejet et le nombre de rejets du run, l'essai en cours de la phase", () => {
    const etapes = [etape("RESEARCH", 1, [{ porte: "citations", motifs: ["`Features/a.feature` : fichier inexistant.", "autre"] }]), etape("DISTILL", 1), etape("DISTILL", 2, [{ porte: "revue", motifs: ["[quality-gates#2.1, major] ATPayer non consigné"] }]), etape("DISTILL", 3)];
    const { vue } = vueDeTache(carte, etapes, "stories/US-2.md");
    expect(vue).toMatchObject({ titre: "stories/US-2.md", rejets: 2, dernierRejet: "revue : [quality-gates#2.1, major] ATPayer non consigné", essai: 3 });
  });

  it("pendant une revue, pas d'essai : les revues de toutes les phases partagent l'étiquette REVIEW (run du 09/11 : « essai 7 »)", () => {
    const etapes = [etape("DISTILL", 1), etape("REVIEW", 1), etape("DISTILL", 2), etape("REVIEW", 2), etape("DELIVER", 1), etape("REVIEW", 3)];
    expect(vueDeTache({ ...carte, phase: "REVIEW", phaseLabel: "Revue" }, etapes, undefined).vue.essai).toBeUndefined();
  });

  it("sans trace, la carte fait foi (tâche d'extension) ; sans story, le titre de la carte", () => {
    const { vue } = vueDeTache({ ...carte, feedback: "porte : motif" }, [], undefined);
    expect(vue).toMatchObject({ titre: "skraft-workflow", dernierRejet: "porte : motif" });
    expect(vue.rejets).toBeUndefined();
  });

  it("durée et coût du run, depuis la première étape", () => {
    const { dureeMs, coutUsd } = vueDeTache({ ...carte, status: "finished" }, [etape("RESEARCH", 1, [], 0.2), etape("DESIGN", 2, [], 1.3)], undefined);
    expect(coutUsd).toBeCloseTo(1.5);
    expect(dureeMs).toBe(90_000);
  });
});

describe("changements et ligne : rejets comptés, essai affiché", () => {
  const t = { id: "t1", titre: "US-2", status: "running" as const, phase: "DISTILL", phaseLabel: "Scénarios d'acceptance" };
  it("un nouveau rejet est dit même si son texte est celui du précédent", () => {
    const avant: Instantane = { taches: [{ ...t, rejets: 1, dernierRejet: "revue : défaut", essai: 2 }], questions: [], messages: [] };
    const apres: Instantane = { taches: [{ ...t, rejets: 2, dernierRejet: "revue : défaut", essai: 3 }], questions: [], messages: [] };
    expect(changements(avant, apres)).toEqual(["Rejet, Scénarios d'acceptance recommence (essai 3) : revue : défaut."]);
  });

  it("la ligne dit l'essai à partir du deuxième", () => {
    expect(ligneDeProgression({ ...t, essai: 2 }, { questions: 0 })).toBe("US-2 · Scénarios d'acceptance, essai 2 · en cours · aucune question en attente");
    expect(ligneDeProgression({ ...t, essai: 1 }, { questions: 0 })).toBe("US-2 · Scénarios d'acceptance · en cours · aucune question en attente");
  });
});
