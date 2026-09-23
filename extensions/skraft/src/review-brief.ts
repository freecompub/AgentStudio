/**
 * Dossiers des lentilles (SPEC-skraft §9.1, §9.2), construits par le code. Pur.
 * - Faits établis : présentés comme acquis, les lentilles ne les revérifient pas.
 * - `cold-reader` ne reçoit aucun contexte du producteur ; `test-integrity` reçoit tests, critères et
 *   faits ; `architecture` reçoit les ADR ratifiés, le code et les faits.
 */
import type { Evidence } from "@agent-studio/extension-api";
import type { LensName } from "./difficulty.js";
import type { Phase, SkraftState } from "./model.js";

const short = (h: string) => h.slice(0, 12);

export function reviewFacts(state: SkraftState, phase: Phase, evidence: Evidence[]): string[] {
  const facts: string[] = [];
  for (const a of state.artifacts[phase]) facts.push(`Livrable ${a.path} : porte de ${phase} validée à l'essai ${a.attempt} (sha256 ${short(a.sha256)}).`);
  if ((phase === "DISTILL" || phase === "DELIVER") && state.acceptanceHash)
    facts.push(`Tests d'acceptance gelés, empreinte ${short(state.acceptanceHash)}${phase === "DELIVER" ? ", vérifiée inchangée à chaque pas de DELIVER" : ""}.`);
  for (const r of state.regressions) facts.push(`Test d'acceptance requalifié en non-régression, avec justification dans test-plan.md : ${r}.`);
  const last = evidence.filter((e) => e.source === "gate" && e.phase?.startsWith(phase)).at(-1);
  if (last)
    facts.push(
      `Dernière exécution des tests par le code (${last.phase}) : ${last.counts.passed} réussi(s), ${last.counts.failed} en échec, ${last.counts.skipped} ignoré(s)${last.timedOut ? ", délai dépassé" : ""}.`,
    );
  if (phase === "DELIVER" && state.deliver) {
    for (const sc of state.deliver.scenarios.filter((x) => x.status === "done")) {
      if (sc.role === "regression") facts.push(`Scénario ${sc.id} : non-régression, vert dès DISTILL (${sc.acceptanceTestId}).`);
      else
        facts.push(
          `Scénario ${sc.id} : test d'acceptance vert (${sc.acceptanceTestId}) ; tests unitaires ajoutés, chacun rouge puis vert dans les preuves : ${sc.unitTests?.length ? sc.unitTests.join(", ") : "aucun"}.`,
        );
    }
    facts.push(...state.deliver.facts);
    facts.push(...state.deliver.notes.map((n) => `À noter : ${n}`));
  }
  return facts;
}

export interface LensFiles {
  /** Livrables de la phase (documents, ADR, scénarios). */
  artifacts: string[];
  /** Fichiers de production modifiés pendant la phase. */
  code: string[];
  /** Fichiers de test modifiés pendant la phase. */
  tests: string[];
}

const list = (title: string, xs: string[]) => (xs.length ? [title, ...xs.map((x) => `  - ${x}`)] : []);

export function lensBrief(lens: LensName, state: SkraftState, phase: Phase, files: LensFiles, facts: string[]): string {
  const lines = [`Revue de la phase ${phase}.`];
  const factBlock = list("Faits établis par le code (acquis : ne les revérifie pas) :", facts);
  switch (lens) {
    case "cold-reader":
      lines.push(
        "Tu n'as aucun contexte du producteur : juge uniquement ce que disent les fichiers ci-dessous.",
        ...list("Livrables :", files.artifacts),
        ...list("Code :", files.code),
        ...list("Tests :", files.tests),
      );
      break;
    case "test-integrity": {
      const criteria = state.story?.criteria.map((c) => `${c.n}. ${c.text}`) ?? [];
      lines.push(...list("Critères d'acceptation :", criteria), ...list("Tests :", files.tests), ...list("Livrables :", files.artifacts), ...factBlock);
      break;
    }
    case "architecture": {
      const adrs = state.adrs.filter((a) => a.status === "Accepted").map((a) => `${a.id} : ${a.path}`);
      lines.push(...list("ADR ratifiés :", adrs), ...list("Code :", files.code), ...list("Livrables :", files.artifacts), ...factBlock);
      break;
    }
  }
  return lines.join("\n");
}
