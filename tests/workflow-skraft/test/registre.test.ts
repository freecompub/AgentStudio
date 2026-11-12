// @ts-nocheck — le workflow est en JavaScript, sans types (ADR 0055) : ce test vérifie son comportement, pas ses types.
/**
 * Registre des erreurs commises (LEC-1, freecompub/AgentStudio#32) : ce que le code établit, sous
 * quelle forme, avec quelle signature. Pur : sans disque, sans Git, sans LLM.
 */
import { describe, expect, it } from "vitest";
import { cheminDuRegistre, contenuDuRegistre, defautsRetenus, ecrireLeRegistre, erreurDeDefaut, erreurDeRefus, nouveauRegistre, ouvrirLeRegistre, refusCompte, regrouperParSignature } from "../../../workflows/skraft/registre.mjs";

const fil = (over = {}) => ({ id: "cold-reader#1.1", lens: "cold-reader", severity: "major", description: "Nom flou.", file: "src/a.ts", line: 3, target: "code", status: "open", round: 1, ...over });

describe("Registre des erreurs (LEC-1)", () => {
  it("un fichier propre à la story, sous .agent-studio/lecons/brut", () => {
    expect(cheminDuRegistre("lec-1")).toBe(".agent-studio/lecons/brut/lec-1.jsonl");
  });

  it("un défaut grave ou bloquant retenu est enregistré avec sa phase, sa lentille, sa cible, sa description, son fichier, sa ligne, la story et son identifiant", () => {
    const e = erreurDeDefaut(fil(), "DELIVER", "lec-1");
    expect(e).toEqual({ type: "defaut", story: "lec-1", phase: "DELIVER", lentille: "cold-reader", cible: "code", description: "Nom flou.", fichier: "src/a.ts", ligne: 3, defaut: "cold-reader#1.1", signature: expect.any(String) });
  });

  it("défauts retenus : graves ou bloquants, ni abandonnés par la lentille, ni donnés à l'agent par l'humain", () => {
    const fils = [
      fil({ id: "a#1.1", status: "fixed" }),
      fil({ id: "a#1.2", severity: "blocker", status: "maintained" }),
      fil({ id: "a#1.3", status: "accepted" }),
      fil({ id: "a#1.4", status: "humanAccepted" }),
      fil({ id: "a#1.5", status: "humanMaintained" }),
      fil({ id: "a#1.6", severity: "minor", status: "open" }),
    ];
    expect(defautsRetenus(fils).map((f) => f.id)).toEqual(["a#1.1", "a#1.2", "a#1.5"]);
  });

  it("un refus de porte est enregistré avec la porte, ses motifs normalisés comme pour le disjoncteur, la phase et la story", () => {
    const e = erreurDeRefus({ porte: "valeurs", motifs: [" b ", "a", "b"], phase: "DISTILL", story: "lec-1" });
    expect(e).toEqual({ type: "refus", story: "lec-1", phase: "DISTILL", porte: "valeurs", motifs: ["a", "b"], signature: expect.any(String) });
  });

  it("refus qui consomment un essai : portes de fin de phase, pas, scénarios, corrections ciblées ; ni délai, ni revue, ni question, ni panne", () => {
    for (const p of ["citations", "valeurs", "classifieur", "pas red (S1)", "scénario S1", "correction (S1)", "mutation (correction ciblée)", "DELIVER : suite finale"]) expect(refusCompte(p), p).toBe(true);
    for (const p of ["délai", "DELIVER : délai", "revue", "DELIVER : revue", "revue (correction ciblée)", "question de revue", "panne (S1)", "panne (correction S1)"]) expect(refusCompte(p), p).toBe(false);
  });

  it("même phase, même source, même motif : même signature, quels que soient la story, le fichier et la ligne", () => {
    const a = erreurDeDefaut(fil(), "DELIVER", "lec-1");
    const b = erreurDeDefaut(fil({ id: "cold-reader#3.2", file: "src/b.ts", line: 40 }), "DELIVER", "lec-2");
    const autreMotif = erreurDeDefaut(fil({ description: "Autre chose." }), "DELIVER", "lec-1");
    const autrePhase = erreurDeDefaut(fil(), "DISTILL", "lec-1");
    expect(b.signature).toBe(a.signature);
    expect(autreMotif.signature).not.toBe(a.signature);
    expect(autrePhase.signature).not.toBe(a.signature);
    expect(erreurDeRefus({ porte: "valeurs", motifs: ["x", "y"], phase: "DISTILL", story: "s1" }).signature).toBe(erreurDeRefus({ porte: "valeurs", motifs: ["y ", "x"], phase: "DISTILL", story: "s2" }).signature);
  });

  it("le contenu garde chaque ligne déjà écrite telle quelle, et ajoute les nouvelles à la suite", () => {
    const avant = '{"id":"lec-1#1","type":"refus","story":"lec-1"}';
    const e = erreurDeRefus({ porte: "valeurs", motifs: ["x"], phase: "DISTILL", story: "lec-1" });
    expect(contenuDuRegistre(avant, [e])).toBe(`${avant}\n${JSON.stringify({ id: "lec-1#2", ...e })}\n`);
    expect(contenuDuRegistre("", [])).toBe("");
  });

  // LEC-2 : une leçon cite ses sources par identifiant ; il est stable, et continue le fichier à une relance.
  it("chaque erreur reçoit un identifiant : la story et son rang dans le fichier", () => {
    const e = (m) => erreurDeRefus({ porte: "valeurs", motifs: [m], phase: "DISTILL", story: "lec-1" });
    const premier = contenuDuRegistre("", [e("a"), e("b")]);
    expect(premier.trim().split("\n").map((l) => JSON.parse(l).id)).toEqual(["lec-1#1", "lec-1#2"]);
    expect(contenuDuRegistre(premier, [e("c")]).trim().split("\n").map((l) => JSON.parse(l).id)).toEqual(["lec-1#1", "lec-1#2", "lec-1#3"]);
  });

  it("regroupe les erreurs de toutes les stories par signature, avec le nombre de stories distinctes", () => {
    const a1 = erreurDeDefaut(fil(), "DELIVER", "lec-1");
    const a2 = erreurDeDefaut(fil({ line: 9 }), "DELIVER", "lec-1");
    const a3 = erreurDeDefaut(fil(), "DELIVER", "lec-2");
    const b = erreurDeRefus({ porte: "valeurs", motifs: ["x"], phase: "DISTILL", story: "lec-2" });
    const groupes = regrouperParSignature([contenuDuRegistre("", [a1, a2]), contenuDuRegistre("", [a3, b])]);
    expect(groupes).toEqual([
      { signature: a1.signature, stories: 2, erreurs: 3 },
      { signature: b.signature, stories: 1, erreurs: 1 },
    ]);
  });
});

