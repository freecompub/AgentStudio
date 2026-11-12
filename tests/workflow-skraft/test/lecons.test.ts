// @ts-nocheck — le workflow est en JavaScript, sans types (ADR 0055) : ce test vérifie son comportement, pas ses types.
/**
 * Leçons tirées des erreurs répétées (LEC-2, freecompub/AgentStudio#33) : ce que le code vérifie d'une
 * leçon proposée, à quel rôle elle va, et son statut. Pur : sans disque, sans Git, sans LLM.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGUES, entreesDuCatalogue } from "../../../workflows/skraft/catalogues.mjs";
import { mettreAJourLesLecons, roleDeLecon, verifierLecon } from "../../../workflows/skraft/lecons.mjs";

const SKILLS = join(import.meta.dirname, "../../../workflows/skraft/skills");
const CLEAN = "architecture-review-criteria/references/clean-arch-violations.md";
const erreur = (id, story, over = {}) => ({ id, type: "defaut", story, phase: "DELIVER", lentille: "architecture", cible: "code", description: "Le domaine importe l'infrastructure.", signature: "sig-a", ...over });
const lecon = (over = {}) => ({
  groupe: "sig-a",
  regle: "Le domaine ne dépend d'aucun type d'infrastructure.",
  quand: "Une entité du domaine a besoin de persister.",
  aFaire: "Déclarer un port dans le domaine.",
  exemple: "us-4#1",
  sources: ["us-4#1"],
  catalogue: { skill: CLEAN, section: "V-CA-01: Domain Importing from Infrastructure" },
  ...over,
});

describe("Catalogues des skills (LEC-2)", () => {
  it.each(Object.keys(CATALOGUES))("les sections connues du code sont celles du fichier %s", (chemin) => {
    expect(CATALOGUES[chemin]).toEqual(entreesDuCatalogue(readFileSync(join(SKILLS, chemin), "utf8")));
  });
});

describe("Vérification d'une leçon proposée (LEC-2, critères 3 à 5)", () => {
  const erreurs = [erreur("us-4#1", "us-4"), erreur("us-7#2", "us-7"), erreur("us-7#3", "us-7", { signature: "sig-b" })];
  it("une leçon rattachée à une section existante, avec ses sources et un exemple parmi elles, est acceptée", () => {
    expect(verifierLecon(lecon(), erreurs)).toEqual([]);
    expect(verifierLecon(lecon({ catalogue: { nouvelle: { skill: CLEAN, titre: "Port déclaré hors du domaine" } } }), erreurs)).toEqual([]);
  });
  it("une référence de catalogue qui ne désigne ni une section existante ni une nouvelle entrée d'un catalogue connu est refusée", () => {
    expect(verifierLecon(lecon({ catalogue: { skill: CLEAN, section: "V-CA-99: Inventée" } }), erreurs)).toEqual([`sig-a : « V-CA-99: Inventée » n'est pas une section de ${CLEAN}.`]);
    expect(verifierLecon(lecon({ catalogue: { nouvelle: { skill: "inconnu.md", titre: "x" } } }), erreurs)[0]).toContain("inconnu.md n'est pas un catalogue");
  });
  it("une source inconnue du registre, ou d'un autre groupe, est refusée ; l'exemple doit être une des sources", () => {
    expect(verifierLecon(lecon({ sources: ["us-4#1", "us-9#9"] }), erreurs)).toEqual(["sig-a : la source us-9#9 n'existe pas dans le registre."]);
    expect(verifierLecon(lecon({ sources: ["us-4#1", "us-7#3"] }), erreurs)).toEqual(["sig-a : la source us-7#3 n'appartient pas à ce groupe d'erreurs."]);
    expect(verifierLecon(lecon({ exemple: "us-7#2" }), erreurs)).toEqual(["sig-a : l'exemple us-7#2 n'est pas une de ses sources."]);
  });
});

describe("Rôle d'une leçon (LEC-2, critère 6)", () => {
  it("tiré de la cible de ses erreurs : test au testeur, code au développeur, livrable à l'agent de la phase", () => {
    expect(roleDeLecon([erreur("a#1", "a", { cible: "test" })])).toBe("skraft-test");
    expect(roleDeLecon([erreur("a#1", "a", { cible: "code" })])).toBe("skraft-dev");
    expect(roleDeLecon([erreur("a#1", "a", { cible: "deliverable", phase: "DISTILL" })])).toBe("skraft-acceptance");
    expect(roleDeLecon([{ id: "a#1", type: "refus", story: "a", phase: "RESEARCH", porte: "citations", signature: "s" }])).toBe("skraft-researcher");
  });
});

describe("Statut d'une leçon (LEC-2, critères 7 à 10)", () => {
  const stories = (n) => Array.from({ length: n }, (_, i) => `s${i + 1}`);
  it("naît candidate, avec un identifiant, son rôle et toutes les erreurs de son groupe pour sources", () => {
    const [l] = mettreAJourLesLecons({ lecons: [], erreurs: [erreur("us-4#1", "us-4")], stories: ["us-4"], proposees: [lecon()] });
    expect(l).toMatchObject({ id: "L-01", statut: "candidate", role: "skraft-dev", phase: "DELIVER", sources: ["us-4#1"] });
  });
  it("devient validée quand ses sources couvrent au moins deux stories ; une nouvelle entrée attend d'être ratifiée", () => {
    const erreurs = [erreur("us-4#1", "us-4"), erreur("us-7#2", "us-7")];
    expect(mettreAJourLesLecons({ lecons: [], erreurs, stories: ["us-4", "us-7"], proposees: [lecon()] })[0]).toMatchObject({ statut: "validee", sources: ["us-4#1", "us-7#2"] });
    const nouvelle = lecon({ catalogue: { nouvelle: { skill: CLEAN, titre: "Port déclaré hors du domaine" } } });
    const [nonRatifiee] = mettreAJourLesLecons({ lecons: [], erreurs, stories: ["us-4", "us-7"], proposees: [nouvelle] });
    expect(nonRatifiee.statut).toBe("candidate");
    expect(mettreAJourLesLecons({ lecons: [{ ...nonRatifiee, ratifiee: true }], erreurs, stories: ["us-4", "us-7"], proposees: [] })[0].statut).toBe("validee");
  });
  it("validée sans nouvelle occurrence pendant 10 stories consécutives : retirée ; une leçon retirée le reste", () => {
    const erreurs = [erreur("s1#1", "s1"), erreur("s2#1", "s2")];
    const [validee] = mettreAJourLesLecons({ lecons: [], erreurs, stories: stories(2), proposees: [lecon({ sources: ["s1#1"], exemple: "s1#1" })] });
    expect(mettreAJourLesLecons({ lecons: [validee], erreurs, stories: stories(11), proposees: [] })[0].statut).toBe("validee");
    const [retiree] = mettreAJourLesLecons({ lecons: [validee], erreurs, stories: stories(12), proposees: [] });
    expect(retiree.statut).toBe("retiree");
    expect(mettreAJourLesLecons({ lecons: [retiree], erreurs: [...erreurs, erreur("s13#1", "s13")], stories: stories(13), proposees: [] })[0].statut).toBe("retiree");
  });
  it("une leçon existante prend les nouvelles occurrences de son groupe ; une leçon proposée pour un groupe déjà couvert est ignorée", () => {
    const [l] = mettreAJourLesLecons({ lecons: [], erreurs: [erreur("us-4#1", "us-4")], stories: ["us-4"], proposees: [lecon()] });
    const apres = mettreAJourLesLecons({ lecons: [l], erreurs: [erreur("us-4#1", "us-4"), erreur("us-9#1", "us-9")], stories: ["us-4", "us-9"], proposees: [lecon({ regle: "doublon" })] });
    expect(apres).toHaveLength(1);
    expect(apres[0]).toMatchObject({ id: "L-01", sources: ["us-4#1", "us-9#1"], statut: "validee", regle: l.regle });
  });
});
