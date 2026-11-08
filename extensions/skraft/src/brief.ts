import { ARCHITECTURE_PAR_DEFAUT, ligneArchitecture } from "./architecture.js";
import type { Phase, SkraftState } from "./model.js";
import { artifactsDuRun } from "./review-brief.js";

/**
 * Dossier de passation (SPEC.md §6.6, SPEC-skraft E4) : construit par le code à partir des phases
 * réellement exécutées ; jamais de transcription. Pur.
 */
export function buildBrief(s: SkraftState, phase: Phase, feedback: string[]): string {
  const story = s.story;
  const lines: string[] = [];
  if (story) {
    lines.push(`Story : ${story.id} — ${story.title}`, story.statement, "Critères d'acceptation :");
    for (const c of story.criteria) lines.push(`  ${c.n}. ${c.text}`);
  }
  lines.push(`Difficulté : ${s.difficulty?.level ?? "non évaluée"}`);
  lines.push(`Dossier de travail : .skraft/${s.slug}/`);
  lines.push(`Phase en cours : ${phase}`);
  const done = s.phasesCompleted.map((p) => {
    const files = artifactsDuRun(s, p).map((a) => a.path);
    return `  - ${p}${files.length ? ` : ${files.join(", ")}` : ""}`;
  });
  if (done.length) lines.push("Phases terminées :", ...done);
  if (s.skipPhases.length) lines.push(`Phases sautées : ${s.skipPhases.join(", ")}`);
  // Skill d'architecture transmise à l'appel, ou la clean architecture par défaut.
  if (phase === "DESIGN" || phase === "DISTILL" || phase === "DELIVER") lines.push(ligneArchitecture(s.architecture ?? ARCHITECTURE_PAR_DEFAUT));
  // La recherche validée, recopiée par le code (skraft-plugin v1.15.1 : la recherche est une entrée
  // exigée de DESIGN et DISTILL) : l'agent la reçoit, qu'il pense ou non à ouvrir le fichier.
  if (phase === "DESIGN" || phase === "DISTILL") {
    const r = s.recherche;
    if (r && (r.conventions || r.existant))
      lines.push(
        "Recherche (acquise : cite-la plutôt que de refaire l'enquête) :",
        ...(r.conventions ? ["  Conventions du projet :", ...extrait(r.conventions)] : []),
        ...(r.existant ? ["  Existant réutilisable :", ...extrait(r.existant)] : []),
      );
    else if (s.skipPhases.includes("RESEARCH"))
      lines.push("RESEARCH a été sautée : aucun inventaire de l'existant. Relève toi-même, dans le code, les conventions et ce qui peut être réutilisé.");
  }
  const decided = s.adrs.filter((a) => a.status !== "Proposed");
  if (decided.length) lines.push("ADR décidés :", ...decided.map((a) => `  - ${a.id} (${a.status}) : ${a.path}`));
  const answered = reponsesDeLUtilisateur(s);
  if (answered.length)
    lines.push(`Réponses de l'utilisateur (écrites dans \`${fichierDePassation(s.slug)}\`, à citer comme source) :`, ...answered.map((a) => `  - ${a.question} → ${a.answer}`));
  if (s.regressions.length) lines.push("Tests d'acceptance requalifiés en non-régression :", ...s.regressions.map((r) => `  - ${r}`));
  if (s.acceptanceHash) lines.push("Les tests d'acceptance sont gelés : ne les modifie jamais.");
  if (s.deliver) {
    const done = s.deliver.scenarios.filter((x) => x.status === "done").map((x) => `${x.id}${x.role === "regression" ? " (non-régression)" : ""}`);
    if (done.length) lines.push(`Scénarios livrés : ${done.join(", ")}`);
    if (s.deliver.notes.length) lines.push("Constats de DELIVER :", ...s.deliver.notes.map((n) => `  - ${n}`));
  }
  if (feedback.length) lines.push("Rejet précédent :", ...feedback.map((f) => `  - ${f}`));
  return lines.join("\n");
}

/** Texte recopié dans le dossier, indenté et borné : une recherche bavarde ne noie pas le reste. */
function extrait(texte: string): string[] {
  const t = texte.length > 2000 ? `${texte.slice(0, 2000)}…` : texte;
  return t.split("\n").map((l) => `    ${l}`);
}

/** Pile du projet, tirée de l'adaptateur de pile qui fait autorité (docs/15 §5) : une seule ligne commune. */
export function lignePile(id: string, layout: { sources: readonly string[]; unitTests: readonly string[]; acceptanceTests: readonly string[] }): string {
  return `Pile du projet : ${id} ; sources : ${layout.sources.join(", ")} ; tests unitaires : ${layout.unitTests.join(", ")} ; tests d'acceptance : ${layout.acceptanceTests.join(", ")}.`;
}

/** Consigne BDD (ADR 0074) : où écrire le `.feature` et ses étapes, et la règle du titre ; vide sans BDD. */
export function ligneBdd(bdd: readonly { lanceur: string; features: string; etapes: string }[] | undefined): string {
  return (bdd ?? []).map((c) => `BDD (ADR 0074) : les scénarios Gherkin sont les tests d'acceptance du projet. Écris le \`.feature\` dans ${c.features} (et non dans \`.skraft/\`), et ses définitions d'étapes dans ${c.etapes} (lanceur : ${c.lanceur}). Le titre de chaque scénario commence par son critère : « Scénario: AC-1 … » pour \`@ac-1\`.`).join("\n");
}

/**
 * Réponses humaines citables (décidé le 07/11) : sans fichier, une réponse n'arrivait que par le
 * prompt, et la porte `citations` refusait qu'on s'y réfère ; le 29/09, l'agent avait reposé cinq fois
 * la même question. Le code écrit ce fichier avant chaque tour d'agent ; les portes de DELIVER ne le
 * comptent pas parmi les fichiers modifiés par l'agent.
 */
export const fichierDePassation = (slug: string) => `.skraft/${slug}/passation.md`;

/** Questions ouvertes répondues, puis réponses aux questions des agents, dans l'ordre. */
export function reponsesDeLUtilisateur(s: SkraftState): { question: string; answer: string }[] {
  return [...s.openQuestions.filter((q) => q.answer).map((q) => ({ question: q.text, answer: q.answer! })), ...s.answers];
}

/** Contenu de `passation.md` : une réponse par ligne, pour qu'une citation `passation.md:<ligne>` la désigne. */
export function passationMd(storyId: string, reponses: readonly { question: string; answer: string }[]): string {
  const ligne = (t: string) => t.replace(/\s*\n\s*/g, " ");
  return [
    `# Réponses de l'utilisateur — ${storyId}`,
    "",
    "Écrites par le code au fil du run, une par ligne : cite-les comme toute autre source (`passation.md:<ligne>`).",
    "",
    ...reponses.map((r) => `- « ${ligne(r.question)} » → ${ligne(r.answer)}`),
    "",
  ].join("\n");
}

/** Écrit `passation.md` s'il y a des réponses ; contenu identique, rien ne change dans le dépôt. */
export async function ecrirePassation(ctx: { workspace: { writeFile(path: string, content: string): Promise<void> } }, s: SkraftState): Promise<void> {
  const reponses = reponsesDeLUtilisateur(s);
  if (reponses.length) await ctx.workspace.writeFile(fichierDePassation(s.slug), passationMd(s.story?.id ?? s.slug, reponses));
}
