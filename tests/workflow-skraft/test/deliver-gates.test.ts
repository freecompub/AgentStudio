// Repris de extensions/skraft-workflow/test/deliver-gates.test.ts (2026-10-10) : teste le workflow en dossier (ADR 0055).
// @ts-nocheck — le workflow est en JavaScript, sans types (ADR 0055) : ce test vérifie son comportement, pas ses types.
import type { Evidence } from "@agent-studio/extension-api";
import { coverageForChanges } from "@agent-studio/extension-api";
import { describe, expect, it } from "vitest";
import { checkCoverage, checkDependencies, checkLint, checkMutation, mutantsSousLeSeuil, checkRedGreenSequence, defaultDependencyRules, parseQualityBar, planScenarios, type QualityBar } from "../../../workflows/skraft/deliver.mjs";

/** Barre depuis l'ancien format JSON (relu et converti, ADR 0049), ou par défaut. */
const bar = (raw: string | null = null): QualityBar => {
  const r = parseQualityBar(raw === null ? {} : { legacyJson: raw });
  if ("error" in r) throw new Error(r.error);
  return r.bar;
};

describe("seuils sur le diff, pas sur la dette historique", () => {
  const path = "Sources/Domain/Panier.swift";
  const report = { files: [{ file: path, covered: 1, total: 2, score: 50, lines: [{ number: 8, covered: false }, { number: 20, covered: true }] }] };
  const b = bar('{"coverage":{"core":90}}');
  it("l'ancienne ligne non couverte ne bloque pas un ajout couvert", () => {
    expect(checkCoverage(coverageForChanges(report, [{ path, lines: [20] }]).report, [path], b, true)).toEqual([]);
  });
  it("modifier la ligne non couverte déclenche le seuil et donne son numéro exact", () => {
    expect(checkCoverage(coverageForChanges(report, [{ path, lines: [8, 20] }]).report, [path], b, true)).toEqual([
      `Couverture du diff : ${path} à 50 % (minimum 90 %), 1 ligne(s) couverte(s) sur 2. Lignes non couvertes : 8.`,
    ]);
  });
});

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
  it("valeurs par défaut ; ancien JSON invalide signalé", () => {
    expect(bar().mutation).toEqual({ active: true, domain: 100, application: 100, rest: 90, moment: "phase-end" });
    expect(parseQualityBar({ legacyJson: "{" })).toEqual({ error: "`.skraft/quality.json` n'est pas du JSON valide." });
    expect(parseQualityBar({ legacyJson: '{"mutation":{"core":120}}' })).toMatchObject({ error: expect.stringMatching(/mutation\.core/) });
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

  it("les règles par défaut viennent de la stack, pas de l'extension", () => {
    // Sans projet déclarant ses règles, on interdit au domaine d'importer ce que **la stack**
    // tient pour de l'infrastructure. L'extension ne connaît aucun nom de framework : « SwiftUI »
    // ne veut rien dire en Python, et l'y écrire la rendrait spécifique à un langage.
    const regles = defaultDependencyRules(["Infrastructure", "SwiftUI", "UIKit"]);
    expect(regles).toEqual([{ module: "Domain", forbidden: ["Infrastructure", "SwiftUI", "UIKit"] }]);

    // Une stack qui n'en déclare aucun ne produit aucune règle : rien n'est inventé.
    expect(defaultDependencyRules([])).toEqual([]);
  });

  it("les règles du projet l'emportent sur celles de la stack", () => {
    const b = bar('{"dependencyRules":[{"module":"Core","forbidden":["Web"]}]}');
    expect(b.dependencyRules).toEqual([{ module: "Core", forbidden: ["Web"] }]);
  });

  it("sans règles déclarées, la barre n'en invente pas", () => {
    expect(bar().dependencyRules).toEqual([]);
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

/**
 * Couverture de lignes (§7.4). Elle n'est pas redondante avec la mutation : elle en est le
 * **plancher**. La mutation juge si un test sert à quelque chose, la couverture seulement si le
 * code est atteint — mais elle est peu coûteuse et presque toujours disponible, là où un outil de
 * mutation manque souvent. Sans elle, un projet sans mutation n'a aucune mesure du tout.
 */
describe("Seuils de couverture", () => {
  const bar = (over: Record<string, unknown> = {}) => {
    const r = parseQualityBar({ legacyJson: JSON.stringify({ coverage: { core: 90, edge: 70 }, ...over }) });
    if ("error" in r) throw new Error(r.error);
    return r.bar;
  };
  const rapport = (files: { file: string; score: number }[]) => ({ files: files.map((f) => ({ ...f, covered: 1, total: 1 })) });

  it("un fichier du cœur sous son seuil est refusé, avec les deux nombres", () => {
    const r = checkCoverage(rapport([{ file: "src/Domain/Panier.cs", score: 80 }]), ["src/Domain/Panier.cs"], bar());
    expect(r[0]).toMatch(/80/);
    expect(r[0]).toMatch(/90/);
  });

  it("le seuil des bords est plus bas que celui du cœur", () => {
    const fichiers = ["src/Infrastructure/Sql.cs"];
    expect(checkCoverage(rapport([{ file: "src/Infrastructure/Sql.cs", score: 80 }]), fichiers, bar())).toEqual([]);
  });

  it("un fichier absent du rapport n'est pas reproché : il n'a pas été mesuré", () => {
    // Le compter à 0 % ferait échouer la porte sur un fichier que l'outil n'a pas vu — c'est
    // attester d'une mesure qui n'a pas eu lieu, en sens inverse.
    expect(checkCoverage(rapport([]), ["src/Domain/Panier.cs"], bar())).toEqual([]);
  });

  it("seuls les fichiers du scénario sont jugés, pas tout le rapport", () => {
    const r = checkCoverage(rapport([{ file: "src/Domain/Autre.cs", score: 10 }]), ["src/Domain/Panier.cs"], bar());
    expect(r).toEqual([]);
  });

  it("par défaut, aucun seuil : la couverture est rapportée, pas exigée", () => {
    const defaut = parseQualityBar({});
    if ("error" in defaut) throw new Error(defaut.error);
    expect(checkCoverage(rapport([{ file: "src/Domain/Panier.cs", score: 5 }]), ["src/Domain/Panier.cs"], defaut.bar)).toEqual([]);
  });
});


/**
 * Run réel US-2 du 03/10, deuxième pas de DELIVER : le test rouge appelait `AtteintLeSeuil`, qui
 * n'existait pas — en C#, une erreur de COMPILATION. Le lecteur d'erreurs de compilation désigne
 * alors le test par son fichier ; au vert, le rapport JUnit le nomme par sa classe qualifiée. La
 * porte GREEN a conclu « test du pas introuvable » sur un test bel et bien vert.
 */
describe("concerns — un test désigné par son fichier (rouge de compilation)", async () => {
  const { concerns, checkRedGreenSequence } = await import("../../../workflows/skraft/deliver.mjs");
  const fichier = "tests/Tarification.Tests/QuantiteTests.cs";
  const nom = "Tarification.Tests.QuantiteTests.AtteintLeSeuil_est_vrai_quand_la_quantite_est_egale_au_seuil";

  it("le fichier désigne les tests de la classe du même nom, dans les deux sens", () => {
    expect(concerns(nom, fichier)).toBe(true);
    expect(concerns(fichier, nom)).toBe(true);
  });

  it("mais pas ceux d'une autre classe, ni d'une classe dont le nom ne fait que le contenir", () => {
    expect(concerns("Tarification.Tests.MontantTests.Multiplie", fichier)).toBe(false);
    expect(concerns("Tarification.Tests.QuantiteTestsBis.X", fichier)).toBe(false);
  });

  it("les identifiants `chemin > test` gardent leur sens", () => {
    expect(concerns("Tests/A.swift", "Tests/A.swift > A.testX")).toBe(true);
    expect(concerns("Tests/A.swift > A.testX", "Tests/A.swift > A.testY")).toBe(false);
  });

  it("la séquence rouge puis vert est reconnue quand le rouge vient du compilateur et le vert de JUnit", () => {
    const preuve = (o: Partial<Evidence>): Evidence => ({ id: "e", taskId: "t", phase: "DELIVER_RED", source: "gate", at: "", exitCode: 1, timedOut: false, durationMs: 1, counts: { passed: 0, failed: 0, skipped: 0 }, testIds: [], failing: [], testsHash: "", head: "", ...o }) as Evidence;
    const rouge = preuve({ testIds: [fichier], failing: [{ id: fichier, failureKind: "missing_symbol", message: "CS1061" }] });
    const vert = preuve({ phase: "DELIVER_GREEN", exitCode: 0, testIds: [nom] });
    expect(checkRedGreenSequence([rouge, vert], [fichier])).toEqual([]);
  });
});

describe("mutation et dérogations (D22 de docs/12, ADR 0065)", () => {
  const F = "Sources/Domain/BolusCapPolicy.swift";
  const report = { score: 75, files: [{ file: F, score: 75, killed: 3, total: 4, survived: [{ line: 4, operator: "EqualityOperator", replacement: "dose >= max" }] }] };

  it("un mutant accordé en dérogation sort du score : la porte passe", () => {
    expect(checkMutation(report, [F], bar(), [{ file: F, line: 4, operator: "EqualityOperator" }])).toEqual([]);
  });

  it("une dérogation ne vaut que pour son mutant", () => {
    expect(checkMutation(report, [F], bar(), [{ file: F, line: 5, operator: "EqualityOperator" }])).toHaveLength(1);
  });

  it("score recalculé sans les mutants accordés ; sans total connu, le score mesuré reste", () => {
    const deux = { score: 50, files: [{ file: F, score: 50, killed: 2, total: 4, survived: [{ line: 4, operator: "A" }, { line: 9, operator: "B" }] }] };
    expect(checkMutation(deux, [F], bar(), [{ file: F, line: 4, operator: "A" }])).toEqual([`Mutation : ${F} à 66.7 % (minimum 100 %) ; mutants survivants : ligne 9 (B).`]);
    const sansTotal = { score: 50, files: [{ file: F, score: 50, survived: [{ line: 4, operator: "A" }, { line: 9, operator: "B" }] }] };
    expect(checkMutation(sansTotal, [F], bar(), [{ file: F, line: 4, operator: "A" }])).toEqual([`Mutation : ${F} à 50 % (minimum 100 %) ; mutants survivants : ligne 9 (B).`]);
  });

  it("mutantsSousLeSeuil : un par survivant non accordé, dans les fichiers sous le seuil", () => {
    expect(mutantsSousLeSeuil(report, [F], bar(), [])).toEqual([{ file: F, line: 4, operator: "EqualityOperator", replacement: "dose >= max" }]);
    expect(mutantsSousLeSeuil(report, [F], bar(), [{ file: F, line: 4, operator: "EqualityOperator" }])).toEqual([]);
  });
});
