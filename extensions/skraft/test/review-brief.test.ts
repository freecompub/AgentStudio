import type { Evidence } from "@agent-studio/extension-api";
import { describe, expect, it } from "vitest";
import { initialState } from "../src/reducer.js";
import type { SkraftState } from "../src/model.js";
import { latestArtifacts, lensBrief, refuterBrief, reviewFacts } from "../src/review-brief.js";
import { replayReview, reviewReport, synthesize, type LensVerdict } from "../src/review.js";
import { parseStory } from "../src/story.js";
import { US12 } from "./story.test.js";

const story = (() => {
  const r = parseStory(US12);
  if (!r.ok) throw new Error();
  return r.story;
})();

const state: SkraftState = {
  ...initialState({ storyPath: "stories/us-12.md" }),
  slug: "us12-f15ade30",
  story,
  answers: [{ question: "Plafond par prise ?", answer: "par prise" }],
  acceptanceHash: "a".repeat(64),
  regressions: ["A > ac-3"],
  adrs: [
    { id: "ADR-001", path: "docs/adr/adr-001-plafond.md", status: "Accepted" },
    { id: "ADR-002", path: "docs/adr/adr-002-x.md", status: "Rejected" },
  ],
  artifacts: { RESEARCH: [], DESIGN: [], DISTILL: [], DELIVER: [{ path: "Sources/Domain/BolusCapPolicy.swift", sha256: "b".repeat(64), producedBy: "DELIVER", attempt: 1 }] },
  deliver: {
    scenarios: [
      { id: "ac-1", ac: 1, acceptanceTestId: "A > ac-1", role: "driver", status: "done", unitTests: ["U > t1"] },
      { id: "ac-3", ac: 3, acceptanceTestId: "A > ac-3", role: "regression", status: "done" },
    ],
    current: 0,
    granularity: "turn-per-scenario",
    acceptanceHash: "a".repeat(64),
    unitTestsHash: null,
    scenarioCheckpoint: null,
    step: "scenario-gate",
    stepCheckpoint: null,
    baseline: { all: [], passed: [] },
    scenarioBaseline: { all: [], passed: [] },
    unitTests: [],
    newTest: null,
    acceptanceGreen: true,
    attempts: 0,
    scenarioFailures: 0,
  cycles: 0,
    feedback: [],
    notes: ["Mutation non mesurée : la stack du projet ne propose pas d'outil de mutation."],
    facts: ["Règle de dépendance respectée : Domain n'importe ni Infrastructure."],
    fixing: false,
  },
};

const run = (phase: string, counts: Evidence["counts"]): Evidence => ({
  id: phase,
  taskId: "t",
  source: "gate",
  phase,
  at: "",
  exitCode: 0,
  timedOut: false,
  durationMs: 1,
  counts,
  testIds: [],
  failing: [],
  testsHash: "",
  head: "",
});

describe("Faits établis avant la revue (§9.1)", () => {
  it("livrables et empreintes, non-régressions, dernière exécution du code, scénarios, constats", () => {
    const facts = reviewFacts(state, "DELIVER", [run("DELIVER_RED", { passed: 1, failed: 1, skipped: 0 }), run("DELIVER_SCENARIO", { passed: 5, failed: 0, skipped: 0 }), run("DISTILL_RED", { passed: 0, failed: 2, skipped: 0 })]);
    expect(facts).toEqual([
      "Livrable Sources/Domain/BolusCapPolicy.swift : porte de DELIVER validée à l'essai 1 (sha256 bbbbbbbbbbbb).",
      "Tests d'acceptance gelés, empreinte aaaaaaaaaaaa, vérifiée inchangée à chaque pas de DELIVER.",
      "Test d'acceptance requalifié en non-régression, avec justification dans test-plan.md : A > ac-3.",
      "Dernière exécution des tests par le code (DELIVER_SCENARIO) : 5 réussi(s), 0 en échec, 0 ignoré(s).",
      "Scénario ac-1 : test d'acceptance vert (A > ac-1) ; tests unitaires ajoutés, chacun rouge puis vert dans les preuves : U > t1.",
      "Scénario ac-3 : non-régression, vert dès DISTILL (A > ac-3).",
      "Règle de dépendance respectée : Domain n'importe ni Infrastructure.",
      "À noter : Mutation non mesurée : la stack du projet ne propose pas d'outil de mutation.",
    ]);
  });
});