describe("Registre : une modification hors du code est détectée (LEC-1, critère 11)", () => {
  const disque = (fichiers) => ({
    listerFichiers: async () => Object.keys(fichiers),
    lireFichier: async (p) => fichiers[p],
    ecrireFichier: async (p, c) => void (fichiers[p] = c),
  });
  it("le fichier ne porte plus ce que le code y a écrit : signalé, puis rétabli", async () => {
    const fichiers = {};
    const w = disque(fichiers);
    const r = nouveauRegistre();
    await ouvrirLeRegistre(w, r, "lec-1");
    r.erreurs.push(erreurDeRefus({ porte: "valeurs", motifs: ["x"], phase: "DISTILL", story: "lec-1" }));
    await ecrireLeRegistre(w, r);
    expect(r.modifie).toBe(false);
    fichiers[r.chemin] = "falsifié\n";
    await ecrireLeRegistre(w, r);
    expect(r.modifie).toBe(true);
    expect(fichiers[r.chemin]).toBe(contenuDuRegistre("", r.erreurs));
  });
  it("après un rembobinage, le retour au checkpoint n'est pas une modification", async () => {
    const fichiers = {};
    const w = disque(fichiers);
    const r = nouveauRegistre();
    await ouvrirLeRegistre(w, r, "lec-1");
    r.erreurs.push(erreurDeRefus({ porte: "valeurs", motifs: ["x"], phase: "DISTILL", story: "lec-1" }));
    await ecrireLeRegistre(w, r);
    delete fichiers[r.chemin];
    await ecrireLeRegistre(w, r, { apresRembobinage: true });
    expect(r.modifie).toBe(false);
  });
});
