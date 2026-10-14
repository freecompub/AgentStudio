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

describe("Consignes de phase des lentilles (option A de docs/15 §4.5)", () => {
  const f = { artifacts: [".skraft/us-12/design/diagrams.md"], code: [], tests: [] };

  it("DESIGN : architecture examine les invariants d'agrégat et la justification des patrons", () => {
    const a = lensBrief("architecture", c, "DESIGN", f, []);
    expect(a).toContain("Points à examiner en DESIGN :");
    expect(a).toContain("Chaque agrégat garantit ses propres invariants ; il n'en référence un autre que par son identifiant.");
  });

  it("DISTILL : test-integrity examine les cas limites tranchés par les critères", () => {
    const t = lensBrief("test-integrity", c, "DISTILL", f, []);
    expect(t).toContain("Points à examiner en DISTILL :");
    expect(t).toContain("Chaque cas limite ou négatif tranché par les critères a son scénario.");
  });

  it("DELIVER : aucune consigne de phase, les lentilles jugent le code", () => {
    for (const lens of ["cold-reader", "test-integrity", "architecture", "quality-gates"]) expect(lensBrief(lens, c, "DELIVER", f, [])).not.toContain("Points à examiner");
  });
});
