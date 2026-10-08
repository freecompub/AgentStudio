// Copie de extensions/skraft/test/render-adr-tool.test.ts (2026-10-08) : elle protège la copie du module.
/**
 * Outil `render_adr` face à un essai relancé (ADR 0040).
 *
 * Tant qu'un rejet de porte rembobinait le dépôt, l'ADR du premier essai disparaissait avec lui :
 * l'architecte relancé rappelait `render_adr`, et le numéro 1 était de nouveau libre. Depuis que
 * le réessai n'annule plus rien, ce fichier survit — et le même appel ouvrait un ADR-002 sur la
 * même décision. Deux brouillons de la même décision ne sont pas une décision.
 *
 * On ne compte pas sur le modèle pour redonner son numéro : c'est le code qui reconnaît le
 * brouillon, par son titre, tant que personne ne l'a ratifié.
 */
import { describe, expect, it } from "vitest";
import type { ExtensionContext } from "@agent-studio/extension-api";
import { parseAdr, setAdrStatus } from "../src/adr.js";
import { renderAdrTool } from "../src/render-adr-tool.js";

const INPUT = {
  title: "Plafond appliqué dans le domaine",
  status: "Proposed" as const,
  context: "La dose proposée peut dépasser le plafond du médecin.",
  decision: "Le plafond est appliqué par `BolusCapPolicy` dans le module Domain.",
  consequences: "L'interface affiche l'alerte produite par le domaine.",
  alternatives: "Plafond dans l'interface : rejeté, logique métier hors du domaine.",
};
const CHEMIN = "docs/adr/adr-001-plafond-applique-dans-le-domaine.md";

/** Disque en mémoire : seul `ctx.workspace` est sollicité par l'outil. */
function atelier(fichiers: Record<string, string> = {}) {
  const ctx = {
    workspace: {
      listFiles: async () => Object.keys(fichiers),
      readFile: async (p: string) => {
        const c = fichiers[p];
        if (c === undefined) throw new Error(`absent : ${p}`);
        return c;
      },
      writeFile: async (p: string, c: string) => void (fichiers[p] = c),
    },
  } as unknown as ExtensionContext;
  return { fichiers, outil: renderAdrTool(ctx, () => "2026-09-29") };
}

describe("render_adr : un essai relancé amende son brouillon, il n'en ouvre pas un second", () => {
  it("premier appel : ADR-001", async () => {
    const { fichiers, outil } = atelier();
    expect(await outil.handler(INPUT)).toBe(`ADR-001 rédigé : ${CHEMIN}`);
    expect(Object.keys(fichiers)).toEqual([CHEMIN]);
  });

  it("rappelé sur le même titre sans numéro : réécrit ADR-001, aucun ADR-002", async () => {
    const { fichiers, outil } = atelier();
    await outil.handler(INPUT);
    const r = await outil.handler({ ...INPUT, consequences: "Plafond par prise ; l'interface affiche l'alerte." });
    expect(r).toBe(`ADR-001 rédigé : ${CHEMIN}`);
    expect(Object.keys(fichiers)).toEqual([CHEMIN]);
    expect(fichiers[CHEMIN]).toContain("Plafond par prise");
  });

  it("un ADR décidé n'est pas réécrit : le même titre repart sur un nouveau numéro", async () => {
    // Le brouillon est devenu une décision ratifiée. La réécrire en douce effacerait ce que
    // l'architecte a accepté ; l'outil ouvre un ADR neuf, qui pourra le remplacer explicitement.
    const { fichiers, outil } = atelier();
    await outil.handler(INPUT);
    fichiers[CHEMIN] = setAdrStatus(fichiers[CHEMIN]!, "Accepted");
    const r = await outil.handler(INPUT);
    expect(r).toBe("ADR-002 rédigé : docs/adr/adr-002-plafond-applique-dans-le-domaine.md");
    expect(parseAdr(fichiers[CHEMIN]!).status).toBe("Accepted");
  });

  it("un titre différent reste un ADR différent : on ne fusionne que ce qui porte le même nom", async () => {
    const { fichiers, outil } = atelier();
    await outil.handler(INPUT);
    await outil.handler({ ...INPUT, title: "Journalisation des doses refusées" });
    expect(Object.keys(fichiers)).toHaveLength(2);
  });
});
