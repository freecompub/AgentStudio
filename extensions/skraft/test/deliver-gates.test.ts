import type { Evidence } from "@agent-studio/extension-api";
import { describe, expect, it } from "vitest";
import { checkDependencies, checkLint, checkMutation, checkRedGreenSequence, parseQualityBar, planScenarios, type QualityBar } from "../src/deliver.js";

const bar = (raw: string | null = null): QualityBar => {
  const r = parseQualityBar(raw);
  if ("error" in r) throw new Error(r.error);
  return r.bar;
};

describe("planScenarios", () => {
  const ids = [
    "Tests/AcceptanceTests/StoryAcceptanceTests.swift > StoryAcceptanceTests.testAc1DoseSousLePlafond",
    "Tests/AcceptanceTests/StoryAcceptanceTests.swift > StoryAcceptanceTests.testAc2DosePlafonnee",
    "Tests/AcceptanceTests/StoryAcceptanceTests.swift > StoryAcceptanceTests.testAc3AucunPlafond",
  ];

  it("ordre du plan d'implémentation, puis critères non cités ; non-régressions déjà faites", () => {
    const s = planScenarios({ implPlan: "1. @ac-2 d'abord\n2. ac-1 ensuite\n", acceptanceTestIds: [...ids].reverse(), regressions: [ids[2]!] });
    expect(s.map((x) => [x.id, x.role, x.status])).toEqual([
      ["ac-2", "driver", "pending"],
      ["ac-1", "driver", "pending"],
      ["ac-3", "regression", "done"],
    ]);
    expect(s[0]!.acceptanceTestId).toBe(ids[1]);
  });

  it("plusieurs tests pour un critère : identifiants distincts ; tests sans marqueur ignorés", () => {
    const s = planScenarios({ implPlan: "", acceptanceTestIds: ["a.test.ts > ac-1 x", "a.test.ts > ac-1 y", "a.test.ts > sans marqueur"], regressions: [] });
    expect(s.map((x) => x.id)).toEqual(["ac-1", "ac-1#2"]);
  });
});

describe("checkRedGreenSequence", () => {
  const ev = (testIds: string[], failing: Evidence["failing"]): Evidence => ({
    id: "e",
    taskId: "t",
    source: "gate",
    at: "",
    exitCode: 0,
    timedOut: false,
    durationMs: 1,
    counts: { passed: testIds.length - failing.length, failed: failing.length, skipped: 0 },
    testIds,
    failing,
    testsHash: "",
    head: "",
  });
  const T = "Tests/UnitTests/CapTests.swift > CapTests.testCapsDoseAboveMax";

  it("rouge (symbole manquant, fichier seul) puis vert : accepté", () => {
    expect(checkRedGreenSequence([ev(["Tests/UnitTests/CapTests.swift"], [{ id: "Tests/UnitTests/CapTests.swift", failureKind: "missing_symbol" }]), ev([T], [])], [T])).toEqual([]);
  });

  it("jamais rouge, ou rouge pour une mauvaise raison, ou pas de vert ensuite : rejeté", () => {
    expect(checkRedGreenSequence([ev([T], [])], [T])).toEqual([`Aucune exécution rouge du test unitaire « ${T} » dans les preuves.`]);
    expect(checkRedGreenSequence([ev([T], [{ id: T, failureKind: "other_error" }]), ev([T], [])], [T])[0]).toMatch(/Aucune exécution rouge/);
    expect(checkRedGreenSequence([ev([T], [{ id: T, failureKind: "assertion" }])], [T])).toEqual([`Aucune exécution verte du test unitaire « ${T} » après son rouge dans les preuves.`]);
  });
});

describe("barre de qualité", () => {
  it("valeurs par défaut ; surcharge partielle ; JSON invalide signalé", () => {
    expect(bar().mutation).toEqual({ coreLayers: ["Domain", "Application"], core: 100, edge: 90 });
    expect(parseQualityBar("{")).toEqual({ error: "`.skraft/quality.json` n'est pas du JSON valide." });
    expect(parseQualityBar('{"mutation":{"core":120}}')).toMatchObject({ error: expect.stringMatching(/mutation\.core/) });
  });

  it("mutation : 100 % exigé dans le domaine, 90 % ailleurs ; survivants listés", () => {
    const report = {
      score: 90,
      files: [
        { file: "Sources/Domain/BolusCapPolicy.swift", score: 95, survived: [{ line: 4, operator: "RelationalOperatorReplacement" }] },
        { file: "Sources/Infrastructure/Store.swift", score: 92, survived: [] },
      ],
    };
    expect(checkMutation(report, ["Sources/Domain/BolusCapPolicy.swift", "Sources/Infrastructure/Store.swift", "Sources/Domain/Sans.swift"], bar())).toEqual([
      "Mutation : Sources/Domain/BolusCapPolicy.swift à 95 % (minimum 100 %) ; mutants survivants : ligne 4 (RelationalOperatorReplacement).",
    ]);
  });

  it("règle de dépendance : chaque import interdit est un motif", () => {
    expect(checkDependencies({ modules: [], violations: [{ module: "Domain", file: "Sources/Domain/A.swift", imported: "Infrastructure" }] })).toEqual([
      "Règle de dépendance : Sources/Domain/A.swift (module Domain) importe Infrastructure.",
    ]);
  });
});

describe("Qualité de forme : le linter du projet, pas un analyseur maison", () => {
  it("les violations du linter deviennent des motifs de rejet, règle citée", () => {
    const rapport = {
      available: true,
      tool: "eslint",
      violations: [
        { file: "src/bolus.ts", line: 12, rule: "max-lines-per-function", message: "Function has too many lines (48)." },
        { file: "src/bolus.ts", rule: "max-depth", message: "Blocks are nested too deeply (4)." },
      ],
    };
    expect(checkLint(rapport)).toEqual([
      "Lint : src/bolus.ts:12 — max-lines-per-function : Function has too many lines (48).",
      "Lint : src/bolus.ts — max-depth : Blocks are nested too deeply (4).",
    ]);
  });

  it("un projet propre ne produit aucun motif", () => {
    expect(checkLint({ available: true, tool: "eslint", violations: [] })).toEqual([]);
  });

  it("sans linter, rien n'est reproché : la porte ne juge pas ce qu'elle n'a pas mesuré", () => {
    expect(checkLint({ available: false, violations: [] })).toEqual([]);
    expect(checkLint(null)).toEqual([]);
  });
});
