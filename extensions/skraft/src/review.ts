/** Revue (SPEC-skraft §9) : verdicts des lentilles à schéma, synthèse appliquée par le code. */
import { z } from "zod";
export type Verdict = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

export interface LensDefect {
  severity: "blocker" | "major" | "minor";
  file?: string | undefined;
  line?: number | undefined;
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

/** Rapport lisible généré par le code depuis les verdicts des lentilles (§9.3). Pur, déterministe. */
export function reviewReport(phase: string, attempt: number, lenses: LensVerdict[]): string {
  const lines = [`# Revue ${phase}, essai ${attempt}`, "", `Verdict (synthèse du code) : ${synthesize(lenses)}`, ""];
  for (const v of lenses) {
    lines.push(`## Lentille ${v.lens} : ${v.verdict}`, "");
    if (!v.defects.length) lines.push("Aucun défaut.", "");
    for (const d of v.defects) lines.push(`- **${d.severity}** ${d.description}${d.file ? ` (${d.file}${d.line ? `:${d.line}` : ""})` : ""}`);
    lines.push("");
  }
  return lines.join("\n");
}

const lensesSchema = z.array(
  z.object({
    lens: z.string(),
    verdict: z.enum(["APPROVED", "CHANGES_REQUESTED", "REJECTED"]),
    defects: z.array(z.object({ severity: z.enum(["blocker", "major", "minor"]), description: z.string(), file: z.string().optional(), line: z.number().optional() })),
  }),
);

/** Rejoue une revue depuis son JSON : même verdict, même rapport (critère de sortie de S6). */
export function replayReview(phase: string, attempt: number, json: string): { verdict: Verdict; markdown: string } {
  const lenses: LensVerdict[] = lensesSchema.parse(JSON.parse(json));
  return { verdict: synthesize(lenses), markdown: reviewReport(phase, attempt, lenses) };
}
