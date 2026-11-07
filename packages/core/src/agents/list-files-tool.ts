import type { ToolSpec } from "../protocols/agent-runtime.js";
import { matchesAny } from "../guards/glob.js";

/**
 * Outil `list_files` (ADR 0034) : explorer le projet sans shell.
 *
 * Même réponse que pour les tests : l'agent ne lance pas la commande, le code la lui rend — bornée,
 * sans analyse de commande à faire, sans liste blanche à maintenir. Lister un dossier était déjà
 * permis, mais un aller-retour par niveau, et chacun réemporte tout le contexte accumulé.
 */

/**
 * Aucun langage n'apparaît dans les textes rendus à l'agent (D10) : le cœur et les extensions
 * ignorent les langages, seul l'adaptateur de pile les connaît. Un exemple en `.cs` dans la
 * description biaiserait l'agent sur un projet Java ou Python, et ferait entrer une connaissance
 * de pile là où elle n'a rien à faire.
 */

/** Au-delà, la liste est coupée. Un dépôt de dix mille fichiers noierait le contexte qu'il éclaire. */
export const LIMITE_CHEMINS = 200;

export interface ProjectFiles {
  list(): Promise<string[]>;
}

export function listFilesTool(files: ProjectFiles, opts: { beat?: () => void } = {}): ToolSpec {
  return {
    name: "list_files",
    description:
      "Liste les chemins du projet, éventuellement filtrés par un motif glob (`src/**`, `**/tests/**`). C'est la façon d'explorer l'arborescence : aucune commande ne peut être lancée.",
    parameters: {
      type: "object",
      properties: { glob: { type: "string", description: "Motif de filtrage ; tout le projet si absent." } },
      additionalProperties: false,
    },
    async handler(args) {
      opts.beat?.();
      const motif = (args as { glob?: unknown } | null)?.glob;
      if (motif !== undefined && typeof motif !== "string") return "Le motif doit être une chaîne, par exemple `src/**`.";
      const tous = await files.list();
      opts.beat?.();
      const retenus = motif === undefined ? tous : tous.filter((f) => matchesAny([motif], f));
      if (!retenus.length) return motif === undefined ? "Le projet ne contient aucun fichier." : `Aucun fichier ne correspond à \`${motif}\`.`;

      // Une liste tronquée en silence se lit comme une liste complète : l'agent conclurait que le
      // projet ne contient que ce qu'il voit.
      const montrés = retenus.slice(0, LIMITE_CHEMINS);
      const reste = retenus.length - montrés.length;
      return [
        `${retenus.length} fichier(s)${motif === undefined ? "" : ` pour \`${motif}\``} :`,
        ...montrés,
        ...(reste ? [`… et ${reste} autre(s), non listé(s) : affine ton motif.`] : []),
      ].join("\n");
    },
  };
}
