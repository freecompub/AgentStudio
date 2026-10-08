import type { ExtensionModule } from "@agent-studio/extension-api";
import { skraftWorkflowTask } from "./workflow.js";

const USAGE = "Utilisation : `/skraft-workflow <chemin de la story>`, par exemple `/skraft-workflow stories/us-12.md`. Ajoutez `--auto` pour confirmer la difficulté automatiquement.";

export function parseArgs(args: string): { storyPath: string; confirmDifficulty: boolean } | null {
  let rest = args.trim();
  let confirmDifficulty = true;
  if (/^--auto(\s|$)/.test(rest)) {
    confirmDifficulty = false;
    rest = rest.slice("--auto".length).trim();
  }
  return rest ? { storyPath: rest, confirmDifficulty } : null;
}

export const skraftWorkflowExtension: ExtensionModule = {
  activate(ctx) {
    ctx.tasks.register(skraftWorkflowTask);
    ctx.chat.registerCommand("skraft-workflow", async (args) => {
      const input = parseArgs(args);
      if (!input) return ctx.chat.post(USAGE);
      await ctx.tasks.start("skraft-workflow", input);
      ctx.chat.post(`Workflow skraft lancé pour **${input.storyPath}** (préparation, difficulté, RESEARCH).`);
    });
  },
};
