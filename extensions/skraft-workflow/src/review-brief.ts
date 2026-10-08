// Repris de extensions/skraft/src/review-brief.ts (2026-10-08), sans l'état du réducteur : le
// script passe ce qu'il sait. Même texte pour les lentilles. Pur.
import type { LensName } from "./difficulty.js";
import type { Phase } from "./support.js";

/** Livrable validé par la porte d'un essai. */
export interface Livrable {
  path: string;
  sha256: string;
  attempt: number;
}

const short = (h: string) => h.slice(0, 12);

/** Livrables du dernier essai validé, dernière empreinte par chemin. */
export function latestArtifacts(records: readonly Livrable[]): Livrable[] {
  const last = Math.max(0, ...records.map((a) => a.attempt));
  const byPath = new Map<string, Livrable>();
  for (const a of records) if (a.attempt === last) byPath.set(a.path, a);
  return [...byPath.values()];
}

/** Faits établis par le code pour la revue (§9.1) ; DESIGN n'exécute aucun test, donc aucune preuve. */
export function reviewFacts(livrables: readonly Livrable[], phase: Phase): string[] {
  return latestArtifacts(livrables).map((a) => `Livrable ${a.path} : porte de ${phase} validée à l'essai ${a.attempt} (sha256 ${short(a.sha256)}).`);
}

export interface LensFiles {
  artifacts: string[];
  code: string[];
  tests: string[];
}

export interface LensContext {
  criteria: { n: number; text: string }[];
  /** ADR ratifiés (`Accepted`), pour la lentille architecture. */
  adrs: { id: string; path: string }[];
}

const list = (title: string, xs: string[]) => (xs.length ? [title, ...xs.map((x) => `  - ${x}`)] : []);

export function lensBrief(lens: LensName, c: LensContext, phase: Phase, files: LensFiles, facts: string[], history: string[] = []): string {
  const lines = [`Revue de la phase ${phase}.`, ...history];
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
    case "test-integrity":
      lines.push(...list("Critères d'acceptation :", c.criteria.map((x) => `${x.n}. ${x.text}`)), ...list("Tests :", files.tests), ...list("Livrables :", files.artifacts), ...factBlock);
      break;
    case "architecture":
      lines.push(...list("ADR ratifiés :", c.adrs.map((a) => `${a.id} : ${a.path}`)), ...list("Code :", files.code), ...list("Livrables :", files.artifacts), ...factBlock);
      break;
    case "quality-gates":
      lines.push("Tu n'exécutes rien.");
      if (facts.length)
        lines.push("Les faits ci-dessous sont établis par le code et font foi : vérifie que les livrables leur sont fidèles, et signale ce qu'ils passent sous silence.", ...factBlock);
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
