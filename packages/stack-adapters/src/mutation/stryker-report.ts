import { z } from "zod";
import { relatifDepuis } from "../chemin-relatif.js";
import type { MutationReport } from "../protocols.js";

/**
 * Rapport JSON de Stryker : schéma `mutation-testing-elements` (v2), commun à Stryker.NET,
 * StrykerJS et Stryker4s. Forme vérifiée sur un rapport réel de Stryker.NET 5.0.0 (03/10) ; seuls
 * les champs utiles sont lus.
 */
const schema = z.object({
  files: z.record(
    z.string(),
    z.object({
      mutants: z.array(
        z.object({
          mutatorName: z.string(),
          replacement: z.string().optional(),
          status: z.string(),
          location: z.object({ start: z.object({ line: z.number() }) }),
        }),
      ),
    }),
  ),
});

/** Mutants que la suite a détectés. */
const DETECTES = new Set(["Killed", "Timeout"]);
/** Mutants que la suite a laissés passer : survivants, et non couverts par aucun test. */
const NON_DETECTES = new Set(["Survived", "NoCoverage"]);
// Ne comptent pas : CompileError, RuntimeError, Ignored, Pending — le mutant n'a pas été jugé.

const arrondi = (x: number) => Math.round(x * 100) / 100;

/**
 * Score et survivants par fichier. Le score se calcule comme Stryker : détectés sur détectés et
 * non détectés. Un fichier sans mutant jugé est **absent** du rapport : rien n'y a été mesuré, et le
 * compter à 100 % ou à 0 % serait attester d'une mesure qui n'a pas eu lieu.
 */
export function parseStrykerReport(raw: unknown, root: string): MutationReport {
  const r = schema.safeParse(raw);
  if (!r.success) throw new Error("Rapport Stryker illisible (schéma mutation-testing-elements attendu)");
  let detectesTotal = 0;
  let jugesTotal = 0;
  const files: MutationReport["files"] = [];
  for (const [chemin, f] of Object.entries(r.data.files)) {
    const detectes = f.mutants.filter((m) => DETECTES.has(m.status)).length;
    const nonDetectes = f.mutants.filter((m) => NON_DETECTES.has(m.status));
    const juges = detectes + nonDetectes.length;
    if (juges === 0) continue;
    detectesTotal += detectes;
    jugesTotal += juges;
    files.push({
      file: relatifDepuis(root, chemin),
      score: (detectes / juges) * 100,
      killed: detectes,
      total: juges,
      survived: nonDetectes.map((m) => ({
        line: m.location.start.line,
        operator: m.status === "NoCoverage" ? `${m.mutatorName} (non couvert)` : m.mutatorName,
        ...(m.replacement !== undefined ? { replacement: m.replacement } : {}),
      })),
    });
  }
  return { score: jugesTotal ? arrondi((detectesTotal / jugesTotal) * 100) : 100, files };
}