describe("Livrables du dernier essai (après rollback)", () => {
  it("les livrables d'un essai annulé ne sont plus présentés comme validés ; dernière empreinte par chemin", () => {
    const s: SkraftState = {
      ...state,
      artifacts: {
        ...state.artifacts,
        DESIGN: [
          { path: "docs/adr/adr-001-ancien.md", sha256: "1".repeat(64), producedBy: "render_adr", attempt: 1 },
          { path: ".skraft/us12-f15ade30/design/contracts.md", sha256: "2".repeat(64), producedBy: "skraft-architect", attempt: 1 },
          { path: ".skraft/us12-f15ade30/design/contracts.md", sha256: "3".repeat(64), producedBy: "skraft-architect", attempt: 2 },
        ],
      },
    };
    expect(latestArtifacts(s.artifacts.DESIGN).map((a) => [a.path, a.attempt])).toEqual([[".skraft/us12-f15ade30/design/contracts.md", 2]]);
    const facts = reviewFacts(s, "DESIGN", []).filter((f) => f.startsWith("Livrable"));
    expect(facts).toEqual(["Livrable .skraft/us12-f15ade30/design/contracts.md : porte de DESIGN validée à l'essai 2 (sha256 333333333333)."]);
    expect(latestArtifacts([])).toEqual([]);
  });
});

describe("Contexte des lentilles (§9.2)", () => {
  const files = { artifacts: [".skraft/us12-f15ade30/distill/impl-plan.md"], code: ["Sources/Domain/BolusCapPolicy.swift"], tests: ["Tests/DomainTests/BolusCapPolicyTests.swift"] };
  const facts = ["Fait A."];

  it("cold-reader : aucun contexte du producteur (ni story, ni réponses, ni faits, ni ADR)", () => {
    const b = lensBrief("cold-reader", state, "DELIVER", files, facts);
    expect(b).toContain("Sources/Domain/BolusCapPolicy.swift");
    expect(b).toContain("Tests/DomainTests/BolusCapPolicyTests.swift");
    for (const hidden of ["Fait A.", "par prise", "Plafond de 10 U", "ADR-001", "US-12"]) expect(b).not.toContain(hidden);
  });

  it("test-integrity : critères, tests et faits ; architecture : ADR ratifiés seulement, code et faits", () => {
    const t = lensBrief("test-integrity", state, "DELIVER", files, facts);
    expect(t).toContain("2. Plafond de 10 U, calcul à 12,5 U");
    expect(t).toContain("Tests/DomainTests/BolusCapPolicyTests.swift");
    expect(t).toContain("Faits établis par le code (acquis : ne les revérifie pas) :\n  - Fait A.");
    const a = lensBrief("architecture", state, "DELIVER", files, facts);
    expect(a).toContain("ADR-001 : docs/adr/adr-001-plafond.md");
    expect(a).not.toContain("ADR-002");
    expect(a).toContain("  - Fait A.");
    expect(a).not.toContain("par prise");
  });

  it("test-integrity reçoit aussi le code de production, que son prompt annonce (4.1 de docs/15)", () => {
    expect(lensBrief("test-integrity", state, "DELIVER", files, facts)).toContain("Code :\n  - Sources/Domain/BolusCapPolicy.swift");
  });

  it("architecture reçoit aussi les tests : une doublure dans le domaine se voit dans les tests (4.2 de docs/15)", () => {
    expect(lensBrief("architecture", state, "DELIVER", files, facts)).toContain("Tests :\n  - Tests/DomainTests/BolusCapPolicyTests.swift");
  });
});

