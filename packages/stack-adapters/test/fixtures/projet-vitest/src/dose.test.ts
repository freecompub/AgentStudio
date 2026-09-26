import { expect, test } from "vitest";
import { plafonner } from "./dose.js";

test("la dose est plafonnée au maximum", () => {
  expect(plafonner(12, 10)).toBe(10);
});
