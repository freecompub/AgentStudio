/**
 * Dossiers des lentilles (SPEC-skraft §9.1, §9.2), construits par le code. Pur.
 * - Faits établis : présentés comme acquis, les lentilles ne les revérifient pas.
 * - `cold-reader` ne reçoit aucun contexte du producteur ; `test-integrity` reçoit tests, critères et
 *   faits ; `architecture` reçoit les ADR ratifiés, le code et les faits.
 */
import type { Evidence } from "@agent-studio/extension-api";
import type { LensName } from "./difficulty.js";
import type { ArtifactRecord, Phase, SkraftState } from "./model.js";

const short = (h: string) => h.slice(0, 12);

/**
 * Livrables du dernier essai validé : la liste de l'état est en ajout seul (invariant 4), mais un
 * rollback de réessai efface les fichiers des essais précédents. Dernière empreinte par chemin.
 */
export function latestArtifacts(records: ArtifactRecord[]): ArtifactRecord[] {
  const last = Math.max(0, ...records.map((a) => a.attempt));
  const byPath = new Map<string, ArtifactRecord>();
  for (const a of records) if (a.attempt === last) byPath.set(a.path, a);
  return [...byPath.values()];
}

export function reviewFacts(state: SkraftState, phase: Phase, evidence: Evidence[]): string[] {
  const facts: string[] = [];
  for (const a of latestArtifacts(state.artifacts[phase])) facts.push(`Livrable ${a.path} : porte de ${phase} validée à l'essai ${a.attempt} (sha256 ${short(a.sha256)}).`);
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
    facts.push(...(state.deliver.facts ?? []));
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
    case "quality-gates":
      // Observatrice : elle ne reçoit ni code ni tests, seulement les faits et les livrables.
      // Lui donner le code l'inviterait à rejuger ce que les portes ont déjà mesuré.
      lines.push("Tu n'exécutes rien.");
      if (facts.length)
        lines.push("Les faits ci-dessous sont établis par le code et font foi : vérifie que les livrables leur sont fidèles, et signale ce qu'ils passent sous silence.", ...factBlock);
      // Filet (ADR 0028) : une stack sans outil de couverture, un DISTILL sans exécution de tests.
      // Sans cette phrase, la lentille cherche de la matière ailleurs et invente un grief hors de
      // son mandat — c'est ce qui a fait tourner DESIGN en rond le 28/09.
      else
        lines.push(
          "**Aucune mesure n'existe à ce stade de la tâche** : ni test exécuté, ni couverture, ni mutation, ni lint.",
          "Un écart que tu ne peux confronter à aucune mesure n'est pas de ton ressort — n'invente pas de défaut pour avoir quelque chose à dire.",
          "Il te reste une chose à chercher, et une seule : un livrable qui **se prévaut** d'une qualité que rien n'a mesurée. S'il n'y en a pas, approuve sans défaut.",
        );
      lines.push(...list("Livrables :", files.artifacts));
      break;
  }
  return lines.join("\n");
}