describe("Verdict reproductible (§9.3)", () => {
  const lenses: LensVerdict[] = [
    { lens: "cold-reader", verdict: "CHANGES_REQUESTED", defects: [{ severity: "major", description: "`MaxBolus` accepte une valeur négative", file: "Sources/Domain/BolusCap.swift", line: 2 }] },
    { lens: "test-integrity", verdict: "APPROVED", defects: [{ severity: "minor", description: "nom de test vague" }] },
  ];

  it("mêmes JSON : même verdict, même rapport, octet pour octet", () => {
    const json = JSON.stringify(lenses, null, 2);
    const replay = replayReview("DELIVER", 1, json);
    expect(replay.verdict).toBe(synthesize(lenses));
    expect(replay.verdict).toBe("CHANGES_REQUESTED");
    expect(replay.markdown).toBe(reviewReport("DELIVER", 1, lenses));
    expect(replay.markdown).toContain("Verdict (synthèse du code) : CHANGES_REQUESTED");
    expect(replay.markdown).toContain("- **major** `MaxBolus` accepte une valeur négative (Sources/Domain/BolusCap.swift:2)");
  });

  it("JSON non conforme : refusé", () => {
    expect(() => replayReview("DELIVER", 1, '[{"lens":"x","verdict":"OK","defects":[]}]')).toThrow();
  });
});

describe("Consignes de phase des lentilles (option A de docs/15 §4.5)", () => {
  const files = { artifacts: [".skraft/us12-f15ade30/design/diagrams.md"], code: [], tests: [] };

  it("DESIGN : architecture examine les invariants d'agrégat et la justification des patrons", () => {
    const a = lensBrief("architecture", state, "DESIGN", files, []);
    expect(a).toContain("Points à examiner en DESIGN :");
    expect(a).toContain("Chaque agrégat garantit ses propres invariants ; il n'en référence un autre que par son identifiant.");
    // Couche des dépôts : domaine OU application (solution-architect, phase 6), pas l'application seule.
    expect(a).toContain("Les interfaces de dépôt et de passerelle sont déclarées dans le domaine ou dans l'application, jamais dans l'infrastructure, et l'ADR de l'agrégat justifie ce choix ; domaine et application ne dépendent ni de l'infrastructure ni de l'API.");
    // Méthode de solution-architect (docs/15 §4.6) : phase 3 (réutilisation) et déclencheurs obligatoires d'ADR (phase 7).
    expect(a).toContain("Les agrégats, contextes et cas d'usage existants relevés par la recherche sont réutilisés ou étendus, pas dupliqués.");
    expect(a).toContain("Chaque déclencheur obligatoire d'ADR présent dans la conception a son ADR : CQRS avec bus, Event Sourcing, saga, agrégat qui franchit une frontière existante, découpage ou fusion de contextes, couche anticorruption, changement transverse (erreurs, validation, transactions).");
    expect(lensBrief("test-integrity", state, "DESIGN", files, [])).toContain("Chaque déclencheur forme une tranche verticale : le déclencheur, l'événement qu'il produit, la vue que lit l'utilisateur.");
    // STRUCTURAL_DRIFT de skraft-plugin, sens « document → ADR » : jugé par la lentille, pas par le code.
    expect(a).toContain("Chaque agrégat introduit par les documents (modèle, contrats, diagrammes) est nommé par un ADR, nouveau ou existant, qui le justifie ; un dépôt, en tant que tel, n'en demande pas.");
  });

  it("DISTILL : test-integrity examine les cas limites tranchés par les critères", () => {
    const t = lensBrief("test-integrity", state, "DISTILL", files, []);
    expect(t).toContain("Points à examiner en DISTILL :");
    expect(t).toContain("Chaque cas limite ou négatif tranché par les critères a son scénario.");
  });

  it("DELIVER : test-integrity et quality-gates jugent le respect du plan de test et ses écarts déclarés (docs/15 §4.7, ADR 0067)", () => {
    for (const lens of ["cold-reader", "architecture"] as const) expect(lensBrief(lens, state, "DELIVER", files, [])).not.toContain("Points à examiner");
    const t = lensBrief("test-integrity", state, "DELIVER", files, []);
    expect(t).toContain("Points à examiner en DELIVER :");
    expect(t).toContain("Chaque test respecte la couche et la doublure que la matrice de .skraft/us12-f15ade30/distill/test-plan.md prévoit pour son critère ; un écart non déclaré est un défaut, un écart déclaré dans les faits se juge sur sa règle.");
    expect(lensBrief("quality-gates", state, "DELIVER", files, ["Fait A."])).toContain("Chaque critère de la matrice du plan de test a au moins un test qui respecte sa ligne, sauf écart déclaré dans les faits.");
  });
});

