/**
 * La garde du mode d'essai.
 *
 * Ce mode remplace le runtime d'agent par un double et feint une session GitHub : il rend les
 * essais de bout en bout possibles sans jamais appeler Copilot. Mais un mode qui désactive
 * l'authentification ne doit **jamais** pouvoir être activé dans une application distribuée, et
 * une variable d'environnement ne protège rien — c'est la chose la plus facile à poser.
 *
 * D'où la seconde condition, qui est la vraie : l'application ne doit pas être empaquetée.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fabriquesDEssai, modeEssaiActif } from "../src/main/mode-essai.js";

const VARIABLE = "AGENT_STUDIO_MODE_ESSAI";
let avant: string | undefined;
beforeEach(() => {
  avant = process.env[VARIABLE];
});
afterEach(() => {
  if (avant === undefined) delete process.env[VARIABLE];
  else process.env[VARIABLE] = avant;
});

describe("modeEssaiActif", () => {
  it("une application EMPAQUETÉE refuse le mode, même avec la variable posée", () => {
    process.env[VARIABLE] = "1";
    expect(modeEssaiActif({ isPackaged: true })).toBe(false);
  });

  it("hors paquet, la variable doit valoir exactement « 1 »", () => {
    for (const valeur of ["0", "", "true", "oui", "1 "]) {
      process.env[VARIABLE] = valeur;
      expect(modeEssaiActif({ isPackaged: false }), valeur).toBe(false);
    }
    process.env[VARIABLE] = "1";
    expect(modeEssaiActif({ isPackaged: false })).toBe(true);
  });

  it("sans variable, le mode est inactif", () => {
    delete process.env[VARIABLE];
    expect(modeEssaiActif({ isPackaged: false })).toBe(false);
    expect(modeEssaiActif({ isPackaged: true })).toBe(false);
  });
});

describe("fabriquesDEssai", () => {
  it("le jeton rendu n'est pas un vrai jeton, et son nom le dit", async () => {
    // Si ce double partait quand même vers un vrai service, la trace doit être lisible.
    expect(await fabriquesDEssai().auth.token()).toMatch(/essai/);
  });

  it("le runtime est le MÊME d'un appel à l'autre : l'essai script ses comportements avant de discuter", async () => {
    const f = fabriquesDEssai();
    expect(f.runtimeFactory("x")).toBe(f.runtimeFactory("y"));
  });

  it("le runtime rendu est un double, jamais l'adaptateur Copilot", () => {
    expect(fabriquesDEssai().runtimeFactory("x").id).toBe("fake");
  });

  it("le sélecteur de dossier ne montre aucune boîte : il rend ce que l'essai a posé", async () => {
    const f = fabriquesDEssai();
    expect(await f.folderPicker.pick()).toBeNull();
    process.env["AGENT_STUDIO_ESSAI_PROJET"] = "/tmp/projet-d-essai";
    try {
      expect(await fabriquesDEssai().folderPicker.pick()).toBe("/tmp/projet-d-essai");
    } finally {
      delete process.env["AGENT_STUDIO_ESSAI_PROJET"];
    }
  });
});
