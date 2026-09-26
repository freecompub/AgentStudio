/**
 * Chemins rapportés par les outils, ramenés à la racine du projet.
 *
 * Défaut trouvé le 26/09 en faisant tourner un **vrai** ESLint : les outils rapportent des chemins
 * réels, et sous macOS `tmpdir()` passe par `/var`, lien vers `/private/var`. Sans résoudre la
 * racine, `relative()` rendait `../../../../private/var/…/src/a.js` au lieu de `src/a.js`. Comme
 * les portes rapprochent `analyzed` des fichiers qu'elles ont demandés, plus rien ne correspondait :
 * la porte concluait « rien n'a été jugé » alors que le linter avait parfaitement travaillé.
 *
 * Trois lecteurs sur quatre avaient ce défaut ; seul `parseVitestReport` résolvait la racine.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { relatifDepuis } from "../src/chemin-relatif.js";

let racine: string;
beforeEach(async () => {
  racine = await mkdtemp(join(tmpdir(), "agent-studio-chemin-"));
});
afterEach(() => rm(racine, { recursive: true, force: true }));

describe("relatifDepuis", () => {
  it("ramène un chemin réel à la racine, même quand celle-ci passe par un lien symbolique", () => {
    // C'est le cas de tous les tests sous macOS, et de tout projet placé derrière un lien.
    const reel = join(realpathSync(racine), "src/a.js");
    expect(relatifDepuis(racine, reel)).toBe("src/a.js");
  });

  it("laisse un chemin déjà relatif tel quel", () => {
    expect(relatifDepuis(racine, "src/a.js")).toBe("src/a.js");
  });

  it("normalise les séparateurs Windows", () => {
    expect(relatifDepuis(racine, "src\\a.js")).toBe("src/a.js");
  });

  it("tolère une racine inexistante : les politiques se testent sur des chemins fictifs", () => {
    expect(relatifDepuis("/projet/fictif", "/projet/fictif/src/a.js")).toBe("src/a.js");
  });

  it("un fichier réellement hors du projet reste hors du projet", () => {
    // La résolution ne doit pas faire rentrer dans le projet ce qui n'y est pas.
    expect(relatifDepuis(racine, "/etc/passwd")).toMatch(/^\.\./);
  });
});
