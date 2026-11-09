import type { LintReport, TestResult } from "../protocols.js";
import { parseXunit } from "../reports/junit-xml.js";
import { parseTap } from "../reports/tap.js";
import { classifyFailure, parseVitestReport } from "../typescript/vitest-report.js";
import { parseEslintReport } from "../typescript/eslint-report.js";
import type { StackProfile } from "./stack-profile.js";

/**
 * Lecture des rapports nommés par un profil. Ces fonctions sont partagées par l'adaptateur et
 * par les canaris de `/stack doctor` : ce sont elles que les canaris mettent à l'épreuve, il
 * serait vain qu'ils en éprouvent une copie.
 */
export function lireTests(reader: StackProfile["tests"]["report"], brut: string, root: string): TestResult[] {
  if (reader === "junit-xml")
    return parseXunit(brut).map((c) => ({
      id: `${c.classname}.${c.name}`,
      file: c.classname,
      status: c.status,
      // La porte RED distingue un rouge légitime — assertion, symbole manquant — d'une erreur
      // de syntaxe. Sans classification, elle laisserait passer la seconde.
      ...(c.status === "failed" ? { failureKind: classifyFailure(c.raison ?? c.message ?? ""), ...(c.message ? { message: c.message } : {}) } : {}),
    }));
  if (reader === "vitest-json") return parseVitestReport(JSON.parse(brut), root);
  if (reader === "tap") return parseTap(brut, root);
  throw new Error(`Le format « ${reader} » ne décrit pas des résultats de tests.`);
}

export function lireLint(reader: NonNullable<StackProfile["lint"]>["report"], brut: unknown, root: string): LintReport {
  if (reader === "eslint-json") return parseEslintReport(brut, root);
  throw new Error(`Le format « ${reader} » ne décrit pas un rapport de linter.`);
}
