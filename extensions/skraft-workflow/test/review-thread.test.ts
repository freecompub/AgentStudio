// Copie de extensions/skraft/test/review-thread.test.ts (2026-10-08) : elle protège la copie du module.
/**
 * Fils de défauts de revue (ADR 0046) : chaque défaut blocker ou major devient un fil, identifié par
 * le code, routé vers l'agent concerné, auquel l'agent répond (corrigé ou contesté) et que la
 * lentille arbitre. Fonctions pures, testées sans LLM.
 */
import { describe, expect, it } from "vitest";
import type { LensVerdict } from "../src/review.js";
import {
  agentFeedback,
  applyArbitration,
  applyResponses,
  effectiveTarget,
  endTurn,
  lensHistory,
  lensesAfterThreads,
  numberDefects,
  reviewRound,
  type DefectThread,
} from "../src/review-thread.js";

const verdict = (lens: string, defects: LensVerdict["defects"], v: LensVerdict["verdict"] = "CHANGES_REQUESTED", rulings: LensVerdict["rulings"] = []): LensVerdict => ({ lens, verdict: v, defects, rulings });
const major = (description: string, o: Partial<LensVerdict["defects"][number]> = {}) => ({ severity: "major" as const, description, target: "code" as const, ...o });

describe("numberDefects et effectiveTarget", () => {
  it("le code numérote chaque défaut, par lentille et par tour : l'identifiant ne vient jamais du modèle", () => {
    const [v] = numberDefects([verdict("cold-reader", [major("a"), { severity: "minor", description: "b", target: "code" }])], 2, () => null);
    expect(v!.defects.map((d) => d.id)).toEqual(["cold-reader#2.1", "cold-reader#2.2"]);
  });

  it("un défaut déclaré « code » qui cite un fichier de test va au testeur, et l'écart est noté", () => {
    const kind = (f: string) => (f.startsWith("tests/") ? "test" : f.startsWith("src/") ? "code" : "deliverable");
    expect(effectiveTarget({ severity: "major", description: "x", target: "code", file: "tests/A.cs" }, kind)).toEqual({ target: "test", note: "cible déclarée « code », fichier de test : routé vers « test »" });
    expect(effectiveTarget({ severity: "major", description: "x", target: "code", file: "src/A.cs" }, kind)).toEqual({ target: "code" });
    // Un verdict d'avant l'ADR 0046 n'a pas de cible : le code par défaut.
    expect(effectiveTarget({ severity: "major", description: "x" }, kind)).toEqual({ target: "code" });
  });

  it("un défaut déclaré « test » reste au testeur, même s'il cite le code qu'aucun test ne couvre", () => {
    // Run réel US-2 du 03/10 : « aucun test ne couvre Facture.ATPayer » citait CalculDuPanier.cs. Le
    // fichier l'avait reclassé « code » : le développeur, tests gelés, ne pouvait que contester —
    // puis il a supprimé le code non testé pour satisfaire la revue.
    const kind = (f: string) => (f.startsWith("tests/") ? "test" : f.startsWith("src/") ? "code" : "deliverable");
    expect(effectiveTarget({ severity: "major", description: "aucun test ne couvre ATPayer", target: "test", file: "src/CalculDuPanier.cs" }, kind)).toEqual({ target: "test" });
  });
});

