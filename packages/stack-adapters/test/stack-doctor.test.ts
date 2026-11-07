/**
 * `/stack init` et `/stack doctor` (J5). Les deux fonctions sont pures : elles reçoivent ce
 * qu'on a lu du disque et rendent un texte ou des constats, sans rien exécuter elles-mêmes.
 */
import { describe, expect, it } from "vitest";
import { diagnoseProfile, proposeProfile } from "../src/profile/stack-doctor.js";
import { parseStackProfile } from "../src/profile/stack-profile.js";

const AUTORISES = ["pytest", "vitest", "eslint", "ruff", "stryker"];

describe("proposeProfile — ce que /stack init écrirait", () => {
  it("propose un profil Python quand le projet en porte les marques", () => {
    const yaml = proposeProfile({ fichiers: ["pyproject.toml", "tests/test_a.py"], dependances: [] });
    expect(yaml).not.toBeNull();
    const r = parseStackProfile(yaml!, { allowedPrograms: AUTORISES });
    expect("error" in r ? r.error : r.profile.id).toBe("python");
  });

  it("reconnaît Vitest à la dépendance, pas au seul fichier de configuration", () => {
    const yaml = proposeProfile({ fichiers: ["package.json"], dependances: ["vitest"] });
    const r = parseStackProfile(yaml!, { allowedPrograms: AUTORISES });
    expect("error" in r ? r.error : r.profile.id).toBe("typescript");
  });

  it("ne propose rien plutôt que de deviner", () => {
    expect(proposeProfile({ fichiers: ["README.md"], dependances: [] })).toBeNull();
  });

  it("Swift n'est plus pris en charge : `Package.swift` ne fait rien proposer", () => {
    expect(proposeProfile({ fichiers: ["Package.swift"], dependances: [] })).toBeNull();
  });

  it("ce qui est proposé déclare ses canaris : un profil non vérifiable ne vaut pas d'être écrit", () => {
    for (const indices of [
      { fichiers: ["pyproject.toml"], dependances: [] },
      { fichiers: ["package.json"], dependances: ["vitest"] },
    ]) {
      const r = parseStackProfile(proposeProfile(indices)!, { allowedPrograms: AUTORISES });
      if ("error" in r) throw new Error(r.error);
      expect(r.profile.canaries.map((c) => c.kind).sort()).toEqual(["assertion", "missing_symbol", "passed", "syntax"]);
    }
  });

  it("ce qui est proposé est toujours un profil valide", () => {
    for (const indices of [
      { fichiers: ["pyproject.toml"], dependances: [] },
      { fichiers: ["package.json"], dependances: ["vitest"] },
    ]) {
      const yaml = proposeProfile(indices)!;
      expect("error" in parseStackProfile(yaml, { allowedPrograms: AUTORISES }), yaml).toBe(false);
    }
  });
});

describe("diagnoseProfile — ce que /stack doctor rapporte", () => {
  const profil = (yaml: string) => {
    const r = parseStackProfile(yaml, { allowedPrograms: AUTORISES });
    if ("error" in r) throw new Error(r.error);
    return r.profile;
  };
  const BON = profil(proposeProfile({ fichiers: ["pyproject.toml"], dependances: [] })!);

  it("tout va bien : aucun problème, et les manques facultatifs restent des avertissements", () => {
    const d = diagnoseProfile(BON, {
      programmeTrouvable: () => true,
      cheminExiste: () => true,
      fichiersDeDetectionPresents: true,
    });
    expect(d.filter((x) => x.gravite === "probleme")).toEqual([]);
    // Le modèle Python ne déclare pas d'outil de mutation : c'est dit, sans bloquer.
    expect(d.some((x) => x.gravite === "avertissement" && /mutation/.test(x.message))).toBe(true);
  });

  it("un programme introuvable est un problème, et on dit lequel", () => {
    const d = diagnoseProfile(BON, { programmeTrouvable: (p) => p !== "pytest", cheminExiste: () => true, fichiersDeDetectionPresents: true });
    const pb = d.find((x) => x.gravite === "probleme");
    expect(pb?.message).toMatch(/pytest/);
  });

  it("un emplacement qui ne correspond à rien est un avertissement, pas un blocage", () => {
    const d = diagnoseProfile(BON, { programmeTrouvable: () => true, cheminExiste: () => false, fichiersDeDetectionPresents: true });
    expect(d.some((x) => x.gravite === "avertissement")).toBe(true);
    expect(d.some((x) => x.gravite === "probleme")).toBe(false);
  });

  it("un profil qui ne reconnaîtrait pas son propre projet est signalé", () => {
    const d = diagnoseProfile(BON, { programmeTrouvable: () => true, cheminExiste: () => true, fichiersDeDetectionPresents: false });
    expect(d.find((x) => x.gravite === "probleme")?.message).toMatch(/detect/);
  });

  it("un profil sans canari est signalé : c'est le classement des échecs qui ne sera pas vérifié", () => {
    const sansCanari = { ...BON, canaries: [] };
    const d = diagnoseProfile(sansCanari, { programmeTrouvable: () => true, cheminExiste: () => true, fichiersDeDetectionPresents: true });
    expect(d.some((x) => x.gravite === "avertissement" && /canari/i.test(x.message))).toBe(true);
  });

  it("dit aussi ce qui va, pour que le rapport soit lisible", () => {
    const d = diagnoseProfile(BON, { programmeTrouvable: () => true, cheminExiste: () => true, fichiersDeDetectionPresents: true });
    expect(d.some((x) => x.gravite === "ok")).toBe(true);
  });
});
