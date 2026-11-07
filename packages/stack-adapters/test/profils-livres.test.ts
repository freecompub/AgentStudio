/**
 * Les profils d'exemple livrés dans `profiles/` doivent rester valides : ce sont eux qu'on
 * copiera dans un projet, et un exemple faux se propagerait. Chacun est un `projet.yaml` complet
 * (ADR 0071) : section `pile` et section `qualite`.
 */
import { describe, expect, it } from "vitest";
import { lireExempleLivre as lire, profilLivre as charger } from "./support/profil-livre.js";
import { createProfileAdapter } from "../src/profile/profile-adapter.js";
import { lireFichierProjet } from "../src/profile/fichier-projet.js";
import { parseQualityBar } from "../src/profile/quality-bar.js";

describe("Profils d'exemple livrés", () => {
  it.each(["typescript"])("%s est valide et ses programmes sont autorisés par défaut", (nom) => {
    const p = charger(nom);
    expect(p.id).toBe(nom);
    expect(p.layout.sources.length).toBeGreaterThan(0);
    // Détection au contenu (ADR 0072) : la présence d'un fichier de configuration ne suffit plus.
    expect(p.detect).toContainEqual({ fichier: "package.json", contient: '"vitest"' });
  });

  it("chacun est un projet.yaml complet : pile et qualite valides (ADR 0071)", () => {
    for (const nom of ["typescript"]) {
      const projet = lireFichierProjet(lire(nom));
      expect(projet, nom).toEqual({ pile: expect.any(String), qualite: expect.any(String) });
      const barre = parseQualityBar({ projet: lire(nom) });
      if ("error" in barre) throw new Error(`${nom} : ${barre.error}`);
      expect(barre.declaredCore, nom).toEqual(["domaine", "application"]);
    }
  });

  it("chacun donne un adaptateur utilisable", () => {
    for (const nom of ["typescript"]) {
      const a = createProfileAdapter(charger(nom));
      expect(a.lint).toBeDefined();
      expect(a.format).toBeDefined();
      expect(a.mutation).toBeDefined();
      expect(typeof a.runTests).toBe("function");
    }
  });

  it("chacun déclare des canaris, sans quoi `/stack doctor` ne vérifierait rien", () => {
    for (const nom of ["typescript"]) {
      const kinds = charger(nom).canaries.map((c) => c.kind);
      // `passed`, `assertion` et `syntax` au minimum : le trio qui prouve que la porte RED
      // distingue un rouge légitime d'un code qui ne compile pas.
      expect(kinds, nom).toEqual(expect.arrayContaining(["passed", "assertion", "syntax"]));
    }
  });

  it("ce qu'un profil ne sait pas encore exprimer reste absent, plutôt que faux", () => {
    // L'analyse des imports n'a pas de section dans le schéma : avec un profil, la règle de
    // dépendance n'est pas vérifiée, et la porte le dit — elle n'invente pas un résultat.
    expect(createProfileAdapter(charger("typescript")).architecture).toBeUndefined();
  });
});
