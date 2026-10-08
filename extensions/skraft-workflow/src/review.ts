// Copie de extensions/skraft/src/review.ts (2026-10-08) : skraft-workflow est indépendante de skraft
// et n'en importe rien ; une correction de l'une ne se reporte pas seule dans l'autre.
/**
 * Revue (SPEC-skraft §9) : verdicts des lentilles à schéma, synthèse appliquée par le code.
 *
 * PROVENANCE — les quatre questions, leurs poids, la règle du minimum, l'arrêt sur question non
 * couverte et l'interdiction d'un score total sont repris de **skraft-plugin**
 * (GPL-3.0-or-later), branche `refactor/v1.6.0-tracking-substrate` :
 * `skills/adversarial-review-lenses/SKILL.md` pour la procédure, et
 * `com.anthropic.claude-code/agents/software-engineer-reviewer.md` pour la correspondance
 * lentille → question, reprise telle quelle. Voir `docs/licences/autorisation-skraft.md`.
 *
 * ADAPTATION — dans le dépôt d'origine, la synthèse est faite par l'agent réviseur. Ici elle est
 * **exécutée par le code** : c'est le principe directeur du projet, et cela rend la revue
 * rejouable à l'identique depuis son seul JSON.
 */
import { z } from "zod";
export type Verdict = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

/** À qui revient un défaut (ADR 0046) : à l'agent des tests, à celui du code, ou au livrable de la phase. */
export type DefectTarget = "test" | "code" | "deliverable";

export interface LensDefect {
  severity: "blocker" | "major" | "minor";
  file?: string | undefined;
  line?: number | undefined;
  description: string;
  /** Cible déclarée par la lentille, puis corrigée par le code d'après le fichier cité. */
  target?: DefectTarget | undefined;
  /** Identifiant attribué par le code (`lentille#tour.n`), jamais par le modèle. */
  id?: string | undefined;
  /** Écart entre la cible déclarée et la nature du fichier cité, pour la trace. */
  targetNote?: string | undefined;
}

/** Arbitrage d'une lentille sur un de ses défauts que l'agent a contesté (ADR 0046). */
export interface LensRuling {
  defect: string;
  decision: "accepted" | "maintained";
  reason?: string | undefined;
}

export interface LensVerdict {
  lens: string;
  verdict: Verdict;
  defects: LensDefect[];
  rulings?: LensRuling[] | undefined;
}

/**
 * Les quatre questions auxquelles toute revue doit répondre, et le poids de chacune. Une revue qui
 * en laisse une sans réponse n'est pas une revue : ce n'est pas la lentille qui est obligatoire,
 * c'est la question. `answeredBy` nomme les lentilles qui y répondent — correspondance reprise
 * telle quelle de `software-engineer-reviewer.md`.
 */
export const REVIEW_QUESTIONS = {
  completeness: { weight: 0.3, answeredBy: ["quality-gates", "test-integrity"] },
  businessFit: { weight: 0.3, answeredBy: ["cold-reader"] },
  quality: { weight: 0.15, answeredBy: ["quality-gates", "architecture", "test-integrity"] },
  risk: { weight: 0.25, answeredBy: ["quality-gates", "architecture", "test-integrity", "cold-reader"] },
} as const satisfies Record<string, { weight: number; answeredBy: readonly string[] }>;

export type ReviewQuestion = keyof typeof REVIEW_QUESTIONS;

export interface QuestionAssessment {
  question: ReviewQuestion;
  weight: number;
  /** Lentilles effectivement présentes qui répondent à cette question. */
  answeredBy: string[];
  /** `null` quand aucune lentille n'y a répondu : la question reste ouverte. */
  rating: 0 | 0.5 | 1 | null;
  contribution: number | null;
}

/**
 * Note d'une lentille : `0` quand elle signale un défaut rédhibitoire — un `blocker`, ou un rejet
 * franc —, `0.5` quand elle a trouvé quelque chose de moindre, `1` quand elle n'a rien trouvé.
 */
function noterLentille(l: LensVerdict): 0 | 0.5 | 1 {
  if (l.verdict === "REJECTED" || l.defects.some((d) => d.severity === "blocker")) return 0;
  return l.defects.length > 0 ? 0.5 : 1;
}

/**
 * Ce que chaque question retient : **la note la plus basse** parmi les lentilles qui y répondent.
 * Une lentille satisfaite ne rattrape pas une lentille inquiète sur la même question.
 */
