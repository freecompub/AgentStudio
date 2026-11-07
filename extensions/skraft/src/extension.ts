import type { ExtensionContext, ExtensionModule, TaskDefinition } from "@agent-studio/extension-api";
import { skillDArchitecture } from "./architecture.js";
import { runSkraftEffect } from "./effects.js";
import { renderAdrTool } from "./render-adr-tool.js";
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
  checkpointBefore: (e) => ["init", "runSpecialist", "runReview", "commitPhase", "applyAdrStatuses"].includes(e.kind),
  isTerminal,
  phaseOf,
};

const USAGE = "Utilisation : `/skraft <chemin de la story>`, par exemple `/skraft stories/us-12.md`. Ajoutez `--auto` pour confirmer la difficulté automatiquement, et `--archi <skill>` (par exemple `--archi java`) pour la skill d'architecture du projet ; sans elle, la clean architecture par défaut.";

export function parseSkraftArgs(args: string): SkraftInput | null {
  const jetons = args.trim().split(/\s+/).filter(Boolean);
  let confirmDifficulty = true;
  let archi: string | undefined;
  const reste: string[] = [];
  for (let k = 0; k < jetons.length; k++) {
    if (jetons[k] === "--auto") confirmDifficulty = false;
    else if (jetons[k] === "--archi") {
      // Skill d'architecture transmise à l'appel (skills de skraft-plugin v1.15.1).
      archi = jetons[++k];
      if (archi === undefined || archi.startsWith("--")) return null;
    } else reste.push(jetons[k]!);
  }
  if (!reste.length) return null;
  return { storyPath: reste.join(" "), confirmDifficulty, ...(archi ? { archi } : {}) };
}

export const skraftExtension: ExtensionModule = {
  activate(ctx) {
    ctx.tasks.register(skraftTask);
    ctx.tools.register(renderAdrTool(ctx));
    ctx.chat.registerCommand("skraft", async (args) => {
      const input = parseSkraftArgs(args);
      if (!input) return ctx.chat.post(USAGE);
      const { avertissement } = skillDArchitecture(input.archi);
      if (avertissement) ctx.chat.post(avertissement);
      await ctx.tasks.start("skraft-pipeline", input);
      ctx.chat.post(`Pipeline skraft lancé pour **${input.storyPath}** : lecture de la story et évaluation de la difficulté.`);
    });
    ctx.chat.registerCommand("skraft-status", async () => {
      ctx.chat.post("Les pipelines skraft en cours sont affichés dans le panneau des tâches, avec leur phase et les décisions qui vous attendent.");
    });
  },
};
