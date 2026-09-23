import type { ExtensionContext, ExtensionModule, TaskDefinition } from "@agent-studio/extension-api";
import { runSkraftEffect } from "./effects.js";
import type { SkraftEffect, SkraftEvent, SkraftInput, SkraftState } from "./model.js";
import { initialEffects, initialState, isTerminal, phaseOf, transition } from "./reducer.js";

/** Tâche `skraft-pipeline` : réducteur pur + effets via le seul `ctx`. */
export const skraftTask: TaskDefinition<SkraftState, SkraftEvent, SkraftEffect, ExtensionContext> = {
  name: "skraft-pipeline",
  initialState: (input) => initialState(input as SkraftInput),
  initialEffects,
  transition,
  runEffect: runSkraftEffect,
  // Checkpoint avant tout effet qui écrit ou lance un agent (D23).
  checkpointBefore: (e) => ["init", "runSpecialist", "runReview", "commitPhase"].includes(e.kind),
  isTerminal,
  phaseOf,
};

const USAGE = "Utilisation : `/skraft <chemin de la story>`, par exemple `/skraft stories/us-12.md`. Ajoutez `--auto` pour confirmer la difficulté automatiquement.";

export function parseSkraftArgs(args: string): SkraftInput | null {
  let rest = args.trim();
  let confirmDifficulty = true;
  if (/^--auto(\s|$)/.test(rest)) {
    confirmDifficulty = false;
    rest = rest.slice("--auto".length).trim();
  }
  return rest ? { storyPath: rest, confirmDifficulty } : null;
}

export const skraftExtension: ExtensionModule = {
  activate(ctx) {
    ctx.tasks.register(skraftTask);
    ctx.chat.registerCommand("skraft", async (args) => {
      const input = parseSkraftArgs(args);
      if (!input) return ctx.chat.post(USAGE);
      await ctx.tasks.start("skraft-pipeline", input);
      ctx.chat.post(`Pipeline skraft lancé pour **${input.storyPath}** : lecture de la story et évaluation de la difficulté.`);
    });
    ctx.chat.registerCommand("skraft-status", async () => {
      ctx.chat.post("Les pipelines skraft en cours sont affichés dans le panneau des tâches, avec leur phase et les décisions qui vous attendent.");
    });
  },
};
