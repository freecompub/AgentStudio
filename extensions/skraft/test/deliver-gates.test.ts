import type { Evidence } from "@agent-studio/extension-api";
import { describe, expect, it } from "vitest";
import { checkCalisthenics, checkDependencies, checkMutation, checkRedGreenSequence, parseQualityBar, planScenarios, type QualityBar } from "../src/deliver.js";

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
    expect(bar('{"calisthenics":{"maxMethodLines":10}}').calisthenics).toEqual({ maxMethodLines: 10, maxIndentation: 2, maxAttributes: 3 });
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

describe("Object Calisthenics mesurables", () => {
  it("Swift : méthode trop longue, trop imbriquée, type à trop d'attributs ; propriétés calculées et statiques ignorées", () => {
    const long = Array.from({ length: 22 }, (_, i) => `    let v${i} = ${i}`).join("\n");
    const src = `import Foundation
// func commentee() { if a { if b { if c { } } } }
public struct BolusCapPolicy {
  public let max: Double
  let unit: String
  var label: String
  private var cache: Int
  static let shared = 1
  var computed: Int { 1 }
  func deep(_ x: Int) -> Int {
    if x > 0 {
      for i in 0..<x {
        if i > 1 { return i }
      }
    }
    return 0
  }
  func long() {
${long}
  }
}
protocol Capping {
  func cap(_ d: Double) -> Double
  var name: String { get }
}
`;
    expect(checkCalisthenics("Sources/Domain/BolusCapPolicy.swift", src, bar())).toEqual([
      "Sources/Domain/BolusCapPolicy.swift : méthode « deep » à 3 niveaux d'indentation (maximum 2).",
      "Sources/Domain/BolusCapPolicy.swift : méthode « long » de 22 lignes (maximum 20).",
      "Sources/Domain/BolusCapPolicy.swift : type « BolusCapPolicy » à 4 attributs (maximum 3).",
    ]);
  });

  it("TypeScript : méthodes, fonctions fléchées et propriétés de constructeur", () => {
    const src = `export class Cap {
  private readonly max: number;
  unit = "U";
  constructor(private a: number, readonly b: number) {}
  apply(dose: number): number {
    if (dose > this.max) { if (dose > 2) { if (dose > 3) { return 1; } } }
    return dose;
  }
}
export const f = (x: number) => { return x; };
`;
    expect(checkCalisthenics("src/cap.ts", src, bar())).toEqual([
      "src/cap.ts : méthode « apply » à 3 niveaux d'indentation (maximum 2).",
      "src/cap.ts : type « Cap » à 4 attributs (maximum 3).",
    ]);
  });

  it("code conforme ou fichier non analysable : aucun motif", () => {
    expect(checkCalisthenics("Sources/Domain/Cap.swift", "public func cap(_ d: Double, max: Double) -> Double { Swift.min(d, max) }\n", bar())).toEqual([]);
    expect(checkCalisthenics("README.md", "func x() { if a { if b { if c {} } } }", bar())).toEqual([]);
  });
});
