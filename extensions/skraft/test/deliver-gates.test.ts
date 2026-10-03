import type { Evidence } from "@agent-studio/extension-api";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { GELÉS } from "../src/effects.js";
import { checkCoverage, checkDependencies, checkLint, checkMutation, checkRedGreenSequence, defaultDependencyRules, parseQualityBar, planScenarios, type QualityBar } from "../src/deliver.js";

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
    const r = parseQualityBar(JSON.stringify({ coverage: { core: 90, edge: 70 }, ...over }));
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
    const defaut = parseQualityBar(null);
    if ("error" in defaut) throw new Error(defaut.error);
    expect(checkCoverage(rapport([{ file: "src/Domain/Panier.cs", score: 5 }]), ["src/Domain/Panier.cs"], defaut.bar)).toEqual([]);
  });
});

/**
 * La barre de qualité n'est pas modifiable par ceux qu'elle juge (ADR 0034).
 *
 * Le périmètre d'écriture des rôles est `.skraft/**`, et `.skraft/quality.json` y vivait : seuils
 * de couverture, score de mutation, règles de dépendance — tout ce que la porte de livraison lit
 * pour juger. Un agent pouvait donc abaisser le critère sur lequel il allait être jugé, et la porte
 * l'aurait validé en toute bonne foi. Le contraire du principe du projet.
 */
describe("Barre de qualité hors de portée des agents", () => {
  it("`.skraft/quality.json` est gelé", () => {
    expect(GELÉS).toContain(".skraft/quality.json");
  });

  it("le gel est passé à chaque lancement de spécialiste, pas seulement déclaré", async () => {
    // Une constante que personne ne transmet ne protège rien.
    const src = await readFile(new URL("../src/effects.ts", import.meta.url), "utf8");
    expect(src).toMatch(/ctx\.agents\.run<"report_phase">\(effect\.role, brief, \{[^}]*readOnly: \[\.\.\.GELÉS\]/);
  });
});

/**
 * Run réel US-2 du 03/10 : DESIGN et DISTILL validées, puis DELIVER refusée trois fois avant même
 * le premier tour, « La suite est rouge avant DELIVER » — pour les deux tests d'acceptance que
 * DISTILL venait de laisser rouges, exactement comme sa porte RED l'exige. C'est l'ADR 0041 une
 * seconde fois : un rapport JUnit rend `file` comme un nom de classe, et les globs de
 * `layout.acceptanceTests` sont des chemins. Le correctif d'alors n'avait touché que DISTILL.
 */
describe("planDeliver — tests d'acceptance d'un rapport JUnit (.NET)", async () => {
  const { planDeliver } = await import("../src/deliver-effects.js");
  const { initialState } = await import("../src/reducer.js");
  const classe = "Tarification.Tests.RemiseParPalierAcceptanceTests";
  const acceptance = (n: number, status: "passed" | "failed") => ({ id: `${classe}.Ac${n}_Scenario_${n}`, file: classe, name: `Ac${n}_Scenario_${n}`, status, ...(status === "failed" ? { failureKind: "assertion", message: "Assert.Equal() Failure" } : {}) });
  const unitaire = (nom: string, status: "passed" | "failed" = "passed") => ({ id: `Tarification.Tests.CalculDuPanierTests.${nom}`, file: "Tarification.Tests.CalculDuPanierTests", name: nom, status, ...(status === "failed" ? { failureKind: "assertion", message: "x" } : {}) });

  const ctx = (results: unknown[]) =>
    ({
      workspace: { fingerprint: async () => "h", readFile: async () => { throw new Error("absent"); } },
      stack: { layout: { acceptanceTests: ["tests/**/*AcceptanceTests.cs"], unitTests: ["tests/**/*.cs"], sources: ["src/**/*.cs"] }, isTestFile: () => false, runTests: async () => ({ timedOut: false, results }) },
    }) as never;
  const state = { ...initialState({ storyPath: "stories/US-2.md" } as never), slug: "us-2", acceptanceHash: "h" };
  const run = (results: unknown[]) => planDeliver({ ctx: ctx(results), state, taskId: "t", signal: new AbortController().signal });

  it("les tests d'acceptance rouges laissés par DISTILL ne bloquent pas DELIVER, et deviennent ses scénarios", async () => {
    const ev = await run([unitaire("Un_panier_vide_vaut_zero"), acceptance(1, "passed"), acceptance(2, "failed"), acceptance(3, "failed")]);
    expect(ev.type).toBe("DELIVER_PLANNED");
    if (ev.type !== "DELIVER_PLANNED") return;
    expect(ev.scenarios.map((s) => s.id).sort()).toEqual(["ac-1", "ac-2", "ac-3"]);
  });

  it("un test unitaire rouge bloque toujours DELIVER", async () => {
    await expect(run([unitaire("Un_panier_vide_vaut_zero", "failed"), acceptance(2, "failed")])).rejects.toThrow(/La suite est rouge avant DELIVER : Tarification\.Tests\.CalculDuPanierTests\.Un_panier_vide_vaut_zero\./);
  });
});
