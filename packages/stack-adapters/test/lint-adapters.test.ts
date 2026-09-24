/**
 * Le linter vu depuis l'adaptateur, avec un lanceur de processus doublé rejouant de vraies
 * sorties. Ces cas-là sont ceux qui comptent : une porte qui conclut « sans erreur » alors que
 * l'outil a échoué verse aux lentilles de revue un fait que personne n'a vérifié.
 */
import { describe, expect, it } from "vitest";
import { createTypeScriptAdapter } from "../src/typescript/typescript-adapter.js";
import { createSwiftAdapter } from "../src/swift/swift-adapter.js";
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

describe("SwiftLint vu de l'adaptateur", () => {
  const swift = (r: ProcessResult) => createSwiftAdapter({ runner: runner(r) });

  it("violations trouvées : swiftlint sort en 2, et c'est un succès", async () => {
    const json = JSON.stringify([
      { file: "/p/Sources/A.swift", line: 3, severity: "Warning", reason: "trop long", rule_id: "function_body_length" },
    ]);
    const r = await swift(sortie({ exitCode: 2, stdout: json })).lint!({ root: "/p" });
    expect(r).toMatchObject({ available: true, tool: "swiftlint" });
    expect(r.violations).toHaveLength(1);
  });

  it("configuration illisible : sortie vide et code inattendu ne valent pas « sans erreur »", async () => {
    // C'est le cas qui faisait mentir la porte : `stdout` vide traité comme un rapport vide.
    expect(await swift(sortie({ exitCode: 1, stderr: "Could not read configuration" })).lint!({ root: "/p" })).toEqual({
      available: false,
      violations: [],
    });
  });

  it("sortie vide malgré un code normal : rien n'a été jugé", async () => {
    expect(await swift(sortie({ exitCode: 0, stdout: "  \n" })).lint!({ root: "/p" })).toEqual({ available: false, violations: [] });
  });

  it("délai dépassé : rien n'a été jugé", async () => {
    expect(await swift(sortie({ timedOut: true })).lint!({ root: "/p" })).toEqual({ available: false, violations: [] });
  });

  it("les chemins passent après `--` : un nom commençant par un tiret n'est pas une option", async () => {
    const run = runner(sortie({ stdout: "[]" }));
    await createSwiftAdapter({ runner: run }).lint!({ root: "/p", files: ["-Sources/A.swift"] });
    const args = run.argv[0]!;
    expect(args[args.indexOf("-Sources/A.swift") - 1]).toBe("--");
  });
});

describe("ESLint vu de l'adaptateur", () => {
  it("sans eslint installé, rien n'est jugé", async () => {
    const r = await createTypeScriptAdapter({ runner: runner(sortie()) }).lint!({ root: "/projet/sans/eslint" });
    expect(r).toEqual({ available: false, violations: [] });
  });
});
