/**
 * Casse des chemins (ADR 0035).
 *
 * L'extension vise Windows, macOS et Linux. Les deux premiers ont un système de fichiers
 * **insensible à la casse** par défaut — vérifié sur la machine de développement : `minuscule.txt`
 * et `MINUSCULE.TXT` y désignent le même fichier.
 *
 * Or `globToRegExp` compilait sans le drapeau `i`. Le gel de `.skraft/quality.json` — la barre de
 * qualité que la porte lit pour juger — se contournait donc par une majuscule : `.skraft/**`
 * accordait l'écriture, `.skraft/quality.json` ne correspondait pas à `.skraft/QUALITY.JSON`, et le
 * même fichier était écrit. Même chose pour les tests d'acceptance gelés et pour `.git`.
 *
 * La règle est **asymétrique**, et les deux moitiés vont dans le même sens — refuser par défaut :
 *   - **refuser** (gel, lecture seule, `.git`) : insensible, pour attraper plus ;
 *   - **autoriser** (périmètre d'écriture) : sensible, pour accorder moins — sur un Linux sensible
 *     à la casse, `.SKRAFT/` est un autre dossier, qu'on n'a aucune raison d'ouvrir.
 */
import { describe, expect, it } from "vitest";
import { matchesAny, matchesAnyIgnoringCase } from "../src/glob.js";

describe("matchesAny — pour ACCORDER, sensible à la casse", () => {
  it("accorde ce qui correspond exactement", () => {
    expect(matchesAny([".skraft/**"], ".skraft/us-2/research.md")).toBe(true);
  });

  it("n'accorde pas un chemin de casse différente : ailleurs, c'est un autre dossier", () => {
    expect(matchesAny([".skraft/**"], ".SKRAFT/us-2/research.md")).toBe(false);
  });
});

describe("matchesAnyIgnoringCase — pour REFUSER, insensible à la casse", () => {
  it("attrape le chemin exact", () => {
    expect(matchesAnyIgnoringCase([".skraft/quality.json"], ".skraft/quality.json")).toBe(true);
  });

  it("attrape la majuscule qui contournait le gel", () => {
    expect(matchesAnyIgnoringCase([".skraft/quality.json"], ".skraft/QUALITY.JSON")).toBe(true);
    expect(matchesAnyIgnoringCase([".skraft/quality.json"], ".SKRAFT/Quality.Json")).toBe(true);
  });

  it("n'attrape pas un chemin réellement différent", () => {
    expect(matchesAnyIgnoringCase([".skraft/quality.json"], ".skraft/qualites.json")).toBe(false);
  });

  it("garde la structure du glob : la casse change, pas la forme", () => {
    expect(matchesAnyIgnoringCase(["tests/**/*.feature"], "TESTS/ac/Panier.FEATURE")).toBe(true);
    expect(matchesAnyIgnoringCase(["tests/**/*.feature"], "tests/ac/Panier.md")).toBe(false);
  });
});
