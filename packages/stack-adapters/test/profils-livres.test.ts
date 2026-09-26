/**
 * Les profils d'exemple livrés dans `profiles/` doivent rester valides : ce sont eux qu'on
 * copiera dans un projet, et un exemple faux se propagerait.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ALLOWED_PROGRAMS_FOR_TESTS as AUTORISES } from "./support/programmes.js";
import { parseStackProfile } from "../src/profile/stack-profile.js";
import { createProfileAdapter } from "../src/profile/profile-adapter.js";

const RACINE = join(import.meta.dirname, "../../..", "profiles");
const lire = (nom: string) => readFileSync(join(RACINE, `${nom}.yaml`), "utf8");

const charger = (nom: string) => {
  const r = parseStackProfile(lire(nom), { allowedPrograms: AUTORISES });
  if ("error" in r) throw new Error(`${nom} : ${r.error}`);
  return r.profile;
};

describe("Profils d'exemple livrés", () => {
  it.each(["typescript", "swift"])("%s est valide et ses programmes sont autorisés par défaut", (nom) => {
    const p = charger(nom);
    expect(p.id).toBe(nom);
    expect(p.layout.sources.length).toBeGreaterThan(0);
  });

  it("chacun donne un adaptateur utilisable", () => {
    for (const nom of ["typescript", "swift"]) {
      const a = createProfileAdapter(charger(nom));
      expect(a.lint).toBeDefined();
      expect(a.mutation).toBeDefined();
      expect(typeof a.runTests).toBe("function");
    }
  });

  it("chacun déclare des canaris, sans quoi `/stack doctor` ne vérifierait rien", () => {
    for (const nom of ["typescript", "swift"]) {
      const kinds = charger(nom).canaries.map((c) => c.kind);
      // `passed`, `assertion` et `syntax` au minimum : le trio qui prouve que la porte RED
      // distingue un rouge légitime d'un code qui ne compile pas.
      expect(kinds, nom).toEqual(expect.arrayContaining(["passed", "assertion", "syntax"]));
    }
  });

  it("ce qu'un profil ne sait pas encore exprimer reste absent, plutôt que faux", () => {
    // L'analyse des imports n'a pas de section dans le schéma : avec un profil, la règle de
    // dépendance n'est pas vérifiée, et la porte le dit — elle n'invente pas un résultat.
    expect(createProfileAdapter(charger("swift")).architecture).toBeUndefined();
  });
});
