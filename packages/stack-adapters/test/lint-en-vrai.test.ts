/**
 * Le lint contre un **vrai ESLint** (critère `lint-execute-en-vrai`).
 *
 * Jusqu'ici, la qualité de forme n'était couverte que par des tests de lecture de rapport et un
 * lanceur doublé. Or c'est précisément là que le même défaut est revenu **trois fois** le 24/09 :
 * un repli `|| "[]"` qui transformait un échec en « aucune erreur », un filtre de sévérité qui
 * écartait ce que SwiftLint signale par défaut, et des fichiers ignorés par ESLint comptés comme
 * propres. Chaque fois, une porte attestait ce qu'elle n'avait pas mesuré.
 *
 * Ce test ferme la boucle : la commande du profil livré, le vrai binaire, le vrai rapport, et la
 * vérification que `analyzed` ne contient **que** ce qui a réellement été examiné.
 *
 * Aucun LLM, aucun réseau : la CI le lance à chaque poussée.
 */
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProfileAdapter } from "../src/profile/profile-adapter.js";
import { profilLivre } from "./support/profil-livre.js";
import { createNodeProcessRunner } from "../src/process/node-process-runner.js";
import type { ProcessRunner } from "../src/protocols.js";

const RACINE_DEPOT = join(import.meta.dirname, "../../..");
const TEMOIN = join(import.meta.dirname, "fixtures/projet-eslint");
const BIN = join(RACINE_DEPOT, "node_modules/.bin");

/** Le témoin est copié hors du dépôt : on lui expose le binaire, comme le ferait un script pnpm. */
function lanceurReel(): ProcessRunner {
  const reel = createNodeProcessRunner();
  return {
    run: (cmd, args, opts) => reel.run(cmd, args, { ...opts, env: { ...opts.env, PATH: `${BIN}:${process.env["PATH"] ?? ""}` } }),
  };
}

/** Le profil livré, celui qu'un utilisateur copie. */
async function adaptateurLivre() {
  const profil = profilLivre("typescript");
  return createProfileAdapter(profil, { runner: lanceurReel() });
}

let bac: string;
beforeEach(async () => {
  bac = await mkdtemp(join(tmpdir(), "agent-studio-eslint-"));
  await cp(TEMOIN, bac, { recursive: true });
  await symlink(join(RACINE_DEPOT, "node_modules"), join(bac, "node_modules"), "dir");
});
afterEach(() => rm(bac, { recursive: true, force: true }));

const describeSiInstalle = existsSync(join(BIN, "eslint")) ? describe : describe.skip;

describeSiInstalle("Le lint de profiles/typescript.yaml contre le vrai ESLint", () => {
  const lancer = async (fichiers: string[]) => {
    const a = await adaptateurLivre();
    if (!a.lint) throw new Error("le profil livré ne déclare pas de lint");
    return a.lint({ root: bac, files: fichiers });
  };

  it("rend un rapport disponible, en nommant l'outil qui a jugé", async () => {
    const r = await lancer(["src/propre.js"]);
    expect(r.available).toBe(true);
    expect(r.tool).toBe("eslint");
  }, 60_000);

  it("une vraie violation est remontée avec sa règle, son fichier et sa ligne", async () => {
    const r = await lancer(["src/mauvais.js"]);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatchObject({ file: "src/mauvais.js", rule: "no-unused-vars", line: 2 });
  }, 60_000);

  it("un fichier propre ne produit aucune violation, mais figure bien parmi les fichiers examinés", async () => {
    const r = await lancer(["src/propre.js"]);
    expect(r.violations).toEqual([]);
    expect(r.analyzed).toEqual(["src/propre.js"]);
  }, 60_000);

  it("un fichier IGNORÉ par ESLint est absent d'`analyzed` : il n'a pas été jugé, il n'est donc pas propre", async () => {
    // Le défaut du 24/09, contre le vrai outil cette fois. `ignore-moi.js` viole la règle, mais la
    // configuration l'exclut : ESLint rend une entrée sans violation, assortie d'un avertissement
    // sans règle. Le compter comme examiné attesterait une conformité que personne n'a vérifiée.
    const r = await lancer(["src/propre.js", "src/ignore-moi.js"]);
    expect(r.violations).toEqual([]);
    expect(r.analyzed).toEqual(["src/propre.js"]);
    expect(r.analyzed).not.toContain("src/ignore-moi.js");
  }, 60_000);

  it("un fichier inexistant ne fait pas conclure à tort : rien n'a été jugé", async () => {
    // ESLint sort en erreur sans écrire de JSON exploitable ; la porte doit le dire, pas
    // conclure « aucune erreur » sur une sortie vide.
    const r = await lancer(["src/absent-du-disque.js"]);
    expect(r.available).toBe(false);
    expect(r.violations).toEqual([]);
  }, 60_000);
});
