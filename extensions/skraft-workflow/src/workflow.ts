/**
 * skraft écrit en workflow rejouable (ADR 0052, `docs/09` §14 étape 4). Extension indépendante de
 * `extensions/skraft` : elle n'en importe rien, et `/skraft` reste intacte.
 *
 * Commande `/skraft-workflow` : pour l'instant la préparation, la difficulté, RESEARCH, les
 * questions ouvertes et DESIGN, puis arrêt avec le dossier de passation de DISTILL. Le comportement reproduit
 * celui du réducteur de skraft. Si le script n'est pas nettement plus simple que la partie du
 * réducteur qu'il remplace, on s'arrête là (ADR 0052, conséquences).
 */
import { createWorkflowTask, essayer, PanneEnvironnement, Escalade, TourInterrompu, type Profil, type W } from "@agent-studio/workflow";
import { buildBrief, type Dossier } from "./brief.js";
import { computeIndicators, DEFAULT_THRESHOLDS, gradeDifficulty, isDifficulty, levelEffects, shift, type Difficulty } from "./difficulty.js";
import { preselectFiles } from "./preselect.js";
import { checkResearch } from "./research.js";
import { parseStory, slugOf, type Story } from "./story.js";
import { concevoir } from "./conception.js";
import { commitMessage, creerDossiers, GELÉS, LEVEL_LABELS, repositoryShape } from "./support.js";

export interface EntreeWorkflow {
  storyPath: string;
  confirmDifficulty: boolean;
}

/** Qui répond à quoi (§11). Vide : tout profil. */
const HUMAINS: Record<string, readonly Profil[]> = {
  "confirmer-difficulte": [],
  "question-ouverte": ["po", "developpeur", "architecte", "administrateur"],
  blocage: ["po", "developpeur", "architecte", "administrateur"],
  escalade: ["developpeur", "architecte", "administrateur"],
  arbitrer: ["developpeur", "architecte", "administrateur"],
  "ratifier-adr": ["architecte"],
};

const RELANCER_OU_ABANDONNER = [
  { id: "relancer", label: "Relancer" },
  { id: "abandonner", label: "Abandonner" },
];

async function skraft(w: W, entree: EntreeWorkflow) {
  const { story, slug, indicateurs } = await preparer(w, entree.storyPath);
  const niveau = await evaluerDifficulte(w, story, indicateurs, entree.confirmDifficulty);
  const effets = levelEffects(niveau);

  // Ce que le dossier de passation raconte, tenu à jour au fil du script.
  const vue: Dossier = {
    story,
    slug,
    niveau,
    phasesFaites: [],
    phasesSautees: effets.skipResearch ? ["RESEARCH"] : [],
    questions: story.openQuestions.map((text, i) => ({ id: `q${i + 1}`, text })),
    reponses: [],
    adrs: [],
  };

  if (!effets.skipResearch) {
    // `w.phase` rend `undefined` si l'humain saute la phase : la fonction rend donc une valeur.
    const faite = await w.phase("RESEARCH", async () => (await rechercher(w, vue, effets.maxAttempts), true), {
      commit: commitMessage("RESEARCH", slug),
      // Git ne suit pas les dossiers vides : le rembobinage les emporte (ADR 0037).
      apresRembobinage: () => creerDossiers(w, slug),
    });
    if (faite === undefined) vue.phasesSautees = [...vue.phasesSautees, "RESEARCH"];
    else vue.phasesFaites = [{ phase: "RESEARCH", fichiers: [`.skraft/${slug}/research/research.md`] }];
  }

  // Les questions ouvertes (story, recherche) sont tranchées avant DESIGN, toutes à la fois.
  const reponses = await Promise.all(
    vue.questions.map((q) =>
      w.humain("question-ouverte", `Question ouverte (${story.id})`, [{ id: "answer", label: "Répondre" }, { id: "defer", label: "Reporter" }], { detail: q.text, texteLibre: true }),
    ),
  );
  vue.questions = vue.questions.map((q, i) => {
    const d = reponses[i]!;
    return { ...q, answer: d.decision === "defer" ? "(question reportée par l'utilisateur)" : d.commentaire?.trim() || "(réponse vide)" };
  });

  if (await concevoir(w, vue, effets.lenses, effets.maxAttempts)) vue.phasesFaites = [...vue.phasesFaites, { phase: "DESIGN", fichiers: [] }];
  else vue.phasesSautees = [...vue.phasesSautees, "DESIGN"];

  await w.informer(`**${story.id}** prête pour DISTILL. Dossier de passation :\n\n${buildBrief(vue, "DISTILL", [])}`);
  return { slug, niveau };
}

/** Lecture de la story, branche et arborescence (effet `init` du réducteur). */
async function preparer(w: W, chemin: string) {
  for (;;) {
    let motifs: string[];
    try {
      const lue = parseStory(await w.lireFichier(chemin));
      if (lue.ok) {
        const slug = slugOf(lue.story.id);
        await w.brancher(`skraft/${slug}`);
        await creerDossiers(w, slug);
        const indicateurs = computeIndicators(lue.story, repositoryShape(await w.listerFichiers()));
        return { story: lue.story, slug, indicateurs };
      }
      motifs = lue.errors;
    } catch (e) {
      motifs = [e instanceof PanneEnvironnement ? `Panne d'environnement : ${e.message}` : `Story introuvable : ${chemin}`];
    }
    await relancerOuAbandonner(w, `Story invalide : ${motifs.join(" ; ")}`);
  }
}

