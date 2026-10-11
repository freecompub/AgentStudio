/**
 * Le linter vu depuis l'adaptateur, avec un lanceur de processus doublé rejouant de vraies
 * sorties. Ces cas-là sont ceux qui comptent : une porte qui conclut « sans erreur » alors que
 * l'outil a échoué verse aux lentilles de revue un fait que personne n'a vérifié.
 */
import { describe, expect, it } from "vitest";
import { createTypeScriptAdapter } from "../src/typescript/typescript-adapter.js";
import type { ProcessResult, ProcessRunner } from "../src/protocols.js";

const sortie = (over: Partial<ProcessResult> = {}): ProcessResult => ({
  exitCode: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  durationMs: 1,
  ...over,
});

function runner(reponse: ProcessResult): ProcessRunner & { argv: string[][] } {
  const argv: string[][] = [];
  return {
    argv,
    async run(cmd, args) {
      argv.push([cmd, ...args]);
      return reponse;
    },
  };
}

describe("ESLint vu de l'adaptateur", () => {
  it("sans eslint installé, rien n'est jugé", async () => {
    const r = await createTypeScriptAdapter({ runner: runner(sortie()) }).lint!({ root: "/projet/sans/eslint" });
    expect(r).toEqual({ available: false, violations: [] });
  });
});
