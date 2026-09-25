/**
 * Conversion des globs en expressions régulières. Ces motifs viennent du `layout` d'un profil de
 * stack, donc du dépôt du projet : ils ne sont pas fiables, et ils sont évalués dans le processus
 * principal comme dans les extensions.
 */
import { describe, expect, it } from "vitest";
import { globToRegExp, matchesAny } from "../src/glob.js";

describe("globToRegExp", () => {
  it.each([
    ["src/**", "src/a/b.ts", true],
    ["src/**", "tests/a.ts", false],
    ["tests/**/*.test.ts", "tests/unit/a.test.ts", true],
    ["tests/**/*.test.ts", "tests/a.test.ts", true],
    ["src/*.ts", "src/a.ts", true],
    ["src/*.ts", "src/a/b.ts", false],
    ["src/?.ts", "src/a.ts", true],
    ["src/a.ts", "src/a.tsx", false],
  ] as const)("%s contre %s → %s", (glob, chemin, attendu) => {
    expect(globToRegExp(glob).test(chemin)).toBe(attendu);
  });

  it("les `**` consécutifs sont repliés, et le motif reste immédiat à évaluer", () => {
    // Sans repli, quatorze `**/` contre vingt segments prenaient 170 secondes pour un seul
    // `test()` — un profil suffisait à figer le processus principal.
    const glob = `${"**/".repeat(14)}x.ts`;
    const chemin = `${Array.from({ length: 20 }, (_, i) => `d${i}`).join("/")}/y.ts`;
    const debut = Date.now();
    expect(globToRegExp(glob).test(chemin)).toBe(false);
    expect(Date.now() - debut).toBeLessThan(500);
  });

  it("le repli ne change pas le sens : `**/**/x` reconnaît ce que `**/x` reconnaît", () => {
    for (const chemin of ["x.ts", "a/x.ts", "a/b/c/x.ts"]) {
      expect(globToRegExp("**/**/**/x.ts").test(chemin), chemin).toBe(globToRegExp("**/x.ts").test(chemin));
    }
  });

  it("`matchesAny` reste immédiat sur une liste de motifs hostiles", () => {
    const hostiles = Array.from({ length: 5 }, () => `${"**/".repeat(12)}z.ts`);
    const debut = Date.now();
    expect(matchesAny(hostiles, `${Array.from({ length: 24 }, (_, i) => `d${i}`).join("/")}/y.ts`)).toBe(false);
    expect(Date.now() - debut).toBeLessThan(500);
  });
});