/** Classifieur, budget compté par le code (D24), puis confirmation humaine si demandée. */
async function evaluerDifficulte(w: W, story: Story, indicateurs: ReturnType<typeof computeIndicators>, confirmer: boolean): Promise<Difficulty> {
  const grille = gradeDifficulty(indicateurs, DEFAULT_THRESHOLDS);
  const consigne = [`Story : ${story.id} — ${story.title}`, `Indicateurs : ${JSON.stringify(indicateurs)}`, `Niveau proposé par la grille : ${grille}`].join("\n");
  let propose: { level: Difficulty; justification: string } | undefined;
  for (;;) {
    try {
      await essayer(w, { max: 3 }, async () => {
        const r = await w.agent<{ level: string; justification: string }>("skraft-classifier", consigne);
        if (!r.sortie) return [`Blocage inattendu : ${r.blocage.question}`];
        if (!isDifficulty(r.sortie.level)) return [`Niveau de difficulté inconnu : ${r.sortie.level}`];
        propose = { level: r.sortie.level, justification: r.sortie.justification };
        return [];
      });
      break;
    } catch (e) {
      if (!(e instanceof Escalade || e instanceof PanneEnvironnement)) throw e;
      await relancerOuAbandonner(w, e.message);
    }
  }
  if (!confirmer) return propose!.level;
  const niveaux = [...new Set([propose!.level, shift(propose!.level, 1), shift(propose!.level, -1)])];
  const d = await w.humain(
    "confirmer-difficulte",
    `Difficulté de ${story.id} : ${LEVEL_LABELS[propose!.level]} ?`,
    niveaux.map((l) => ({ id: l, label: l === propose!.level ? `Confirmer : ${LEVEL_LABELS[l]}` : LEVEL_LABELS[l] })),
    { detail: propose!.justification },
  );
  return isDifficulty(d.decision) ? d.decision : propose!.level;
}

/** Un essai de RESEARCH : le chercheur, ses questions bloquantes, puis la porte citations (§7.1). */
function rechercher(w: W, vue: Dossier, max: number) {
  return essayer(w, { max }, async (motifs) => {
    let retour = motifs;
    for (;;) {
      const fichiers = await w.listerFichiers();
      const utiles = preselectFiles(vue.story, fichiers);
      const consigne = buildBrief(vue, "RESEARCH", retour) + (utiles.length ? `\nFichiers utiles (présélection) :\n${utiles.map((f) => `  - ${f}`).join("\n")}` : "");
      const r = await w.agent("skraft-researcher", consigne, { lectureSeule: GELÉS });
      if (r.sortie) break;
      // Question bloquante (D31) : l'humain répond, l'agent repart avec la réponse dans son dossier.
      const choix = r.blocage.choix.length ? r.blocage.choix : ["Répondre"];
      const d = await w.humain("blocage", "Question de l'agent (RESEARCH)", choix.map((c) => ({ id: c, label: c })), { detail: r.blocage.question });
      vue.reponses = [...vue.reponses, { question: r.blocage.question, answer: d.commentaire ? `${d.decision} (${d.commentaire})` : d.decision }];
      retour = [];
    }
    return porteCitations(w, vue);
  });
}

async function porteCitations(w: W, vue: Dossier): Promise<string[]> {
  const chemin = `.skraft/${vue.slug}/research/research.md`;
  let md: string;
  try {
    md = await w.lireFichier(chemin);
  } catch (e) {
    if (e instanceof PanneEnvironnement || e instanceof TourInterrompu) throw e;
    return [`Document de recherche absent : ${chemin}`];
  }
  const existants = new Set(await w.listerFichiers());
  const lignes = new Map<string, number>();
  for (const cite of new Set([...md.matchAll(/[\w./-]+\.[A-Za-z][A-Za-z0-9]{0,9}/g)].map((m) => m[0])))
    if (existants.has(cite)) lignes.set(cite, (await w.lireFichier(cite)).replace(/\n$/, "").split("\n").length);
  const { reasons, openQuestions } = checkResearch(md, { lineCount: (p) => lignes.get(p) ?? null });
  if (reasons.length) return reasons;
  const connues = new Set(vue.questions.map((q) => q.text));
  const nouvelles = openQuestions.filter((q) => !connues.has(q));
  vue.questions = [...vue.questions, ...nouvelles.map((text, i) => ({ id: `q${vue.questions.length + i + 1}`, text }))];
  return [];
}


async function relancerOuAbandonner(w: W, motif: string): Promise<void> {
  const d = await w.humain("escalade", "Pipeline skraft bloqué", RELANCER_OU_ABANDONNER, { detail: motif });
  if (d.decision !== "relancer") w.echec(`Abandon : ${motif}`);
}

export const skraftWorkflowTask = createWorkflowTask<EntreeWorkflow>({ nom: "skraft-workflow", script: skraft, humains: HUMAINS });
