import { describe, expect, it } from "vitest";
import { parseVersion, satisfies } from "../src/semver.js";

describe("semver minimal", () => {
  it("analyse une version x.y.z", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("v1.2.3")).toBeNull();
  });

  it.each([
    ["0.1.0", "^0.1", true],
    ["0.1.9", "^0.1.2", true],
    ["0.1.1", "^0.1.2", false],
    ["0.2.0", "^0.1", false],
    ["1.4.0", "^1.2", true],
    ["2.0.0", "^1.2", false],
    ["1.2.5", "~1.2.3", true],
    ["1.3.0", "~1.2.3", false],
    ["1.2.3", "1.2.3", true],
    ["1.2.4", "1.2.3", false],
    ["1.2.3", ">=1.0.0", true],
    ["0.9.0", ">=1.0.0", false],
  ])("%s satisfait %s : %s", (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected);
  });

  it("plage illisible : non satisfaite", () => {
    expect(satisfies("1.0.0", "n'importe quoi")).toBe(false);
  });
});
