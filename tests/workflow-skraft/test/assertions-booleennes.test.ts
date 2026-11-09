/**
 * Assertion booléenne interdite (09/11, demande du responsable) : vérifier un booléen calculé — une
 * comparaison passée à une assertion « vrai » — au lieu de comparer l'obtenu à l'attendu. Son échec
 * ne dit que « faux » : ni l'attendu ni l'obtenu, et le code ne peut pas juger que le rouge est le bon
 * (run du 09/11 : un rouge classé « mauvaise raison »). Interdite à qui écrit les tests, relevée par
 * la revue. La règle ne nomme aucun langage : elle vaut pour tous.
 */
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const AGENTS = resolve(import.meta.dirname, "../../../workflows/skraft/agents");
const corps = (nom: string) => readFile(resolve(AGENTS, `${nom}.agent.md`), "utf8");

describe("Assertion booléenne : interdite aux auteurs de tests, relevée par la revue", () => {
  it("l'agent de test et l'agent d'acceptance l'interdisent, et disent quoi faire à la place", async () => {
    for (const nom of ["skraft-test", "skraft-acceptance"]) {
      const c = await corps(nom);
      expect(c, nom).toMatch(/jamais une assertion sur un booléen calculé/i);
      expect(c, nom).toMatch(/compare l'obtenu à l'attendu/i);
    }
  });

  it("la lentille test-integrity la relève comme défaut majeur", async () => {
    expect(await corps("skraft-lens-test-integrity")).toMatch(/assertion sur un booléen calculé[^\n]*\n?[^\n]*`major`/i);
  });

  it("aucun agent ne nomme une assertion d'un langage particulier", async () => {
    for (const f of (await readdir(AGENTS)).filter((x) => x.endsWith(".agent.md")))
      expect(await readFile(resolve(AGENTS, f), "utf8"), f).not.toMatch(/Assert\.(True|False)|assert(True|False)\b|assert_(true|false)|toBe(Truthy|Falsy)|XCTAssert(True|False)/);
  });
});
