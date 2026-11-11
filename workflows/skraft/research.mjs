// Converti en JavaScript le 2026-10-10 depuis extensions/skraft-workflow/src/research.ts (ADR 0055).
// Copie de extensions/skraft/src/research.ts (2026-10-08) : skraft-workflow est indépendante de skraft
// et n'en importe rien ; une correction de l'une ne se reporte pas seule dans l'autre.
import { parseCitations } from "./text-analysis.mjs";
/** Gabarit du document de recherche (SPEC-skraft §7.1). */
export const RESEARCH_SECTIONS = [
  "Périmètre et critères de succès",
  "Fichiers analysés",
  "Recherches effectuées",
  "Conventions du projet",
  "Découvertes",
  "Approches évaluées",
  "Recommandation",
  "Passage de relais",
];
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
function sections(md) {
  const out = new Map();
  const parts = md.split(/^##\s+(?!#)/m).slice(1);
  for (const p of parts) {
    const [title = "", ...rest] = p.split("\n");
    out.set(norm(title), rest.join("\n").trim());
  }
  return out;
}
/** Questions ouvertes du passage de relais : section « Questions ouvertes » si présente, sinon lignes interrogatives. */
export function extractOpenQuestions(md) {
  const relay = sections(md).get(norm("Passage de relais")) ?? "";
  const sub = /^###\s+Questions ouvertes\s*$([\s\S]*?)(?=^#{2,3}\s|$(?![\s\S]))/im.exec(relay);
  if (sub)
    return [...sub[1].matchAll(/^\s*[-*]\s+(.+)$/gm)].map((m) => m[1].trim()).filter(Boolean);
  return relay
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter((l) => l.endsWith("?") && !/^#/.test(l));
}
function wellFormedUrl(u) {
  try {
    const url = new URL(u);
    return (url.protocol === "https:" || url.protocol === "http:") && (url.hostname.includes(".") || url.hostname === "localhost");
  }
  catch {
    return false;
  }
}
/**
* Porte citations (code, sans reviewer LLM) : sections du gabarit, chemins cités existants, plages
* dans les limites, URL bien formées, recommandation unique. Renvoie les motifs exacts de rejet et
* les questions ouvertes à poser à l'utilisateur.
*/
/** Les chemins que cite une recherche, tels que la porte des citations les cherche. */
export function citesDansLaRecherche(md) {
  return [...new Set([...md.matchAll(/[\w./-]+\.[A-Za-z][A-Za-z0-9]{0,9}/g)].map((m) => m[0]))];
}
/**
* La porte des citations sur des contenus déjà lus (`contenus` : chemin → contenu des fichiers cités
* qui existent). La porte et l'outil `verifier_recherche` du chercheur appellent ce même calcul (ADR 0082).
*/
export function motifsDeLaRecherche(md, contenus) {
  return checkResearch(md, {
    lineCount: (p) => (contenus.has(p) ? contenus.get(p).replace(/\n$/, "").split("\n").length : null),
    contains: (p, nom) => contenus.get(p)?.includes(nom) ?? false,
  });
}
/** Réponse de l'outil `verifier_recherche` au chercheur : ce que la porte des citations dirait de son document. */
export function texteDeVerificationRecherche(reasons) {
  if (!reasons.length)
    return "Aucun motif : la porte des citations accepterait ce document en l'état.";
  return ["La porte « citations » refuserait ce document :", ...reasons.map((m) => `- ${m}`), "Corrige, puis vérifie de nouveau."].join("\n");
}
/** L'outil du chercheur : le document lu par l'hôte, les fichiers cités lus à la demande. */
export async function verifierRecherche({ fichiers, donnees, lire }) {
  const md = fichiers[donnees.chemin];
  if (md === undefined)
    return texteDeVerificationRecherche([`Document de recherche absent : ${donnees.chemin}`]);
  const contenus = new Map();
  for (const cite of citesDansLaRecherche(md)) {
    const c = await lire(cite);
    if (c !== null)
      contenus.set(cite, c);
  }
  return texteDeVerificationRecherche(motifsDeLaRecherche(md, contenus).reasons);
}
export function checkResearch(md, index) {
  const reasons = [];
  const secs = sections(md);
  for (const s of RESEARCH_SECTIONS)
    if (!secs.has(norm(s)))
      reasons.push(`Section manquante : « ${s} ».`);
  const { paths, urls } = parseCitations(md);
  for (const c of paths) {
    if (!c.path.includes("/") || c.path.startsWith(".skraft/"))
      continue; // simples noms de fichiers et livrables du pipeline
    const cited = `\`${c.path}${c.start !== undefined ? `:${c.start}${c.end !== c.start ? `-${c.end}` : ""}` : ""}\``;
    const lines = index.lineCount(c.path);
    if (lines === null) {
      reasons.push(`${cited} : fichier inexistant dans le dépôt.`);
      continue;
    }
    if (c.start === undefined || c.end === undefined)
      continue;
    if (c.end < c.start)
      reasons.push(`${cited} : plage inversée.`);
    else if (c.start < 1 || c.end > lines)
      reasons.push(`${cited} : plage hors du fichier, qui compte ${lines} lignes.`);
  }
  for (const u of urls)
    if (!wellFormedUrl(u))
      reasons.push(`URL mal formée : ${u}`);
  const reco = secs.get(norm("Recommandation"));
  if (reco !== undefined) {
    const items = [...reco.matchAll(/^\s*(?:[-*]|\d+\.)\s+\S/gm)].length;
    if (!reco.trim())
      reasons.push("La recommandation est absente.");
    else if (items > 1)
      reasons.push(`Une seule recommandation est attendue (${items} trouvées).`);
  }
  reasons.push(...inventaireDeLExistant(secs, index));
  return { reasons, openQuestions: extractOpenQuestions(md) };
}
/**
* Inventaire de l'existant (repris de skraft-plugin v1.15.1, `solution-researcher` : l'existant
* réutilisable dans « Handoff to DESIGN »). Le plugin le demande au prompt ; ici, le code vérifie
* qu'un élément inventorié existe vraiment dans le fichier qu'il cite : DESIGN et DISTILL le
* reçoivent comme acquis. Les commandes de build et de test, que v1.15.1 ajoute aussi aux
* conventions, ne sont pas reprises : l'adaptateur de pile en est l'autorité, et seul `run_tests`
* les exécute.
*/
function inventaireDeLExistant(secs, index) {
  const reasons = [];
  const relais = secs.get(norm("Passage de relais"));
  if (relais === undefined)
    return reasons;
  const existant = sousSection(relais, "Existant réutilisable");
  if (existant === null) {
    reasons.push("Passage de relais : sous-section « Existant réutilisable » absente (une ligne « `Nom` → `chemin` » par élément, ou « aucun »).");
    return reasons;
  }
  const elements = [...existant.matchAll(/`([A-Za-z_]\w*)`\s*(?:→|->)\s*`([^`]+)`/g)].map((m) => ({ nom: m[1], chemin: m[2] }));
  if (!elements.length && !/\baucun/i.test(existant))
    reasons.push("Existant réutilisable est vide : liste les éléments (« `Nom` → `chemin` »), ou écris « aucun ».");
  for (const { nom, chemin } of elements) {
    if (index.lineCount(chemin) === null)
      reasons.push(`Existant réutilisable : \`${nom}\` → \`${chemin}\` : fichier inexistant.`);
    else if (!index.contains(chemin, nom)) reasons.push(`Existant réutilisable : \`${nom}\` n'apparaît pas dans \`${chemin}\`.`);
  }
  return reasons;
}

/** Texte d'une sous-section « ### titre » d'une section, ou `null` si elle n'y est pas. */
export function sousSection(section, titre) {
  const m = new RegExp(`^###\\s+${titre}\\s*$([\\s\\S]*?)(?=^#{2,3}\\s|$(?![\\s\\S]))`, "im").exec(section);
  return m ? m[1].trim() : null;
}

/** Ce que DESIGN et DISTILL reçoivent de la recherche validée : conventions et existant réutilisable. */
export function extraireInventaire(md) {
  const secs = sections(md);
  return { conventions: secs.get(norm("Conventions du projet")) ?? "", existant: sousSection(secs.get(norm("Passage de relais")) ?? "", "Existant réutilisable") ?? "" };
}
