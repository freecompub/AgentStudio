import { describe, expect, it } from "vitest";
import { coverageForChanges, baselineProblems } from "../src/coverage/changed-coverage.js";

describe("couverture du code modifié", () => {
  const report = { files: [{ file: "src/A.cs", covered: 1, total: 2, score: 50, lines: [{ number: 8, covered: false }, { number: 20, covered: true }] }] };

  it("exclut la dette historique et les lignes non exécutables", () => {
    const r = coverageForChanges(report, [{ path: "src/A.cs", lines: [19, 20] }]);
    expect(r.report.files).toEqual([{ file: "src/A.cs", covered: 1, total: 1, score: 100, lines: [{ number: 20, covered: true }] }]);
    expect(r.notes).toEqual([]);
  });

  it("compte une ancienne ligne désormais modifiée et les lignes des fichiers nouveaux", () => {
    expect(coverageForChanges(report, [{ path: "src/A.cs", lines: [8, 20] }]).report.files[0]?.score).toBe(50);
  });

  it("signale le détail absent sans prétendre mesurer le diff sur un total global", () => {
    const r = coverageForChanges({ files: [{ file: "src/A.cs", covered: 1, total: 2, score: 50 }] }, [{ path: "src/A.cs", lines: [20] }]);
    expect(r.report.files).toEqual([]);
    expect(r.notes.join(" ")).toContain("non mesurée");
    expect(coverageForChanges(report, [{ path: "src/A.cs" }]).notes.join(" ")).toContain("diff");
    expect(coverageForChanges(report, [{ path: "src/B.cs", lines: [1] }]).notes.join(" ")).toContain("src/B.cs");
  });

  it("aucune ligne exécutable modifiée : pas de taux fictif", () => {
    const r = coverageForChanges(report, [{ path: "src/A.cs", lines: [19] }]);
    expect(r.report.files).toEqual([]);
    expect(r.notes.join(" ")).toContain("Aucune ligne exécutable");
  });
});

describe("précontrôle des tests existants", () => {
  const green = { results: [{ id: "ancien", file: "t", status: "passed" as const }], exitCode: 0, timedOut: false, output: "", durationMs: 1 };
  it("autorise les tests verts", () => expect(baselineProblems(green)).toEqual([]));
  it("refuse rouge, ignoré, délai et sortie en erreur même sans résultat rouge", () => {
    expect(baselineProblems({ ...green, results: [{ ...green.results[0]!, status: "failed" }] }).join(" ")).toContain("ancien");
    expect(baselineProblems({ ...green, results: [{ ...green.results[0]!, status: "skipped" }] }).join(" ")).toContain("ignorés");
    expect(baselineProblems({ ...green, timedOut: true }).join(" ")).toContain("délai");
    expect(baselineProblems({ ...green, exitCode: 1 }).join(" ")).toContain("code 1");
  });
});
