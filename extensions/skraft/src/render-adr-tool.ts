import type { ExtensionContext, ExtensionTool } from "@agent-studio/extension-api";
import { adrId, adrPath, nextAdrNumber, parseAdr, renderAdr, supersessionLine, validateAdrInput, type AdrInput } from "./adr.js";

const ADR_FILE = /^docs\/adr\/adr-(\d{3,})-[^/]+\.md$/;
export const SUPERSESSIONS = "docs/adr/supersessions.md";

/**
 * Outil `render_adr` (§6.5) : seul moyen d'écrire un ADR (aucun rôle n'a d'accès direct à docs/adr).
 * Refuse un champ manquant, un statut autre que Proposed et un numéro déjà pris par un ADR décidé.
 */
export function renderAdrTool(ctx: ExtensionContext, today: () => string = () => new Date().toISOString().slice(0, 10)): ExtensionTool {
  return {
    name: "render_adr",
    description: "Rédige un ADR au statut Proposed dans docs/adr depuis le gabarit du projet. Pour amender un ADR encore proposé, redonne son numéro.",
    parameters: {
      type: "object",
      properties: {
        number: { type: "integer", minimum: 1, description: "Numéro, seulement pour amender un ADR encore proposé" },
        title: { type: "string" },
        status: { type: "string", enum: ["Proposed"] },
        context: { type: "string" },
        decision: { type: "string" },
        consequences: { type: "string" },
        alternatives: { type: "string" },
        supersedes: { type: "array", items: { type: "string", pattern: "^ADR-\\d{3,}$" } },
      },
      required: ["title", "status", "context", "decision", "consequences", "alternatives"],
      additionalProperties: false,
    },
    async handler(raw) {
      const input = raw as AdrInput;
      const errors = validateAdrInput(input);
      if (errors.length) throw new Error(`ADR refusé : ${errors.join(" ; ")}`);

      const existing = (await ctx.workspace.listFiles())
        .map((p) => ({ p, m: ADR_FILE.exec(p) }))
        .filter((x): x is { p: string; m: RegExpExecArray } => !!x.m)
        .map((x) => ({ path: x.p, number: Number(x.m[1]) }));
      let number = nextAdrNumber(existing.map((e) => e.number));
      let path = adrPath(number, input.title);
      if (input.number !== undefined) {
        const same = existing.find((e) => e.number === input.number);
        if (!same) throw new Error(`ADR refusé : ${adrId(input.number)} n'existe pas ; ne donne un numéro que pour amender un ADR proposé.`);
        const status = parseAdr(await ctx.workspace.readFile(same.path)).status;
        if (status !== "Proposed") throw new Error(`ADR refusé : ${adrId(input.number)} est déjà ${status} ; rédige un nouvel ADR qui le remplace.`);
        number = input.number;
        path = same.path;
      }
      await ctx.workspace.writeFile(path, renderAdr(number, input, today()));

      if (input.supersedes?.length) {
        let registry = "";
        try {
          registry = await ctx.workspace.readFile(SUPERSESSIONS);
        } catch {
          registry = "# Remplacements d'ADR\n\n";
        }
        const lines = input.supersedes.map((r) => supersessionLine(adrId(number), r)).filter((l) => !registry.includes(l));
        if (lines.length) await ctx.workspace.writeFile(SUPERSESSIONS, `${registry.replace(/\n*$/, "\n")}${lines.join("\n")}\n`);
      }
      return `${adrId(number)} rédigé : ${path}`;
    },
  };
}
