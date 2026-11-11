// Converti en JavaScript le 2026-10-10 depuis extensions/skraft-workflow/src/distillation.ts (ADR 0055).
/**
* Phase DISTILL en workflow : scénarios et tests d'acceptance, porte gherkin, porte valeurs, RED
* d'acceptance exécuté par le code (D20), puis gel des tests d'acceptance (D21) et revue.
*/
import { correspond as matchesAny, essayer } from "@agent-studio/workflow";
import { checkAcceptanceRed, checkPlans, checkValues, planDeTest, testsDeLaStory } from "./distill.mjs";
import { checkGherkin, checkTitresBdd, dossiersDesFeatures, gherkinDeLaStory, gherkinDuDisque } from "./gherkin.mjs";
import { reviewFacts } from "./review-brief.mjs";
import { ecrireRapports, enregistrerLivrables, nouveauSuivi, oublierLeRun, reviser, specialiste } from "./revue.mjs";
import { commitMessage, creerDossiers, sha256 } from "./support.mjs";
/** Rend vrai si la phase est faite, faux si l'humain l'a sautée. */
export async function distiller(w, d, lentilles, max) {
  const suivi = nouveauSuivi();
  const faite = await w.phase("DISTILL", async (cp, relance) => {
    // Gherkin déjà là au début de la phase (ADR 0074, run du 08/11) : celui des stories précédentes.
    // Relevé ici, au point de départ, que retrouve aussi une relance : le disque y est rembobiné.
    d.gherkinAvant = await gherkinDuDisque(w, d.slug, (await w.disposition()).bdd);
    // Relancée après une escalade : le premier essai reçoit son motif (D15 de docs/12).
    await essayer(w, { max, motifs: relance }, (motifs, essai) => unEssai(w, d, suivi, cp, lentilles, motifs, essai));
    await ecrireRapports(w, d.slug, "DISTILL", suivi);
    return true;
  }, {
    commit: commitMessage("DISTILL", d.slug),
    // Commit impossible, continué par l'humain : le bilan le dit (D19 de docs/12).
    commitManque: () => void d.nonCommitees.push("DISTILL"),
    apresRembobinage: () => {
      d.acceptanceHash = null;
      d.regressions = [];
      d.testsDeLaStory = null;
      // Livrables et rapports du run effacé : oubliés (D6, D8 de docs/12).
      oublierLeRun(suivi);
      return creerDossiers(w, d.slug);
    },
  });
  return faite === true;
}
async function unEssai(w, d, s, cp, lentilles, motifs, essai) {
  d.acceptanceHash = null;
  d.regressions = [];
  let approuve = false;
  try {
    const disp = await w.disposition();
    // Seul l'emplacement est dynamique : il vient de la stack ; la norme vit dans l'agent (ADR 0024, 0043).
    // L'agent vérifie son travail avec la porte que le code rejouera (ADR 0082).
    const verification = { outil: "verifier_scenarios", fichiers: fichiersDesScenarios(d.slug, disp.bdd, disp.acceptanceTests), donnees: donneesDesScenarios(d, disp.acceptanceTests, disp.bdd) };
    await specialiste(w, d, s, "DISTILL", "skraft-acceptance", motifs, `\nTests d'acceptance à écrire dans : ${disp.acceptanceTests.join(", ")}`, [], verification);
    const porte = await portes(w, d, s, cp, disp.acceptanceTests, essai, disp.bdd);
    if (porte.motifs.length)
      return porte;
    const faits = [
      ...reviewFacts(s.livrables, "DISTILL"),
      // Le gel n'est définitif qu'au commit de DISTILL : la revue peut encore faire corriger un test (D1 de docs/12).
      `Empreinte des tests d'acceptance prise (${d.acceptanceHash.slice(0, 12)}) : le gel devient définitif au commit de DISTILL.`,
      ...d.regressions.map((r) => `Test d'acceptance requalifié en non-régression, avec justification dans test-plan.md : ${r}.`),
      ...(d.derniereExecution ? [d.derniereExecution] : []),
    ];
    const rejet = await reviser(w, d, s, cp, "DISTILL", lentilles, essai, faits);
    approuve = rejet === undefined;
    return rejet ?? [];
  } finally {
    if (!approuve) {
      d.acceptanceHash = null;
      d.regressions = [];
    }
  }
}
/**
* Porte gherkin AVANT la porte valeurs : un scénario couplé à un détail technique doit être refusé
* avant la revue et le gel définitif de DISTILL. Puis RED d'acceptance (ADR 0041).
*/
/** Les fichiers que les portes de forme de DISTILL examinent : livrables, Gherkin, tests d'acceptance. */
export function fichiersDesScenarios(slug, bdd, globsAcceptance) {
  return [`.skraft/${slug}/distill/**`, ...dossiersDesFeatures(slug, bdd).map((x) => `${x}/**`), ...globsAcceptance];
}
/**
* Portes de forme de DISTILL (gherkin, valeurs, plan de test), sur des contenus déjà lus. Pure : la
* porte et l'outil `verifier_scenarios` de l'agent appellent ce même calcul (ADR 0082).
*/
export function motifsDesScenarios({ fichiers, slug, bdd, gherkinAvant, criteria, globsAcceptance }) {
  const dir = `.skraft/${slug}/distill`;
  const chemins = Object.keys(fichiers).sort();
  const dossiers = dossiersDesFeatures(slug, bdd);
  const lus = (garder) => chemins.filter(garder).map((path) => ({ path, content: fichiers[path] }));
  // BDD (ADR 0074) : le Gherkin vit dans les dossiers `features` du projet, non dans `.skraft/`.
  // Seuls les scénarios de la story sont jugés ; toucher à ceux d'une story précédente est refusé.
  const { features, modifies } = gherkinDeLaStory(gherkinAvant ?? [], lus((f) => dossiers.some((x) => f.startsWith(`${x}/`)) && f.endsWith(".feature")));
  if (modifies.length)
    return { motifs: modifies, porte: "gherkin" };
  const gherkin = [...checkGherkin(features), ...(bdd?.length ? checkTitresBdd(features) : [])];
  if (gherkin.length)
    return { motifs: gherkin, porte: "gherkin" };
  const valeurs = checkValues({ criteria, features, acceptanceTests: lus((f) => matchesAny(globsAcceptance, f)) });
  if (valeurs.length)
    return { motifs: valeurs, porte: "valeurs" };
  const testPlan = fichiers[`${dir}/test-plan.md`];
  if (testPlan === undefined)
    return { motifs: [`Plan de test absent : ${dir}/test-plan.md`], porte: "plan de test" };
  // Plans vérifiés avant d'exécuter quoi que ce soit (option C de docs/15 §4.5).
  const plans = checkPlans({ criteria, testPlan, implPlan: fichiers[`${dir}/impl-plan.md`] ?? null });
  if (plans.length)
    return { motifs: plans, porte: "plan de test" };
  return { motifs: [], porte: "" };
}
/** Réponse de l'outil `verifier_scenarios` à l'agent : ce que la porte dirait de son travail. */
export function texteDeVerification({ motifs, porte }) {
  if (!motifs.length)
    return "Aucun motif : les portes gherkin, valeurs et plan de test accepteraient ce travail en l'état. Le RED d'acceptance reste à prouver : le code lancera les tests après ton tour.";
  return [`La porte « ${porte} » refuserait ce travail :`, ...motifs.map((m) => `- ${m}`), "Corrige, puis vérifie de nouveau."].join("\n");
}
/** Les données de la vérification d'un tour de DISTILL : ce que la porte sait, hors fichiers. */
export function donneesDesScenarios(d, globsAcceptance, bdd) {
  return { slug: d.slug, bdd: bdd ?? null, gherkinAvant: d.gherkinAvant ?? [], criteria: d.story.criteria, globsAcceptance };
}
async function portes(w, d, s, cp, globsAcceptance, essai, bdd) {
  const motifs = fichiersDesScenarios(d.slug, bdd, globsAcceptance);
  const fichiers = {};
  for (const path of (await w.listerFichiers()).filter((f) => matchesAny(motifs, f)))
    fichiers[path] = await w.lireFichier(path);
  const forme = motifsDesScenarios({ fichiers, ...donneesDesScenarios(d, globsAcceptance, bdd) });
  if (forme.motifs.length)
    return forme;
  const testPlan = fichiers[`.skraft/${d.slug}/distill/test-plan.md`];
  const run = await w.lancerTests({ etiquette: "DISTILL_RED" });
  if (run.timedOut)
    return { motifs: ["Les tests ont dépassé le délai."], porte: "RED d'acceptance" };
  const red = checkAcceptanceRed({ criteria: d.story.criteria, testPlan, results: run.results, avant: d.testsAvant });
  if (red.reasons.length)
    return { motifs: red.reasons, porte: "RED d'acceptance" };
  const compte = (st) => run.results.filter((r) => r.status === st).length;
  d.derniereExecution = `Dernière exécution des tests par le code (DISTILL_RED) : ${compte("passed")} réussi(s), ${compte("failed")} en échec, ${compte("skipped")} ignoré(s).`;
  await enregistrerLivrables(w, s, (await w.fichiersModifies(cp)).filter((f) => f.status !== "deleted").map((f) => f.path), essai, sha256);
  d.acceptanceHash = await w.empreinte(["@stack:acceptanceTests"]);
  d.regressions = red.regressions;
  d.testsDeLaStory = testsDeLaStory(run.results, d.testsAvant);
  // La matrice du plan de test est gardée : DELIVER y vérifie les écarts déclarés (ADR 0067).
  d.planDeTest = planDeTest(testPlan);
  return { motifs: [], porte: "" };
}
