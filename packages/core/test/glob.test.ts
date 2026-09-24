import { describe, expect, it } from "vitest";
import { globToRegExp, matchesAny } from "../src/guards/glob.js";

describe("globToRegExp", () => {
  it.each([
    ["src/**", "src/a.ts", true],
    ["src/**", "src/deep/b/c.ts", true],
    ["src/**", "srcx/a.ts", false],
    ["src/**", "tests/a.ts", false],
    ["tests/*.ts", "tests/a.ts", true],
    ["tests/*.ts", "tests/sub/a.ts", false],
    ["**/*.test.ts", "a.test.ts", true],
    ["**/*.test.ts", "src/x/a.test.ts", true],
    ["**/*.test.*", "src/a.test.tsx", true],
    ["src/a.ts", "src/a.ts", true],
    ["src/a.ts", "src/a_ts", false],
    ["src/?.ts", "src/a.ts", true],
  ])("%s ~ %s → %s", (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });

  it("matchesAny : liste de motifs", () => {
    expect(matchesAny(["src/**", "lib/**"], "lib/x.ts")).toBe(true);
    expect(matchesAny([], "lib/x.ts")).toBe(false);
  });
});
