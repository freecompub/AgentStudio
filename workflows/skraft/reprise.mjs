/**
 * Reprise d'une story (ADR 0089). À chaque phase approuvée, le code note dans `.skraft/<slug>/etat.json`
 * ce que les phases suivantes reçoivent ; le fichier est commité avec la phase. Relancée sur la même
 * story, la tâche le relit et propose de continuer la session ou d'en ouvrir une nouvelle, qui écrase
 * la précédente. Les fonctions de ce module sont pures, sauf `noterLEtat` et `proposerLaReprise`.
 */
import { commitMessage } from "./support.mjs";

const VERSION = 1;
const ORDRE = ["RESEARCH", "DESIGN", "DISTILL", "DELIVER"];

/** Ce que les phases suivantes reçoivent, tel que le dossier de passation le construit. */
const CHAMPS = [
  "niveau", "architecture", "phasesSautees", "questions", "reponses", "recherche", "adrs", "regressions",
  "acceptanceHash", "testsAvant", "testsDeLaStory", "planDeTest", "derogations", "derogationsCouverture",
  "testsObsoletes", "ecartsAuPlan", "nonCommitees", "verifications", "notesHorsChangement",
];

export const cheminDeLEtat = (slug) => `.skraft/${slug}/etat.json`;

/** L'état après l'approbation de `phase`. */
export function etatApresPhase(vue, phase) {
  const champs = Object.fromEntries(CHAMPS.filter((c) => vue[c] !== undefined).map((c) => [c, vue[c]]));
  return JSON.parse(JSON.stringify({
    version: VERSION,
    story: { id: vue.story.id, title: vue.story.title },
    slug: vue.slug,
    base: vue.base ?? null,
    phases: [...vue.phasesFaites.map((p) => p.phase), phase],
    ...champs,
    // Les erreurs déjà commises et les leçons déjà données : le bilan et le registre de la story les comptent.
    erreurs: vue.registre?.erreurs ?? [],
    injectees: vue.injectees ?? [],
  }));
}

/** L'état relu, ou `null` s'il est illisible, d'une autre version, d'une autre story ou d'un autre slug. */
export function lireEtat(texte, story, slug) {
  let e;
  try {
    e = JSON.parse(texte);
  } catch {
    return null;
  }
  if (!e || e.version !== VERSION || e.slug !== slug || e.story?.id !== story.id || e.story?.title !== story.title || !Array.isArray(e.phases)) return null;
  return e;
}

/** Restaure l'état dans la vue d'un run neuf. */
export function restaurer(vue, etat) {
  for (const c of CHAMPS) if (etat[c] !== undefined) vue[c] = etat[c];
  if (etat.base) vue.base = etat.base;
  vue.phasesFaites = etat.phases.map((phase) => ({ phase, fichiers: phase === "RESEARCH" ? [`.skraft/${etat.slug}/research/research.md`] : [] }));
  if (vue.registre) vue.registre.erreurs = [...etat.erreurs];
  vue.injectees = [...(etat.injectees ?? [])];
  vue.reprise = { phases: [...etat.phases] };
}

/**
 * Le relevé des tests au départ d'une session continuée : les tests d'acceptance de la story, rouges
 * en attendant DELIVER, sont mis à part, et la sortie en erreur qu'ils causent avec eux. Un autre test
 * rouge reste un problème.
 */
export function releveDeDepart(run, etat) {
  const ids = etat?.testsDeLaStory;
  if (!ids?.length) return run;
  const results = run.results.filter((r) => !ids.includes(r.id));
  const autresRouges = results.some((r) => r.status === "failed");
  return { ...run, results, exitCode: autresRouges ? run.exitCode : 0 };
}

/** Le commit de la dernière phase approuvée, le plus récent à son message ; `null` s'il manque. */
export function commitDeReprise(historique, etat) {
  const message = commitMessage(etat.phases.at(-1), etat.slug);
  return historique.find((c) => c.subject === message)?.sha ?? null;
}

const suivante = (etat) => ORDRE.find((p) => !etat.phases.includes(p) && !(etat.phasesSautees ?? []).includes(p));

/** La question posée à l'utilisateur, et ce qu'elle engage. */
export function questionDeReprise(story, etat) {
  const prochaine = suivante(etat);
  const faites = `Phases approuvées : ${etat.phases.join(", ")}.`;
  return {
    titre: `${story.id} a déjà une session : la continuer ?`,
    detail: [
      `La branche skraft/${etat.slug} porte une session précédente de cette story. ${faites}`,
      prochaine
        ? `Continuer : la session reprend à ${prochaine}, depuis le commit de ${etat.phases.at(-1)} ; ce qui avait été fait après est effacé.`
        : "Continuer : la story est déjà livrée, rien n'est refait.",
      "Nouvelle session : la branche est recréée depuis le point de départ de la première ; le travail de la session précédente est perdu.",
    ].join("\n"),
    options: [
      { id: "continuer", label: "Continuer la session précédente" },
      { id: "nouvelle", label: "Nouvelle session (écrase la précédente)" },
    ],
  };
}

/** Écrit l'état de la phase approuvée ; il sera commité avec elle. */
export async function noterLEtat(w, vue, phase) {
  await w.ecrireFichier(cheminDeLEtat(vue.slug), `${JSON.stringify(etatApresPhase(vue, phase), null, 2)}\n`);
}

/**
 * Sur la branche de la story : s'il y a une session précédente, demande quoi en faire. Rend l'état à
 * restaurer, ou `null` pour une session neuve. `base` : le commit de départ de ce run.
 */
export async function proposerLaReprise(w, story, slug, base) {
  const texte = await w.lireFichier(cheminDeLEtat(slug)).catch(() => null);
  const etat = texte === null ? null : lireEtat(texte, story, slug);
  if (!etat) return null;
  const q = questionDeReprise(story, etat);
  const choix = await w.humain("reprise", q.titre, q.options, { detail: q.detail });
  if (choix.decision === "nouvelle") {
    await w.brancher(`skraft/${slug}`, { depuis: etat.base ?? base, ecraser: true });
    return null;
  }
  const sha = commitDeReprise(await w.historique(), etat);
  if (sha) {
    const { nonSuivis } = await w.revenirA(sha);
    if (nonSuivis.length)
      await w.informer(`Reprise de ${story.id} : ces fichiers non suivis par Git sont restés en place, à vérifier : ${nonSuivis.map((f) => `\`${f}\``).join(", ")}.`);
  } else {
    await w.informer(`Reprise de ${story.id} : le commit de ${etat.phases.at(-1)} est introuvable sur la branche ; la session reprend sur son état actuel.`);
  }
  return etat;
}