describe("Dossier du réfutateur (ADR 0069)", () => {
  const files = { artifacts: [".skraft/us12-f15ade30/distill/impl-plan.md"], code: ["Sources/Domain/BolusCapPolicy.swift"], tests: ["Tests/BolusCapTests.swift"] };
  const defauts = [{ id: "cold-reader#1.1", severity: "major" as const, description: "Nom flou.", file: "Sources/Domain/BolusCapPolicy.swift", line: 3 }];
  it("les défauts numérotés par le code, puis les mêmes entrées que la lentille, sans ses consignes", () => {
    const b = refuterBrief("cold-reader", state, "DELIVER", files, ["Fait A."], [{ ...defauts[0]!, severityReason: "Le nom cache la règle.", occurrences: ["src/b.ts:12"] }]);
    expect(b).toContain("[cold-reader#1.1] (major) Nom flou. (Sources/Domain/BolusCapPolicy.swift:3) — gravité : Le nom cache la règle. — aussi : src/b.ts:12");
    for (const vu of ["Tests/BolusCapTests.swift", ".skraft/us12-f15ade30/distill/impl-plan.md"]) expect(b).toContain(vu);
    for (const cache of ["Fait A.", "ADR-001", "aucun contexte du producteur"]) expect(b).not.toContain(cache);
  });
  it("test-integrity : critères et faits ; architecture : ADR ratifiés et faits ; quality-gates : faits et livrables seulement", () => {
    expect(refuterBrief("test-integrity", state, "DELIVER", files, ["Fait A."], defauts)).toContain(`1. ${story.criteria[0]!.text}`);
    const a = refuterBrief("architecture", state, "DELIVER", files, ["Fait A."], defauts);
    expect(a).toContain("ADR-001 : docs/adr/adr-001-plafond.md");
    expect(a).not.toContain("ADR-002");
    const q = refuterBrief("quality-gates", state, "DELIVER", files, ["Fait A."], defauts);
    expect(q).toContain("Fait A.");
    expect(q).not.toContain("Tests/BolusCapTests.swift");
  });
});

describe("Rapport de revue et réfutations (ADR 0069)", () => {
  it("les défauts réfutés figurent dans le rapport, avec la raison, et survivent au rejeu depuis le JSON", () => {
    const lenses: LensVerdict[] = [
      { lens: "cold-reader", verdict: "APPROVED", defects: [], refuted: [{ id: "cold-reader#1.1", severity: "major", description: "Nom flou.", refutation: "src/a.ts:3 nomme déjà l'intention." }] },
      { lens: "architecture", verdict: "CHANGES_REQUESTED", defects: [{ id: "architecture#1.1", severity: "major", target: "code", description: "Dépendance inversée.", file: "src/a.ts", line: 2, severityReason: "Le domaine dépend de l'infrastructure.", occurrences: ["src/b.ts:7"] }] },
    ];
    const md = reviewReport("DELIVER", 1, lenses);
    expect(md).toContain("- réfuté : `cold-reader#1.1` **major** Nom flou. — src/a.ts:3 nomme déjà l'intention.");
    expect(md).toContain("- `architecture#1.1` **major** (code) Dépendance inversée. (src/a.ts:2) — gravité : Le domaine dépend de l'infrastructure. — aussi : src/b.ts:7");
    const replay = replayReview("DELIVER", 1, JSON.stringify(lenses));
    expect(replay.markdown).toBe(md);
  });
});
