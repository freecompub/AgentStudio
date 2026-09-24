/**
 * Lecture du rapport JSON d'ESLint. La qualité de forme est jugée par le linter du projet,
 * avec les seuils que le projet a lui-même choisis.
 */
import { describe, expect, it } from "vitest";
import { parseEslintReport } from "../src/typescript/eslint-report.js";

const rapport = [
  {
    filePath: "/projets/demo/src/bolus.ts",
    messages: [
      { ruleId: "max-lines-per-function", severity: 2, message: "Function has too many lines (48).", line: 12 },
      { ruleId: "max-depth", severity: 2, message: "Blocks are nested too deeply (4).", line: 20 },
      { ruleId: "no-unused-vars", severity: 1, message: "'x' is assigned a value but never used.", line: 3 },
    ],
  },
  { filePath: "/projets/demo/src/ok.ts", messages: [] },
];

describe("parseEslintReport", () => {
  it("ne retient que les erreurs, chemins relatifs à la racine", () => {
    const r = parseEslintReport(rapport, "/projets/demo");
    expect(r.available).toBe(true);
    expect(r.violations).toEqual([
      { file: "src/bolus.ts", line: 12, rule: "max-lines-per-function", message: "Function has too many lines (48)." },
      { file: "src/bolus.ts", line: 20, rule: "max-depth", message: "Blocks are nested too deeply (4)." },
    ]);
  });

  it("un avertissement n'est pas une violation : le projet a choisi de ne pas en faire une erreur", () => {
    const r = parseEslintReport(rapport, "/projets/demo");
    expect(r.violations.some((v) => v.rule === "no-unused-vars")).toBe(false);
  });

  it("un projet sans faute donne un rapport disponible et vide", () => {
    expect(parseEslintReport([{ filePath: "/projets/demo/src/ok.ts", messages: [] }], "/projets/demo")).toMatchObject({
      available: true,
      violations: [],
    });
  });

  it("une erreur d'analyse n'est pas une violation : le fichier n'a pas pu être lu", () => {
    // Un parser qui ne couvre pas un fichier est une affaire de configuration, que l'agent ne
    // peut pas corriger : en faire un motif de rejet ferait boucler le scénario jusqu'à
    // épuisement du budget.
    const r = parseEslintReport(
      [{ filePath: "/projets/demo/a.ts", messages: [{ ruleId: null, severity: 2, message: "Parsing error: Unexpected token", line: 1 }] }],
      "/projets/demo",
    );
    expect(r.violations).toEqual([]);
    expect(r.analyzed).toEqual([]);
  });

  it("un rapport illisible ne fait pas échouer la porte : rien n'est disponible", () => {
    expect(parseEslintReport("pas du json", "/projets/demo")).toEqual({ available: false, violations: [] });
    expect(parseEslintReport([{ nimporte: true }], "/projets/demo")).toEqual({ available: false, violations: [] });
  });

  it("dit quels fichiers ont été examinés", () => {
    expect(parseEslintReport(rapport, "/projets/demo").analyzed).toEqual(["src/bolus.ts", "src/ok.ts"]);
  });

  it("un fichier ignoré par la configuration n'est pas un fichier propre", () => {
    // ESLint répond ceci pour un fichier ignoré qu'on lui passe explicitement : sans traitement,
    // la sévérité 1 est filtrée, le rapport paraît vide, et la porte conclut à la conformité.
    const r = parseEslintReport(
      [{ filePath: "/projets/demo/src/genere.ts", messages: [{ ruleId: null, severity: 1, message: "File ignored because of a matching ignore pattern." }] }],
      "/projets/demo",
    );
    expect(r.violations).toEqual([]);
    expect(r.analyzed).toEqual([]);
  });
});
