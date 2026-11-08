// Converti en JavaScript le 2026-10-10 depuis extensions/skraft-workflow/src/brief.ts (ADR 0055).
/**
* Dossier de passation (SPEC.md §6.6) : construit par le code à partir des phases réellement
* exécutées ; jamais de transcription. Pur.
*/
import { ARCHITECTURE_PAR_DEFAUT, ligneArchitecture } from "./architecture.mjs";

export function buildBrief(d, phase, rejet) {
  const lines = [`Story : ${d.story.id} — ${d.story.title}`, d.story.statement, "Critères d'acceptation :"];
  for (const c of d.story.criteria)
    lines.push(`  ${c.n}. ${c.text}`);
  lines.push(`Difficulté : ${d.niveau}`);
  lines.push(`Dossier de travail : .skraft/${d.slug}/`);
  lines.push(`Phase en cours : ${phase}`);
  if (d.phasesFaites.length)
    lines.push("Phases terminées :", ...d.phasesFaites.map((p) => `  - ${p.phase}${p.fichiers.length ? ` : ${p.fichiers.join(", ")}` : ""}`));
  if (d.phasesSautees.length)
    lines.push(`Phases sautées : ${d.phasesSautees.join(", ")}`);
  // Skill d'architecture transmise à l'appel, ou la clean architecture par défaut.
  if (phase === "DESIGN" || phase === "DISTILL" || phase === "DELIVER")
    lines.push(ligneArchitecture(d.architecture ?? ARCHITECTURE_PAR_DEFAUT));
  // La recherche validée, recopiée par le code (skraft-plugin v1.15.1 : la recherche est une entrée
  // exigée de DESIGN et DISTILL) : l'agent la reçoit, qu'il pense ou non à ouvrir le fichier.
  if (phase === "DESIGN" || phase === "DISTILL") {
    const r = d.recherche;
    if (r && (r.conventions || r.existant))
      lines.push(
        "Recherche (acquise : cite-la plutôt que de refaire l'enquête) :",
        ...(r.conventions ? ["  Conventions du projet :", ...extrait(r.conventions)] : []),
        ...(r.existant ? ["  Existant réutilisable :", ...extrait(r.existant)] : []),
      );
    else if (d.phasesSautees.includes("RESEARCH"))
      lines.push("RESEARCH a été sautée : aucun inventaire de l'existant. Relève toi-même, dans le code, les conventions et ce qui peut être réutilisé.");
  }
  const decides = d.adrs.filter((a) => a.status !== "Proposed");
  if (decides.length)
    lines.push("ADR décidés :", ...decides.map((a) => `  - ${a.id} (${a.status}) : ${a.path}`));
  const repondues = reponsesDeLUtilisateur(d);
  if (repondues.length)
    lines.push(`Réponses de l'utilisateur (écrites dans \`${fichierDePassation(d.slug)}\`, à citer comme source) :`, ...repondues.map((a) => `  - ${a.question} → ${a.answer}`));
  if (d.regressions.length)
    lines.push("Tests d'acceptance requalifiés en non-régression :", ...d.regressions.map((r) => `  - ${r}`));
  if (d.acceptanceHash)
    lines.push("Les tests d'acceptance sont gelés : ne les modifie jamais.");
  if (d.livres?.length)
    lines.push(`Scénarios livrés : ${d.livres.join(", ")}`);
  if (d.constats?.length)
    lines.push("Constats de DELIVER :", ...d.constats.map((n) => `  - ${n}`));
  if (rejet.length)
    lines.push("Rejet précédent :", ...rejet.map((f) => `  - ${f}`));
  return lines.join("\n");
}
/** Texte recopié dans le dossier, indenté et borné : une recherche bavarde ne noie pas le reste. */
function extrait(texte) {
  const t = texte.length > 2000 ? `${texte.slice(0, 2000)}…` : texte;
  return t.split("\n").map((l) => `    ${l}`);
}

/** Pile du projet, tirée de l'adaptateur de pile qui fait autorité (docs/15 §5) : une seule ligne commune. */
export function lignePile(id, layout) {
  return `Pile du projet : ${id} ; sources : ${layout.sources.join(", ")} ; tests unitaires : ${layout.unitTests.join(", ")} ; tests d'acceptance : ${layout.acceptanceTests.join(", ")}.`;
}
/** Consigne BDD (ADR 0074) : où écrire le `.feature` et ses étapes, et la règle du titre ; vide sans BDD. */
export function ligneBdd(bdd) {
  return (bdd ?? []).map((c) => `BDD (ADR 0074) : les scénarios Gherkin sont les tests d'acceptance du projet. Écris le \`.feature\` dans ${c.features} (et non dans \`.skraft/\`), et ses définitions d'étapes dans ${c.etapes} (lanceur : ${c.lanceur}). Le titre de chaque scénario commence par son critère : « Scénario: AC-1 … » pour \`@ac-1\`.`).join("\n");
}
/**
* Réponses humaines citables (décidé le 07/11) : sans fichier, une réponse n'arrivait que par le
* prompt, et la porte `citations` refusait qu'on s'y réfère ; le 29/09, l'agent avait reposé cinq fois
* la même question. Le code écrit ce fichier avant chaque tour d'agent ; les portes de DELIVER ne le
* comptent pas parmi les fichiers modifiés par l'agent.
*/
export const fichierDePassation = (slug) => `.skraft/${slug}/passation.md`;
/** Questions ouvertes répondues, puis réponses aux questions des agents, dans l'ordre. */
export function reponsesDeLUtilisateur(d) {
  return [...d.questions.filter((q) => q.answer).map((q) => ({ question: q.text, answer: q.answer })), ...d.reponses];
}
/** Contenu de `passation.md` : une réponse par ligne, pour qu'une citation `passation.md:<ligne>` la désigne. */
export function passationMd(storyId, reponses) {
  const ligne = (t) => t.replace(/\s*\n\s*/g, " ");
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
export async function ecrirePassation(w, d) {
  const reponses = reponsesDeLUtilisateur(d);
  if (reponses.length)
    await w.ecrireFichier(fichierDePassation(d.slug), passationMd(d.story?.id ?? d.slug, reponses));
}
