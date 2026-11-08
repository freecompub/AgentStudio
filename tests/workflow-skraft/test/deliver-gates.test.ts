// Repris de extensions/skraft-workflow/test/deliver-gates.test.ts (2026-10-10) : teste le workflow en dossier (ADR 0055).
// @ts-nocheck — le workflow est en JavaScript, sans types (ADR 0055) : ce test vérifie son comportement, pas ses types.
import type { Evidence } from "@agent-studio/extension-api";
import { coverageForChanges } from "@agent-studio/extension-api";
import { describe, expect, it } from "vitest";
import { causeDEchec, optionsSelonLaCause, sansTestsObsoletes, texteDeLaCause, checkCoverage, checkDependencies, checkFormat, checkLint, checkMutation, lignesSousLeSeuil, mutantsSousLeSeuil, sansLignesExemptees, checkRedGreenSequence, defaultDependencyRules, parseQualityBar, planScenarios, restreindreAuChangement, type QualityBar } from "../../../workflows/skraft/deliver.mjs";

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
 * Porte de format (ADR 0071, point 6) : le code de sortie de la commande `format` de la pile suffit.
 * Un écart est une correction pour le développeur ; une commande absente ou muette n'atteste de rien.
 */
describe("Porte de format : la commande du projet, à côté du lint", () => {
  it("au format : un fait, aucun motif", () => {
    expect(checkFormat({ available: true, ok: true, tool: "prettier" }, "ac-1")).toEqual({ motifs: [], faits: ["Format (ac-1) : prettier sans écart."], notes: [] });
  });

  it("hors format : un motif qui dit quoi faire, avec la sortie de l'outil", () => {
    expect(checkFormat({ available: true, ok: false, tool: "dotnet", sortie: "src/A.cs(3,1): WHITESPACE" }, "ac-1")).toEqual({
      motifs: ["Format : dotnet signale du code hors format ; reformate les fichiers modifiés avec l'outil du projet.\nsrc/A.cs(3,1): WHITESPACE"],
      faits: [],
      notes: [],
    });
    expect(checkFormat({ available: true, ok: false }, "ac-1").motifs).toEqual(["Format : la commande de format signale du code hors format ; reformate les fichiers modifiés avec l'outil du projet."]);
  });

  it("non déclarée ou muette : non mesurée, et c'est noté", () => {
    expect(checkFormat(null, "ac-1")).toEqual({ motifs: [], faits: [], notes: ["Format non mesuré : la pile du projet ne déclare pas de commande `format`."] });
    expect(checkFormat({ available: false, ok: false }, "ac-1")).toEqual({ motifs: [], faits: [], notes: ["Format non mesuré : la commande de format du projet n'a pas pu s'exécuter."] });
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

describe("couverture du diff et dérogations (arbitrage humain)", () => {
  const F = "Sources/Domain/BolusCapPolicy.swift";

  it("lignesSousLeSeuil : les lignes non couvertes de chaque fichier sous son seuil", () => {
    const report = { files: [{ file: F, covered: 1, total: 3, score: 33.3, lines: [{ number: 2, covered: true }, { number: 3, covered: false }, { number: 5, covered: false }] }] };
    expect(lignesSousLeSeuil(report, [F], bar('{"coverage":{"core":90}}'))).toEqual([{ file: F, lines: [3, 5] }]);
  });

  it("sansLignesExemptees : les lignes accordées sortent des lignes modifiées, fichier par fichier", () => {
    const changes = [{ path: F, status: "modified", lines: [2, 3, 5] }, { path: "autre.swift", status: "added", lines: [3] }];
    expect(sansLignesExemptees(changes, [{ file: F, line: 3 }])).toEqual([{ path: F, status: "modified", lines: [2, 5] }, { path: "autre.swift", status: "added", lines: [3] }]);
  });
});

/**
 * Cause d'un scénario en échec (ADR 0066, révisé le 07/11) : le code la connaît, et l'escalade
 * propose ce qui peut réussir. Un test rouge qui passait au début de DELIVER est un test que la
 * story rend obsolète ; des lignes du scénario non couvertes peuvent être exemptées.
 */
describe("Cause d'un scénario en échec (ADR 0066)", () => {
  const avant = ["tests/a.test.ts > ancien", "tests/b.test.ts > autre"];

  it("test rouge qui passait avant DELIVER : obsolète possible ; un test neuf du scénario ne l'est pas", () => {
    expect(causeDEchec({ rouges: ["tests/a.test.ts > ancien", "tests/neuf.test.ts > neuf"], avantDeliver: avant })).toEqual({ testsObsoletes: ["tests/a.test.ts > ancien"], lignes: [] });
    expect(causeDEchec({ rouges: [], avantDeliver: avant, lignes: [{ file: "src/a.ts", lines: [3, 4] }] })).toEqual({ testsObsoletes: [], lignes: [{ file: "src/a.ts", lines: [3, 4] }] });
  });

  it("options et texte selon la cause ; sans cause connue, rien de plus", () => {
    const c = { testsObsoletes: ["tests/a.test.ts > ancien"], lignes: [{ file: "src/a.ts", lines: [3, 4] }] };
    expect(optionsSelonLaCause(c)).toEqual(["obsolete", "exempt"]);
    expect(optionsSelonLaCause({ testsObsoletes: [], lignes: [] })).toEqual([]);
    expect(optionsSelonLaCause(undefined)).toEqual([]);
    expect(texteDeLaCause(c)).toEqual([
      "Tests qui passaient avant DELIVER et que la story fait échouer : tests/a.test.ts > ancien. S'ils décrivent un comportement que la story change, déclarez-les obsolètes : ils sortent des portes, et le bilan rappellera de les mettre à jour après le cycle.",
      "Lignes du scénario non couvertes : src/a.ts:3, 4. Si elles ne peuvent pas être atteintes, exemptez-les : la dérogation est tracée et commitée.",
    ]);
  });

  it("tests déclarés obsolètes : retirés des résultats que lisent les portes", () => {
    const run = { timedOut: false, results: [{ id: "tests/a.test.ts > ancien", status: "failed" }, { id: "tests/b.test.ts > autre", status: "passed" }] };
    expect(sansTestsObsoletes(run, ["tests/a.test.ts > ancien"]).results.map((r) => r.id)).toEqual(["tests/b.test.ts > autre"]);
    expect(sansTestsObsoletes(run, [])).toBe(run);
  });

  it("code de sortie : rendu à 0 quand les seuls échecs étaient des tests obsolètes ; gardé sinon", () => {
    const seul = { exitCode: 1, results: [{ id: "ancien", status: "failed" }, { id: "b", status: "passed" }] };
    expect(sansTestsObsoletes(seul, ["ancien"]).exitCode).toBe(0);
    const autre = { exitCode: 1, results: [{ id: "ancien", status: "failed" }, { id: "b", status: "failed" }] };
    expect(sansTestsObsoletes(autre, ["ancien"]).exitCode).toBe(1);
    // Aucun échec retiré : le code de sortie dit autre chose (compilation, configuration), il reste.
    const compilation = { exitCode: 2, results: [{ id: "b", status: "passed" }] };
    expect(sansTestsObsoletes(compilation, ["ancien"]).exitCode).toBe(2);
  });
});

/**
 * Mutation jugée sur les lignes modifiées par la story (décision du responsable le 08/11), comme la
 * couverture : un fichier touché n'a pas à rattraper les mutants survivants du code qu'elle ne change
 * pas. Run du 08/11 : `Montant.cs` à 62 % avant l'US-2, la barre par défaut exige 100 %.
 */
describe("Mutation restreinte aux lignes modifiées", () => {
  const rapport = {
    score: 61.5,
    files: [
      {
        file: "src/Domaine/Montant.cs",
        score: 61.5,
        killed: 3,
        total: 6,
        killedLines: [8, 30, 31],
        survived: [
          { line: 14, operator: "String mutation" },
          { line: 21, operator: "Equality mutation" },
          { line: 30, operator: "Arithmetic mutation" },
        ],
      },
    ],
  };

  it("score et survivants des seules lignes modifiées ; les autres survivants deviennent une note", () => {
    const r = restreindreAuChangement(rapport, [{ path: "src/Domaine/Montant.cs", lines: [30, 31, 32] }]);
    expect(r.report.files).toEqual([
      { file: "src/Domaine/Montant.cs", score: (2 / 3) * 100, killed: 2, total: 3, killedLines: [30, 31], survived: [{ line: 30, operator: "Arithmetic mutation" }] },
    ]);
    expect(r.notes).toEqual([
      "Mutation hors du changement : src/Domaine/Montant.cs, 2 mutant(s) survivant(s) sur des lignes que la story ne modifie pas (ligne 14 (String mutation), ligne 21 (Equality mutation)) ; non jugés.",
    ]);
  });

  it("aucun mutant sur les lignes modifiées : le fichier n'est pas jugé, rien n'y a été mesuré", () => {
    const r = restreindreAuChangement(rapport, [{ path: "src/Domaine/Montant.cs", lines: [50] }]);
    expect(r.report.files).toEqual([]);
  });

  it("sans les lignes du changement, ou sans celles des mutants détectés, le fichier entier reste jugé", () => {
    expect(restreindreAuChangement(rapport, [{ path: "src/Domaine/Montant.cs" }]).report).toEqual(rapport);
    const sansLignes = { ...rapport, files: rapport.files.map(({ killedLines: _, ...f }) => f) };
    expect(restreindreAuChangement(sansLignes, [{ path: "src/Domaine/Montant.cs", lines: [30] }]).report).toEqual(sansLignes);
  });

  it("le rapport restreint passe la porte quand les lignes de la story sont couvertes par des tests qui tuent leurs mutants", () => {
    const r = restreindreAuChangement(rapport, [{ path: "src/Domaine/Montant.cs", lines: [8] }]);
    expect(checkMutation(r.report, ["src/Domaine/Montant.cs"], (parseQualityBar({}) as { bar: QualityBar }).bar)).toEqual([]);
    expect(checkMutation(rapport, ["src/Domaine/Montant.cs"], (parseQualityBar({}) as { bar: QualityBar }).bar)).not.toEqual([]);
  });
});
