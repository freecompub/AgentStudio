/**
 * La frontière de licence entre l'application et l'extension `skraft` (ADR 0012, ADR 0023).
 *
 * `skraft` contient du matériel dérivé de skraft-plugin, sous GPL-3.0-or-later. L'application,
 * elle, est sous licence propriétaire. Ce qui rend les deux compatibles n'est pas une opinion
 * juridique mais **un fait technique** : l'extension n'est pas livrée avec l'application, elle
 * s'installe à part en `.asx` et s'exécute dans son propre processus derrière l'API `ctx`.
 *
 * Or ce fait n'est protégé par rien. Un `pnpm add` distrait suffirait à faire de `skraft` une
 * dépendance de `apps/desktop`, et l'argument tomberait sans que personne ne s'en aperçoive —
 * la GPL s'appliquerait alors à l'ensemble distribué. D'où ce test.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dependancesInterdites } from "../src/licence.js";

const RACINE = join(import.meta.dirname, "../../..");
const lire = (rel: string) => JSON.parse(readFileSync(join(RACINE, rel), "utf8")) as Record<string, unknown>;

describe("Frontière de licence entre l'application et skraft", () => {
  it("l'application ne dépend pas de l'extension skraft, et c'est ce qui tient la frontière", () => {
    expect(dependancesInterdites(lire("apps/desktop/package.json"), ["@agent-studio/ext-skraft"])).toEqual([]);
  });

  it("le garde-fou détecte la violation, sinon il ne garde rien", () => {
    const viole = { dependencies: { "@agent-studio/ext-skraft": "workspace:*" } };
    expect(dependancesInterdites(viole, ["@agent-studio/ext-skraft"])).toEqual(["@agent-studio/ext-skraft"]);
  });

  it("une dépendance de développement compte aussi : elle finit dans l'arbre installé", () => {
    const viole = { devDependencies: { "@agent-studio/ext-skraft": "workspace:*" } };
    expect(dependancesInterdites(viole, ["@agent-studio/ext-skraft"])).toEqual(["@agent-studio/ext-skraft"]);
  });

  it("l'extension déclare la licence dont elle dérive, et l'application la sienne", () => {
    expect(lire("extensions/skraft/package.json")["license"]).toBe("GPL-3.0-or-later");
    expect(lire("package.json")["license"]).toBe("UNLICENSED");
    expect(lire("apps/desktop/package.json")["license"]).toBe("UNLICENSED");
  });

  it("le texte de la GPL est versé auprès de l'extension : la licence l'exige de qui la distribue", () => {
    const gpl = readFileSync(join(RACINE, "extensions/skraft/LICENSE"), "utf8");
    expect(gpl).toMatch(/GNU GENERAL PUBLIC LICENSE/);
    expect(gpl).toMatch(/Version 3, 29 June 2007/);
  });
});
