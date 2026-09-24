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
  checkpointBefore: (e) =>
    e.kind === "runPairAgent" || e.kind === "verifyCycle" || e.kind === "runTestAgent" || e.kind === "runDevAgent" || e.kind === "verifyRed" || e.kind === "verifyGreen",
  isTerminal,
};

const USAGE =
  "Utilisation : `/tdd <fonctionnalité à implémenter>`, par exemple `/tdd plafonner la dose proposée`. Ajoutez `--strict` pour une session par étape rouge, verte et nettoyage.";

/** `/tdd [--strict] <fonctionnalité>` */
export function parseTddArgs(args: string): TddInput | null {
  let rest = args.trim();
  let granularity: TddInput["granularity"] = "turn";
  if (/^--strict(\s|$)/.test(rest)) {
    granularity = "strict";
    rest = rest.slice("--strict".length).trim();
  }
  return rest ? { feature: rest, granularity } : null;
}

export const tddExtension: ExtensionModule = {
  activate(ctx) {
    ctx.tasks.register(tddTask);
    ctx.chat.registerCommand("tdd", async (args) => {
      const input = parseTddArgs(args);
      if (!input) return ctx.chat.post(USAGE);
      await ctx.tasks.start("tdd-cycle", input);
      ctx.chat.post(
        `Cycle TDD lancé : **${input.feature}**${input.granularity === "strict" ? " (mode pas à pas)" : ""}. Je découpe d'abord la fonctionnalité en comportements ; le plan vous sera soumis.`,
      );
    });
  },
};
