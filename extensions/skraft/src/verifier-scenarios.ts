/**
 * Portes de forme de DISTILL (gherkin, valeurs, plan de test), sur des contenus déjà lus (ADR 0082).
 * Pure : la porte et l'outil `verifier_scenarios` de l'agent appellent ce même calcul, l'agent est
 * donc jugé comme il s'est vérifié.
 */
import type { ContexteDeVerification, ExtensionTool } from "@agent-studio/extension-api";
import { matchesAny } from "@agent-studio/extension-api";
import { checkPlans, checkValues, type SourceFile } from "./distill.js";
import { checkGherkin, checkTitresBdd, dossiersDesFeatures, gherkinDeLaStory } from "./gherkin.js";
import type { Criterion } from "./story.js";

type Bdd = readonly { lanceur?: string; features: string; etapes?: string }[] | undefined;

/** Ce que la porte sait, hors fichiers. */
export interface DonneesDesScenarios {
  slug: string;
  bdd: Bdd | null;
  gherkinAvant: SourceFile[];
  criteria: Criterion[];
  globsAcceptance: string[];
}

/** Les fichiers que les portes de forme de DISTILL examinent : livrables, Gherkin, tests d'acceptance. */
export function fichiersDesScenarios(slug: string, bdd: Bdd, globsAcceptance: readonly string[]): string[] {
  return [`.skraft/${slug}/distill/**`, ...dossiersDesFeatures(slug, bdd).map((x) => `${x}/**`), ...globsAcceptance];
}

export function motifsDesScenarios(i: { fichiers: Record<string, string> } & DonneesDesScenarios): { motifs: string[]; porte: string } {
  const dir = `.skraft/${i.slug}/distill`;
  const bdd = i.bdd ?? undefined;
  const chemins = Object.keys(i.fichiers).sort();
  const dossiers = dossiersDesFeatures(i.slug, bdd);
  const lus = (garder: (p: string) => boolean): SourceFile[] => chemins.filter(garder).map((path) => ({ path, content: i.fichiers[path]! }));
  // BDD (ADR 0074) : le Gherkin vit dans les dossiers `features` du projet, non dans `.skraft/`.
  // Seuls les scénarios de la story sont jugés ; toucher à ceux d'une story précédente est refusé.
  const { features, modifies } = gherkinDeLaStory(i.gherkinAvant, lus((f) => dossiers.some((x) => f.startsWith(`${x}/`)) && f.endsWith(".feature")));
  if (modifies.length) return { motifs: modifies, porte: "gherkin" };
  // Porte `gherkin` AVANT la porte `valeurs` : un scénario couplé à un détail technique doit être
  // refusé même s'il contient les bonnes valeurs, et surtout avant le gel des tests d'acceptance.
  const gherkin = [...checkGherkin(features), ...(bdd?.length ? checkTitresBdd(features) : [])];
  if (gherkin.length) return { motifs: gherkin, porte: "gherkin" };
  const valeurs = checkValues({ criteria: i.criteria, features, acceptanceTests: lus((f) => matchesAny(i.globsAcceptance, f)) });
  if (valeurs.length) return { motifs: valeurs, porte: "valeurs" };
  const testPlan = i.fichiers[`${dir}/test-plan.md`];
  if (testPlan === undefined) return { motifs: [`Plan de test absent : ${dir}/test-plan.md`], porte: "plan de test" };
  // Plans vérifiés avant d'exécuter quoi que ce soit (option C de docs/15 §4.5).
  const plans = checkPlans({ criteria: i.criteria, testPlan, implPlan: i.fichiers[`${dir}/impl-plan.md`] ?? null });
  if (plans.length) return { motifs: plans, porte: "plan de test" };
  return { motifs: [], porte: "" };
}

/** Réponse de l'outil à l'agent : ce que la porte dirait de son travail. */
export function texteDeVerification({ motifs, porte }: { motifs: string[]; porte: string }): string {
  if (!motifs.length)
    return "Aucun motif : les portes gherkin, valeurs et plan de test accepteraient ce travail en l'état. Le RED d'acceptance reste à prouver : le code lancera les tests après ton tour.";
  return [`La porte « ${porte} » refuserait ce travail :`, ...motifs.map((m) => `- ${m}`), "Corrige, puis vérifie de nouveau."].join("\n");
}

/** L'outil `verifier_scenarios` : il ne lit que ce que l'hôte lui passe pendant le tour de l'agent d'acceptance. */
export function verifierScenariosTool(): ExtensionTool {
  return {
    name: "verifier_scenarios",
    description: "Vérifie tes scénarios, ton plan de test et tes tests d'acceptance avec les portes du code (gherkin, valeurs, plan de test). Sans argument : le code lit lui-même tes fichiers.",
    parameters: { type: "object", properties: {} },
    async handler(_args: unknown, v?: ContexteDeVerification) {
      if (!v) throw new Error("L'outil verifier_scenarios n'est pas la vérification de ce tour : il n'a rien à examiner.");
      return texteDeVerification(motifsDesScenarios({ fichiers: v.fichiers, ...(v.donnees as DonneesDesScenarios) }));
    },
  };
}
