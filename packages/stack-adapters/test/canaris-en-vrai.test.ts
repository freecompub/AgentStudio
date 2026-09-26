/**
 * Les canaris contre un **vrai lanceur de tests** (critère `canaris-contre-un-vrai-lanceur`).
 *
 * Tout le reste de la suite éprouve les canaris contre des lanceurs doublés : cela vérifie
 * l'oracle, jamais les gabarits. Rien ne prouvait que `vitest` découvre bien
 * `src/canari_<marque>.test.ts`, ni qu'un `fonctionAbsente()` produise un message que nos motifs
 * reconnaissent, ni qu'une syntaxe cassée ressorte en `other_error` plutôt qu'en `assertion`.
 * C'est exactement ce que `/stack doctor` est censé apprendre d'un projet, et c'était la seule
 * chose que nos tests ne pouvaient pas dire.
 *
 * Aucun LLM n'intervient ici, et aucune requête réseau : uniquement `vitest`, que le dépôt
 * possède déjà. Ce test peut donc tourner en CI.
 */
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCanaries } from "../src/profile/canaries.js";
import { parseStackProfile } from "../src/profile/stack-profile.js";
import { createNodeProcessRunner } from "../src/process/node-process-runner.js";
import type { ProcessRunner } from "../src/protocols.js";
import { DEFAULT_ALLOWED_PROGRAMS_FOR_TESTS as AUTORISES } from "./support/programmes.js";

const RACINE_DEPOT = join(import.meta.dirname, "../../..");
const TEMOIN = join(import.meta.dirname, "fixtures/projet-vitest");
const BIN = join(RACINE_DEPOT, "node_modules/.bin");

/**
 * Lanceur réel, avec deux ajustements que tout projet a naturellement et que notre banc n'a pas.
 *
 * `PATH` : le projet-témoin est copié hors du dépôt, donc `vitest` n'y est pas installé ; on
 * expose le binaire du dépôt, comme le ferait un script pnpm.
 *
 * Les variables `VITEST_*` : nous sommes **nous-mêmes** dans Vitest, et il les pose dans
 * l'environnement. Héritées, elles font croire au Vitest fils qu'il tourne dans un worker du
 * père. Vidées plutôt que supprimées, `ProcessOptions.env` ne sachant que surcharger.
 */
function lanceurReel(): ProcessRunner {
  const reel = createNodeProcessRunner();
  return {
    run: (cmd, args, opts) =>
      reel.run(cmd, args, {
        ...opts,
        env: {
          ...opts.env,
          PATH: `${BIN}:${process.env["PATH"] ?? ""}`,
          VITEST: "",
          VITEST_POOL_ID: "",
          VITEST_WORKER_ID: "",
          VITEST_MODE: "",
        },
      }),
  };
}

/** Le profil livré, celui qu'un utilisateur copie : c'est lui qu'il faut éprouver, pas une copie. */
async function profilLivre() {
  const brut = await readFile(join(RACINE_DEPOT, "profiles/typescript.yaml"), "utf8");
  const r = parseStackProfile(brut, { allowedPrograms: AUTORISES });
  if ("error" in r) throw new Error(r.error);
  return r.profile;
}

let bac: string;
beforeEach(async () => {
  bac = await mkdtemp(join(tmpdir(), "agent-studio-temoin-"));
  await cp(TEMOIN, bac, { recursive: true });
  // Les dépendances du dépôt, plutôt qu'un `pnpm install` par exécution.
  await symlink(join(RACINE_DEPOT, "node_modules"), join(bac, "node_modules"), "dir");
});
afterEach(() => rm(bac, { recursive: true, force: true }));

// Cinq exécutions de Vitest : le relevé initial, puis un canari à la fois.
const describeSiInstalle = existsSync(join(BIN, "vitest")) ? describe : describe.skip;

describeSiInstalle("Les canaris de profiles/typescript.yaml contre le vrai Vitest", () => {
  it(
    "les quatre genres ressortent tels que l'oracle les attend",
    async () => {
      const { constats, observations } = await runCanaries(await profilLivre(), { runner: lanceurReel(), sandboxRoot: bac });
      const lisible = constats.map((c) => `${c.gravite} — ${c.message}`).join("\n");

      // Le relevé initial doit voir le test du projet-témoin : sinon rien de ce qui suit ne vaut.
      expect(constats[0]?.gravite, lisible).toBe("ok");
      expect(constats[0]?.message).toMatch(/1 test/);

      // Chaque canari a été vu et jugé.
      expect(observations.map((o) => o.kind).sort(), lisible).toEqual(["assertion", "missing_symbol", "passed", "syntax"]);

      // Et surtout : chaque canari ressort `ok`. Se contenter de « aucun problème » laisserait
      // passer quatre avertissements, c'est-à-dire un classement inexact partout.
      const parGenre = new Map(observations.map((o, i) => [o.kind, constats[i + 1]]));
      for (const genre of ["passed", "assertion", "missing_symbol", "syntax"] as const) {
        expect(parGenre.get(genre)?.gravite, `${genre} → ${parGenre.get(genre)?.message}\n\n${lisible}`).toBe("ok");
      }
    },
    5 * 60_000,
  );
});