export function assessQuestions(lenses: LensVerdict[]): QuestionAssessment[] {
  return (Object.keys(REVIEW_QUESTIONS) as ReviewQuestion[]).map((question) => {
    const { weight, answeredBy } = REVIEW_QUESTIONS[question];
    const presentes = lenses.filter((l) => (answeredBy as readonly string[]).includes(l.lens));
    if (presentes.length === 0) return { question, weight, answeredBy: [], rating: null, contribution: null };
    const rating = presentes.map(noterLentille).reduce((a, b) => (b < a ? b : a));
    return { question, weight, answeredBy: presentes.map((l) => l.lens), rating, contribution: Number((rating * weight).toFixed(4)) };
  });
}

/** Questions qu'aucune lentille présente n'a traitées. Une question non posée ne revient jamais propre. */
export function uncoveredQuestions(lenses: LensVerdict[]): ReviewQuestion[] {
  return assessQuestions(lenses)
    .filter((q) => q.rating === null)
    .map((q) => q.question);
}

/**
 * Verdict de §9.3. Les contributions pondérées **éclairent** la synthèse, elles ne la décident
 * pas : une porte, un `blocker` ou une règle de gravité l'emportent toujours sur un calcul.
 * Fonction pure : mêmes JSON, même verdict.
 */
export function synthesize(lenses: LensVerdict[]): Verdict {
  if (lenses.length === 0) return "CHANGES_REQUESTED";
  if (lenses.filter((l) => l.verdict === "REJECTED").length >= 2) return "REJECTED";
  if (lenses.some((l) => l.defects.some((d) => d.severity === "blocker"))) return "CHANGES_REQUESTED";
  // Arrêt sur question non couverte : approuver sans avoir posé une question reviendrait à la
  // déclarer propre sans l'avoir examinée.
  if (uncoveredQuestions(lenses).length > 0) return "CHANGES_REQUESTED";
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

  // Les contributions sont publiées question par question, et **jamais additionnées** : un total
  // unique masquerait qu'une porte l'emporte toujours sur un calcul.
  lines.push("## Questions", "", "| Question | Répondue par | Poids | Contribution |", "| --- | --- | --- | --- |");
  for (const q of assessQuestions(lenses))
    lines.push(
      q.rating === null
        ? `| ${q.question} | **aucune lentille** | ${q.weight} | — |`
        : `| ${q.question} | ${q.answeredBy.join(", ")} | ${q.weight} | ${q.contribution} |`,
    );
  const ouvertes = uncoveredQuestions(lenses);
  lines.push("", ...(ouvertes.length ? [`Questions restées sans réponse : **${ouvertes.join(", ")}**.`, ""] : []));

  for (const v of lenses) {
    lines.push(`## Lentille ${v.lens} : ${v.verdict}`, "");
    if (!v.defects.length) lines.push("Aucun défaut.", "");
    for (const d of v.defects)
      lines.push(`- ${d.id ? `\`${d.id}\` ` : ""}**${d.severity}**${d.target ? ` (${d.target})` : ""} ${d.description}${d.file ? ` (${d.file}${d.line ? `:${d.line}` : ""})` : ""}`);
    for (const r of v.rulings ?? []) lines.push(`- arbitrage sur \`${r.defect}\` : **${r.decision}**${r.reason ? ` — ${r.reason}` : ""}`);
    lines.push("");
  }
  return lines.join("\n");
}

const lensesSchema = z.array(
  z.object({
    lens: z.string(),
    verdict: z.enum(["APPROVED", "CHANGES_REQUESTED", "REJECTED"]),
    defects: z.array(
      z.object({
        severity: z.enum(["blocker", "major", "minor"]),
        description: z.string(),
        file: z.string().optional(),
        line: z.number().optional(),
        target: z.enum(["test", "code", "deliverable"]).optional(),
        id: z.string().optional(),
        targetNote: z.string().optional(),
      }),
    ),
    rulings: z.array(z.object({ defect: z.string(), decision: z.enum(["accepted", "maintained"]), reason: z.string().optional() })).optional(),
  }),
);

/** Rejoue une revue depuis son JSON : même verdict, même rapport (critère de sortie de S6). */
export function replayReview(phase: string, attempt: number, json: string): { verdict: Verdict; markdown: string } {
  const lenses: LensVerdict[] = lensesSchema.parse(JSON.parse(json));
  return { verdict: synthesize(lenses), markdown: reviewReport(phase, attempt, lenses) };
}
