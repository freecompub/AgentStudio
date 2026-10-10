import type { CoverageReport, TestRun } from "../protocols.js";

/** Intersection des lignes exécutables mesurées avec les ajouts du diff Git. */
export function coverageForChanges(report: CoverageReport, changes: { path: string; lines?: number[] }[]): { report: CoverageReport; notes: string[] } {
  const files: CoverageReport["files"] = [];
  const notes: string[] = [];
  for (const change of changes) {
    const f = report.files.find((x) => x.file === change.path || change.path.endsWith(`/${x.file}`));
    if (!f?.lines || !change.lines) {
      notes.push(`Couverture du diff non mesurée : ${change.path} (${!change.lines ? "lignes du diff absentes" : !f ? "fichier absent du rapport" : "détail par ligne absent"}).`);
      continue;
    }
    const changed = new Set(change.lines);
    const lines = f.lines.filter((l) => changed.has(l.number));
    if (!lines.length) {
      notes.push(`Aucune ligne exécutable modifiée à couvrir : ${change.path}.`);
      continue;
    }
    const covered = lines.filter((l) => l.covered).length;
    files.push({ file: change.path, covered, total: lines.length, score: covered / lines.length * 100, lines });
  }
  return { report: { files }, notes };
}

/** Le précontrôle ne peut pas masquer une sortie en erreur derrière des résultats verts. */
export function baselineProblems(run: TestRun): string[] {
  const reasons: string[] = [];
  if (run.timedOut) reasons.push("Les tests existants ont dépassé le délai.");
  if (run.exitCode !== 0) reasons.push(`Exécution des tests existants en erreur (code ${run.exitCode ?? "inconnu"}).`);
  const failed = run.results.filter((r) => r.status === "failed");
  const skipped = run.results.filter((r) => r.status === "skipped");
  if (failed.length) reasons.push(`Tests existants en échec : ${failed.map((r) => r.id).join(", ")}.`);
  if (skipped.length) reasons.push(`Tests existants ignorés : ${skipped.map((r) => r.id).join(", ")}.`);
  return reasons;
}