describe("reviewRound", () => {
  it("chaque défaut blocker ou major devient un fil ouvert ; les mineurs n'en ouvrent pas", () => {
    const lenses = numberDefects([verdict("cold-reader", [major("a"), { severity: "minor", description: "m", target: "code" }])], 1, () => null);
    const r = reviewRound([], lenses, 1);
    expect(r.threads).toEqual([expect.objectContaining({ id: "cold-reader#1.1", status: "open", target: "code", round: 1 })]);
    expect(r.persistent).toEqual([]);
  });

  it("une contestation acceptée par la lentille fait tomber le défaut", () => {
    const prev: DefectThread[] = [{ id: "cold-reader#1.1", lens: "cold-reader", severity: "major", description: "a", target: "test", status: "contested", contestation: "couvert par ac-3", round: 1 }];
    const r = reviewRound(prev, [verdict("cold-reader", [], "APPROVED", [{ defect: "cold-reader#1.1", decision: "accepted", reason: "convaincu" }])], 2);
    expect(r.threads.find((t) => t.id === "cold-reader#1.1")).toMatchObject({ status: "accepted", ruling: "convaincu" });
    expect(r.lenses[0]!.defects).toEqual([]);
  });

  it("une contestation maintenue reste à corriger, et empêche l'approbation même si la lentille l'oublie dans ses défauts", () => {
    const prev: DefectThread[] = [{ id: "cold-reader#1.1", lens: "cold-reader", severity: "major", description: "a", target: "test", status: "contested", contestation: "x", round: 1 }];
    const r = reviewRound(prev, [verdict("cold-reader", [], "APPROVED", [{ defect: "cold-reader#1.1", decision: "maintained", reason: "non" }])], 2);
    expect(r.threads.find((t) => t.id === "cold-reader#1.1")).toMatchObject({ status: "maintained", ruling: "non" });
    expect(r.lenses[0]!.defects.map((d) => d.description)).toEqual(["a"]);
  });

  it("une contestation sans arbitrage est maintenue : seule la lentille peut lâcher un défaut", () => {
    const prev: DefectThread[] = [{ id: "c#1.1", lens: "c", severity: "major", description: "a", target: "code", status: "contested", contestation: "x", round: 1 }];
    expect(reviewRound(prev, [verdict("c", [])], 2).threads[0]).toMatchObject({ status: "maintained" });
  });

  it("contesté une seconde fois puis maintenu encore : désaccord persistant, soumis à l'humain", () => {
    const prev: DefectThread[] = [{ id: "c#1.1", lens: "c", severity: "major", description: "a", target: "code", status: "recontested", contestation: "y", round: 1 }];
    const r = reviewRound(prev, [verdict("c", [], "CHANGES_REQUESTED", [{ defect: "c#1.1", decision: "maintained", reason: "toujours non" }])], 3);
    expect(r.persistent.map((t) => t.id)).toEqual(["c#1.1"]);
  });

  it("les demandes déjà corrigées restent dans le fil, en rappel (retour de revue cumulatif après un rejet)", () => {
    const prev: DefectThread[] = [{ id: "architecture#1.1", lens: "architecture", severity: "major", description: "calcul pur modélisé en événement", target: "deliverable", status: "fixed", round: 1 }];
    const lenses = numberDefects([verdict("cold-reader", [major("la grille n'a pas de source", { target: "deliverable" })])], 2, () => null);
    const r = reviewRound(prev, lenses, 2);
    const fb = agentFeedback(r.threads, () => true);
    expect(fb.join("\n")).toMatch(/la grille n'a pas de source/);
    expect(fb.join("\n")).toMatch(/Rappel.*calcul pur modélisé en événement/s);
  });
});

describe("applyResponses", () => {
  const open: DefectThread = { id: "c#1.1", lens: "c", severity: "major", description: "a", target: "test", status: "open", round: 1 };

  it("corrigé, contesté avec raison ; un identifiant inconnu ou d'une autre cible est ignoré", () => {
    const t2: DefectThread = { ...open, id: "c#1.2" };
    const other: DefectThread = { ...open, id: "c#1.3", target: "code" };
    const r = applyResponses([open, t2, other], [
      { defect: "c#1.1", status: "fixed" },
      { defect: "c#1.2", status: "contested", reason: "couvert par ac-3" },
      { defect: "c#1.3", status: "contested", reason: "pas à moi" },
      { defect: "inconnu", status: "fixed" },
    ], (t) => t.target === "test");
    expect(r.map((t) => [t.id, t.status, t.contestation])).toEqual([
      ["c#1.1", "fixed", undefined],
      ["c#1.2", "contested", "couvert par ac-3"],
      ["c#1.3", "open", undefined],
    ]);
  });

  it("contester sans raison ne vaut rien : le fil reste ouvert", () => {
    expect(applyResponses([open], [{ defect: "c#1.1", status: "contested" }], () => true)[0]!.status).toBe("open");
  });

  it("contester un défaut que la lentille a maintenu : contesté une seconde fois", () => {
    expect(applyResponses([{ ...open, status: "maintained" }], [{ defect: "c#1.1", status: "contested", reason: "z" }], () => true)[0]).toMatchObject({ status: "recontested", contestation: "z" });
  });

  it("un défaut tranché par l'humain en faveur de la lentille ne se conteste plus", () => {
    expect(applyResponses([{ ...open, status: "humanMaintained" }], [{ defect: "c#1.1", status: "contested", reason: "z" }], () => true)[0]!.status).toBe("humanMaintained");
  });
});

describe("applyArbitration", () => {
  it("l'humain donne raison à l'agent (le défaut tombe) ou à la lentille (à corriger, sans recours)", () => {
    const t: DefectThread = { id: "c#1.1", lens: "c", severity: "major", description: "a", target: "code", status: "recontested", contestation: "y", round: 1 };
    expect(applyArbitration([t], "accept:c#1.1")[0]!.status).toBe("humanAccepted");
    expect(applyArbitration([t], "maintain:c#1.1")[0]!.status).toBe("humanMaintained");
    expect(applyArbitration([t], "n'importe:quoi")[0]!.status).toBe("recontested");
  });
});

describe("agentFeedback et lensHistory", () => {
  const threads: DefectThread[] = [
    { id: "c#1.1", lens: "c", severity: "major", description: "test manquant", target: "test", status: "open", round: 1, file: "tests/A.cs", line: 3 },
    { id: "c#1.2", lens: "c", severity: "blocker", description: "calcul faux", target: "code", status: "maintained", ruling: "le cas 0 n'est pas traité", contestation: "x", round: 1 },
    { id: "a#1.1", lens: "a", severity: "major", description: "doc", target: "deliverable", status: "contested", contestation: "déjà dans contracts.md", round: 1 },
  ];

  it("l'agent ne reçoit que les fils qui le concernent, avec leur identifiant et ce qu'on attend de lui", () => {
    const fb = agentFeedback(threads, (t) => t.target === "test").join("\n");
    expect(fb).toMatch(/\[c#1\.1, major, test\] test manquant \(tests\/A\.cs:3\)/);
    expect(fb).not.toMatch(/calcul faux/);
    expect(fb).toMatch(/responses/);
  });

  it("un défaut maintenu dit à l'agent qu'il doit être corrigé, et pourquoi", () => {
    expect(agentFeedback(threads, (t) => t.target === "code").join("\n")).toMatch(/maintenu.*le cas 0 n'est pas traité/s);
  });

  it("chaque lentille revoit ses propres défauts et la réponse de l'agent, et elle seule", () => {
    const h = lensHistory(threads, "c").join("\n");
    expect(h).toMatch(/c#1\.1/);
    expect(h).not.toMatch(/a#1\.1/);
    expect(lensHistory(threads, "a").join("\n")).toMatch(/contesté.*déjà dans contracts\.md.*rulings/s);
  });
});

describe("lensesAfterThreads", () => {
  it("après arbitrage humain : le défaut accepté disparaît et la lentille approuve ; le défaut maintenu reste", () => {
    const lenses = [verdict("c", [{ ...major("a"), id: "c#1.1" }]), verdict("t", [{ ...major("b"), id: "t#1.1" }])];
    const threads: DefectThread[] = [
      { id: "c#1.1", lens: "c", severity: "major", description: "a", target: "code", status: "humanAccepted", round: 1 },
      { id: "t#1.1", lens: "t", severity: "major", description: "b", target: "test", status: "humanMaintained", round: 1 },
    ];
    const [c, t] = lensesAfterThreads(lenses, threads);
    expect(c).toMatchObject({ verdict: "APPROVED", defects: [] });
    expect(t).toMatchObject({ verdict: "CHANGES_REQUESTED", defects: [expect.objectContaining({ id: "t#1.1" })] });
  });
});

/**
 * ADR 0047 — « hors de mon périmètre ». Run réel US-2 du 03/10 : un défaut de couverture mal routé
 * a été maintenu chez le développeur, qui ne pouvait pas écrire de test ; il a fini par supprimer
 * le code. L'agent peut désormais renvoyer un défaut à l'autre agent, une fois.
 */
describe("applyResponses — hors de mon périmètre", () => {
  const t: DefectThread = { id: "q#1.1", lens: "q", severity: "major", description: "aucun test ne couvre ATPayer", target: "code", status: "open", round: 1 };
  const swap = (x: DefectThread) => (x.target === "test" ? "code" : "test") as "code" | "test";

  it("le défaut est renvoyé à l'autre agent, toujours à traiter", () => {
    const [r] = applyResponses([t], [{ defect: "q#1.1", status: "outOfScope", reason: "il faut un test" }], () => true, swap);
    expect(r).toMatchObject({ target: "test", status: "open", rerouted: true });
  });

  it("un défaut maintenu peut aussi être renvoyé : c'est le routage qui était faux, pas le défaut", () => {
    expect(applyResponses([{ ...t, status: "maintained" }], [{ defect: "q#1.1", status: "outOfScope", reason: "r" }], () => true, swap)[0]).toMatchObject({ target: "test", status: "open" });
  });

  it("renvoyé une seconde fois : il ne rebondit pas, il devient une contestation que la lentille arbitrera", () => {
    const [r] = applyResponses([{ ...t, target: "test", rerouted: true }], [{ defect: "q#1.1", status: "outOfScope", reason: "pas pour moi non plus" }], () => true, swap);
    expect(r).toMatchObject({ target: "test", status: "contested", contestation: "pas pour moi non plus" });
  });

  it("sans second agent (hors DELIVER), « hors périmètre » vaut contestation", () => {
    expect(applyResponses([t], [{ defect: "q#1.1", status: "outOfScope", reason: "r" }], () => true)[0]).toMatchObject({ status: "contested", contestation: "r" });
  });
});

describe("endTurn", () => {
  it("à la fin du tour d'un agent, ses défauts encore actifs sont tenus pour traités : la revue suivante les rejugera", () => {
    // Sans cela, un agent qui ne remplit pas `responses` laisse ses défauts actifs pour toujours, et
    // la correction rebondit entre le testeur et le développeur sans jamais finir.
    const threads: DefectThread[] = [
      { id: "a", lens: "c", severity: "major", description: "x", target: "test", status: "open", round: 1 },
      { id: "b", lens: "c", severity: "major", description: "y", target: "code", status: "open", round: 1 },
      { id: "c", lens: "c", severity: "major", description: "z", target: "test", status: "contested", contestation: "r", round: 1 },
    ];
    expect(endTurn(threads, (t) => t.target === "test").map((t) => [t.id, t.status])).toEqual([["a", "fixed"], ["b", "open"], ["c", "contested"]]);
  });
});
