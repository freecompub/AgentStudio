// @ts-nocheck — le workflow est en JavaScript, sans types (ADR 0055) : ce test vérifie son comportement, pas ses types.
/** Dossiers des lentilles du workflow (§9.2) : chacune reçoit ce que son prompt annonce (docs/15 §4). */
import { describe, expect, it } from "vitest";
import { lensBrief, refuterBrief } from "../../../workflows/skraft/review-brief.mjs";

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
    // Couche des dépôts : domaine OU application (solution-architect, phase 6), pas l'application seule.
    expect(a).toContain("Les interfaces de dépôt et de passerelle sont déclarées dans le domaine ou dans l'application, jamais dans l'infrastructure, et l'ADR de l'agrégat justifie ce choix ; domaine et application ne dépendent ni de l'infrastructure ni de l'API.");
    // Méthode de solution-architect (docs/15 §4.6) : phase 3 (réutilisation) et déclencheurs obligatoires d'ADR (phase 7).
    expect(a).toContain("Les agrégats, contextes et cas d'usage existants relevés par la recherche sont réutilisés ou étendus, pas dupliqués.");
    expect(a).toContain("Chaque déclencheur obligatoire d'ADR présent dans la conception a son ADR : CQRS avec bus, Event Sourcing, saga, agrégat qui franchit une frontière existante, découpage ou fusion de contextes, couche anticorruption, changement transverse (erreurs, validation, transactions).");
    expect(lensBrief("test-integrity", c, "DESIGN", f, [])).toContain("Chaque déclencheur forme une tranche verticale : le déclencheur, l'événement qu'il produit, la vue que lit l'utilisateur.");
    // STRUCTURAL_DRIFT de skraft-plugin, sens « document → ADR » : jugé par la lentille, pas par le code.
    expect(a).toContain("Chaque agrégat introduit par les documents (modèle, contrats, diagrammes) est nommé par un ADR, nouveau ou existant, qui le justifie ; un dépôt, en tant que tel, n'en demande pas.");
  });

  it("DISTILL : test-integrity examine les cas limites tranchés par les critères", () => {
    const t = lensBrief("test-integrity", c, "DISTILL", f, []);
    expect(t).toContain("Points à examiner en DISTILL :");
    expect(t).toContain("Chaque cas limite ou négatif tranché par les critères a son scénario.");
  });

  it("DELIVER : test-integrity et quality-gates jugent le respect du plan de test et ses écarts déclarés (docs/15 §4.7, ADR 0067)", () => {
    for (const lens of ["cold-reader", "architecture"]) expect(lensBrief(lens, { ...c, slug: "us-12" }, "DELIVER", f, [])).not.toContain("Points à examiner");
    const t = lensBrief("test-integrity", { ...c, slug: "us-12" }, "DELIVER", f, []);
    expect(t).toContain("Points à examiner en DELIVER :");
    expect(t).toContain("Chaque test respecte la couche et la doublure que la matrice de .skraft/us-12/distill/test-plan.md prévoit pour son critère ; un écart non déclaré est un défaut, un écart déclaré dans les faits se juge sur sa règle.");
    expect(lensBrief("quality-gates", { ...c, slug: "us-12" }, "DELIVER", f, ["Fait A."])).toContain("Chaque critère de la matrice du plan de test a au moins un test qui respecte sa ligne, sauf écart déclaré dans les faits.");
  });
});

describe("Dossier du réfutateur (ADR 0069)", () => {
  const defauts = [{ id: "cold-reader#1.1", severity: "major", description: "Nom flou.", file: "src/domain/plafond.ts", line: 3 }];
  it("les défauts numérotés par le code, puis les mêmes entrées que la lentille, sans ses consignes", () => {
    const b = refuterBrief("cold-reader", c, "DELIVER", files, facts, [{ ...defauts[0], severityReason: "Le nom cache la règle.", occurrences: ["src/b.ts:12"] }]);
    expect(b).toContain("[cold-reader#1.1] (major) Nom flou. (src/domain/plafond.ts:3) — gravité : Le nom cache la règle. — aussi : src/b.ts:12");
    for (const vu of ["src/domain/plafond.ts", "test/domain/plafond.test.ts", ".skraft/us-12/distill/impl-plan.md"]) expect(b).toContain(vu);
    // Pas plus que la lentille : cold-reader ne reçoit ni faits, ni critères, ni ADR.
    for (const cache of ["Fait A.", "Plafond de 10 U", "ADR-001", "aucun contexte du producteur"]) expect(b).not.toContain(cache);
  });
  it("test-integrity : critères et faits ; architecture : ADR et faits ; quality-gates : faits et livrables seulement", () => {
    expect(refuterBrief("test-integrity", c, "DELIVER", files, facts, defauts)).toContain("1. Plafond de 10 U");
    expect(refuterBrief("architecture", c, "DELIVER", files, facts, defauts)).toContain("ADR-001 : docs/adr/adr-001-plafond.md");
    const q = refuterBrief("quality-gates", c, "DELIVER", files, facts, defauts);
    expect(q).toContain("Fait A.");
    expect(q).not.toContain("test/domain/plafond.test.ts");
  });
});
