/** Revue (SPEC-skraft §9) : verdicts des lentilles à schéma, synthèse appliquée par le code. */
export type Verdict = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

export interface LensDefect {
  severity: "blocker" | "major" | "minor";
  file?: string;
  line?: number;
  description: string;
}

export interface LensVerdict {
  lens: string;
  verdict: Verdict;
  defects: LensDefect[];
}

/**
 * Règles minimales de §9.3, en attendant la transcription de la table de pondération (sous réserve
 * de la décision de licence, ADR 0012). Fonction pure : mêmes JSON, même verdict.
 */
export function synthesize(lenses: LensVerdict[]): Verdict {
  if (lenses.length === 0) return "CHANGES_REQUESTED";
  if (lenses.filter((l) => l.verdict === "REJECTED").length >= 2) return "REJECTED";
  if (lenses.some((l) => l.defects.some((d) => d.severity === "blocker"))) return "CHANGES_REQUESTED";
  if (lenses.every((l) => l.verdict === "APPROVED") && !lenses.some((l) => l.defects.some((d) => d.severity === "major"))) return "APPROVED";
  return "CHANGES_REQUESTED";
}

/** Défauts transmis au spécialiste lors d'un réessai : `blocker` et `major` seulement, avec fichier et ligne. */
export function actionableDefects(lenses: LensVerdict[]): string[] {
  return lenses.flatMap((l) =>
    l.defects
      .filter((d) => d.severity !== "minor")
      .map((d) => `[${l.lens}, ${d.severity}] ${d.description}${d.file ? ` (${d.file}${d.line ? `:${d.line}` : ""})` : ""}`),
  );
}
