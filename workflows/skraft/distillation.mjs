// Converti en JavaScript le 2026-10-10 depuis extensions/skraft-workflow/src/distillation.ts (ADR 0055).
/**
* Phase DISTILL en workflow : scénarios et tests d'acceptance, porte gherkin, porte valeurs, RED
* d'acceptance exécuté par le code (D20), puis gel des tests d'acceptance (D21) et revue.
*/
import { correspond as matchesAny, essayer, PanneEnvironnement } from "@agent-studio/workflow";
import { checkAcceptanceRed, checkValues } from "./distill.mjs";
import { checkGherkin } from "./gherkin.mjs";
import { reviewFacts } from "./review-brief.mjs";
import { ecrireRapport, enregistrerLivrables, nouveauSuivi, reviser, specialiste } from "./revue.mjs";
import { commitMessage, creerDossiers, sha256 } from "./support.mjs";
/** Rend vrai si la phase est faite, faux si l'humain l'a sautée. */
export async function distiller(w, d, lentilles, max) {
  const suivi = nouveauSuivi();
  const faite = await w.phase("DISTILL", async (cp) => {
    await essayer(w, { max }, (motifs, essai) => unEssai(w, d, suivi, cp, lentilles, motifs, essai));
    for (const r of suivi.revues)
      await ecrireRapport(w, d.slug, "DISTILL", r.essai, r.lentilles);
    return true;
  }, { commit: commitMessage("DISTILL", d.slug), apresRembobinage: () => creerDossiers(w, d.slug) });
  return faite === true;
}
async function unEssai(w, d, s, cp, lentilles, motifs, essai) {
  const disp = await w.disposition();
  // Seul l'emplacement est dynamique : il vient de la stack ; la norme vit dans l'agent (ADR 0024, 0043).
  await specialiste(w, d, s, "DISTILL", "skraft-acceptance", motifs, `\nTests d'acceptance à écrire dans : ${disp.acceptanceTests.join(", ")}`);
  const porte = await portes(w, d, s, cp, disp.acceptanceTests, essai);
  if (porte.length)
    return porte;
  const faits = [
    ...reviewFacts(s.livrables, "DISTILL"),
    `Tests d'acceptance gelés, empreinte ${d.acceptanceHash.slice(0, 12)}.`,
    ...d.regressions.map((r) => `Test d'acceptance requalifié en non-régression, avec justification dans test-plan.md : ${r}.`),
    ...(d.derniereExecution ? [d.derniereExecution] : []),
  ];
  return (await reviser(w, d, s, cp, "DISTILL", lentilles, essai, faits)) ?? [];
}
/**
* Porte gherkin AVANT la porte valeurs : un scénario couplé à un détail technique doit être refusé
* avant le gel, passé lequel plus personne ne peut le réécrire. Puis RED d'acceptance (ADR 0041).
*/
async function portes(w, d, s, cp, globsAcceptance, essai) {
  const dir = `.skraft/${d.slug}/distill`;
  const fichiers = await w.listerFichiers();
  const lire = async (chemins) => Promise.all(chemins.map(async (path) => ({ path, content: await w.lireFichier(path) })));
  const features = await lire(fichiers.filter((f) => f.startsWith(`${dir}/features/`) && f.endsWith(".feature")));
  const gherkin = checkGherkin(features);
  if (gherkin.length)
    return gherkin;
  const valeurs = checkValues({ criteria: d.story.criteria, features, acceptanceTests: await lire(fichiers.filter((f) => matchesAny(globsAcceptance, f))) });
  if (valeurs.length)
    return valeurs;
  let testPlan;
  try {
    testPlan = await w.lireFichier(`${dir}/test-plan.md`);
  }
  catch (e) {
    if (e instanceof PanneEnvironnement)
      throw e;
    return [`Plan de test absent : ${dir}/test-plan.md`];
  }
  const run = await w.lancerTests({ etiquette: "DISTILL_RED" });
  if (run.timedOut)
    return ["Les tests ont dépassé le délai."];
  const red = checkAcceptanceRed({ criteria: d.story.criteria, testPlan, results: run.results });
  if (red.reasons.length)
    return red.reasons;
  const compte = (st) => run.results.filter((r) => r.status === st).length;
  d.derniereExecution = `Dernière exécution des tests par le code (DISTILL_RED) : ${compte("passed")} réussi(s), ${compte("failed")} en échec, ${compte("skipped")} ignoré(s).`;
  await enregistrerLivrables(w, s, (await w.fichiersModifies(cp)).filter((f) => f.status !== "deleted").map((f) => f.path), essai, sha256);
  // Gel des tests d'acceptance, écrit une seule fois.
  if (!d.acceptanceHash) {
    d.acceptanceHash = await w.empreinte(["@stack:acceptanceTests"]);
    d.regressions = red.regressions;
  }
  return [];
}
