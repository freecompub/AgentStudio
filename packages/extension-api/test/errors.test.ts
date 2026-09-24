/**
 * Ces erreurs franchissent la frontière de processus par leur `name` : l'hôte les reconstruit
 * d'après ce nom (`extension-host/src/rpc/endpoint.ts`). Le contrat est donc le nom, pas la classe.
 */
import { describe, expect, it } from "vitest";
import { EnvFailureError, TurnTimeoutError, WorkDefectError } from "../src/errors.js";
import { matchesAny } from "@agent-studio/stack-adapters";

describe("Erreurs exposées aux extensions", () => {
  it("portent le nom attendu par l'hôte", () => {
    expect(new WorkDefectError("x").name).toBe("WorkDefectError");
    expect(new EnvFailureError("x").name).toBe("EnvFailureError");
    expect(new TurnTimeoutError(90_000).name).toBe("TurnTimeoutError");
  });

  it("un silence d'agent est un défaut de travail, pas un défaut d'environnement", () => {
    const e = new TurnTimeoutError(90_000);
    expect(e).toBeInstanceOf(WorkDefectError);
    expect(e.message).toContain("90 s");
  });

  it("conservent la cause d'origine", () => {
    const cause = new Error("racine");
    expect(new EnvFailureError("x", { cause }).cause).toBe(cause);
  });
});

describe("matchesAny", () => {
  it.each([
    [["src/**"], "src/a/b.ts", true],
    [["src/**"], "tests/a.ts", false],
    [["*.md"], "README.md", true],
    [["*.md"], "docs/README.md", false],
    [["docs/**/*.md"], "docs/adr/0001.md", true],
    [["a?.ts"], "ab.ts", true],
    [["a?.ts"], "abc.ts", false],
  ])("%s contre %s → %s", (globs, chemin, attendu) => {
    expect(matchesAny(globs, chemin)).toBe(attendu);
  });

  it("les caractères spéciaux d'une regex sont pris au pied de la lettre", () => {
    expect(matchesAny(["a.b.ts"], "a.b.ts")).toBe(true);
    expect(matchesAny(["a.b.ts"], "axbyts")).toBe(false);
  });

  it("aucun motif ne correspond à rien", () => {
    expect(matchesAny([], "a.ts")).toBe(false);
  });
});
