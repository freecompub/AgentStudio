// @ts-nocheck — le workflow est en JavaScript, sans types (ADR 0055) : ce test vérifie son comportement, pas ses types.
/**
 * Revue de la PR #12 : sous Vitest, `@agent-studio/workflow` est un alias vers les exports nommés
 * de la bibliothèque des scripts. Un nom importé par le workflow et absent de ces exports vaut
 * `undefined` en test : la branche qui l'utilise lèverait un `TypeError` au lieu d'être vérifiée.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
// Ce que voient les scripts du workflow sous Vitest : l'alias ne vaut que pour les fichiers de workflows/.
import * as lib from "../../../packages/workflow/src/hote/pour-les-scripts.js";
import { describe, expect, it } from "vitest";
import { WORKFLOW_DIR } from "./support/harness.js";

describe("Bibliothèque des scripts sous Vitest", () => {
  it("chaque nom importé de @agent-studio/workflow par le workflow est défini", async () => {
    const manquants: string[] = [];
    for (const f of (await readdir(WORKFLOW_DIR)).filter((x) => x.endsWith(".mjs"))) {
      const source = await readFile(join(WORKFLOW_DIR, f), "utf8");
      for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@agent-studio\/workflow"/g))
        for (const nom of m[1].split(",").map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean))
          if (lib[nom] === undefined) manquants.push(`${f} : ${nom}`);
    }
    expect(manquants).toEqual([]);
  });
});
