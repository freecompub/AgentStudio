import { describe, expect, it } from "vitest";
import { parseTddArgs } from "../src/extension.js";

describe("/tdd : arguments", () => {
  it("par défaut : un tour par comportement", () => {
    expect(parseTddArgs("  Plafonner la dose ")).toEqual({ feature: "Plafonner la dose", granularity: "turn" });
  });
  it("--strict : une session par étape", () => {
    expect(parseTddArgs("--strict Plafonner")).toEqual({ feature: "Plafonner", granularity: "strict" });
  });
  it("sans fonctionnalité : rien", () => {
    expect(parseTddArgs("")).toBeNull();
    expect(parseTddArgs("--strict")).toBeNull();
  });
});
