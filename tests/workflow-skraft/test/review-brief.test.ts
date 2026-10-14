// @ts-nocheck — le workflow est en JavaScript, sans types (ADR 0055) : ce test vérifie son comportement, pas ses types.
/** Dossiers des lentilles du workflow (§9.2) : chacune reçoit ce que son prompt annonce (docs/15 §4). */
import { describe, expect, it } from "vitest";
import { lensBrief } from "../../../workflows/skraft/review-brief.mjs";

const c = { criteria: [{ n: 1, text: "Plafond de 10 U" }], adrs: [{ id: "ADR-001", path: "docs/adr/adr-001-plafond.md" }] };
const files = { artifacts: [".skraft/us-12/distill/impl-plan.md"], code: ["src/domain/plafond.ts"], tests: ["test/domain/plafond.test.ts"] };
const facts = ["Fait A."];

describe("Contexte des lentilles (§9.2)", () => {
  it("cold-reader : fichiers seuls, ni faits, ni critères, ni ADR", () => {
    const b = lensBrief("cold-reader", c, "DELIVER", files, facts);
    expect(b).toContain("src/domain/plafond.ts");
    expect(b).toContain("test/domain/plafond.test.ts");
    for (const cache of ["Fait A.", "Plafond de 10 U", "ADR-001"]) expect(b).not.toContain(cache);
  });

  it("test-integrity reçoit aussi le code de production, que son prompt annonce (4.1 de docs/15)", () => {
    const t = lensBrief("test-integrity", c, "DELIVER", files, facts);
    expect(t).toContain("Tests :\n  - test/domain/plafond.test.ts");
    expect(t).toContain("Code :\n  - src/domain/plafond.ts");
  });

  it("architecture reçoit aussi les tests : une doublure dans le domaine se voit dans les tests (4.2 de docs/15)", () => {
    const a = lensBrief("architecture", c, "DELIVER", files, facts);
    expect(a).toContain("Code :\n  - src/domain/plafond.ts");
    expect(a).toContain("Tests :\n  - test/domain/plafond.test.ts");
  });
});
