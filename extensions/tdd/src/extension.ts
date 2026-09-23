import type { ExtensionContext, ExtensionModule, TaskDefinition } from "@agent-studio/extension-api";
import { runTddEffect } from "./effects.js";
import type { TddEffect, TddEvent, TddInput, TddState } from "./model.js";
import { initialEffects, initialState, isTerminal, transition } from "./reducer.js";

/** Tâche `tdd-cycle` : réducteur pur + effets exécutés via le seul `ctx`. */
export const tddTask: TaskDefinition<TddState, TddEvent, TddEffect, ExtensionContext> = {
  name: "tdd-cycle",
  initialState: (input) => initialState(input as TddInput),
  initialEffects,
  transition,
  runEffect: runTddEffect,
  // Checkpoint avant tout effet qui écrit (agents, portes qui commitent) ; pas pour le reste.
  checkpointBefore: (e) => e.kind === "runTestAgent" || e.kind === "runDevAgent" || e.kind === "verifyRed" || e.kind === "verifyGreen",
  isTerminal,
};

const USAGE = "Utilisation : `/tdd <fonctionnalité à implémenter>`, par exemple `/tdd plafonner la dose proposée`.";

export const tddExtension: ExtensionModule = {
  activate(ctx) {
    ctx.tasks.register(tddTask);
    ctx.chat.registerCommand("tdd", async (args) => {
      const feature = args.trim();
      if (!feature) return ctx.chat.post(USAGE);
      await ctx.tasks.start("tdd-cycle", { feature } satisfies TddInput);
      ctx.chat.post(`Cycle TDD lancé : **${feature}**. Je découpe d'abord la fonctionnalité en comportements ; le plan vous sera soumis.`);
    });
  },
};
