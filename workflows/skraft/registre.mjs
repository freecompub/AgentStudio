/**
* Registre des erreurs commises (LEC-1, freecompub/AgentStudio#32) : ce que le code établit pendant un
* run, défauts de revue retenus et refus de portes, gardé dans le projet pour mesurer ce qui se répète
* d'une story à l'autre.
*
* Décisions du responsable (11/11) : le motif d'un défaut est normalisé comme pour le disjoncteur ;
* seuls les refus qui consomment un essai sont enregistrés ; un défaut que l'humain donne à l'agent à
* l'arbitrage ne l'est pas.
*
* Les fonctions du haut sont pures ; celles du bas (« Collecte et écriture ») ne touchent le disque que
* par `w`, comme le reste du script.
*/
import { normaliserMotifs } from "@agent-studio/workflow";
import { sha256 } from "./support.mjs";

/** Un fichier par story : deux stories menées en parallèle n'écrivent jamais le même. */
export const cheminDuRegistre = (slug) => `.agent-studio/lecons/brut/${slug}.jsonl`;

/** Même phase, même source (lentille ou porte), même motif normalisé : même signature. */
function signature(phase, source, motifs) {
  return sha256([phase, source, ...normaliserMotifs(motifs)].join("\n")).slice(0, 16);
}

/** Statuts d'un fil qui ne font pas une erreur : abandonné par la lentille, donné à l'agent par l'humain. */
const ABANDONNES = ["accepted", "humanAccepted"];

/** Les défauts de revue retenus : graves ou bloquants, et ni abandonnés par la lentille ni par l'humain. */
export function defautsRetenus(fils) {
  return fils.filter((f) => (f.severity === "blocker" || f.severity === "major") && !ABANDONNES.includes(f.status));
}

export function erreurDeDefaut(fil, phase, story) {
  return {
    type: "defaut",
    story,
    phase,
    lentille: fil.lens,
    cible: fil.target,
    description: fil.description,
    ...(fil.file ? { fichier: fil.file } : {}),
    ...(fil.line ? { ligne: fil.line } : {}),
    defaut: fil.id,
    signature: signature(phase, fil.lens, [fil.description]),
  };
}

export function erreurDeRefus({ porte, motifs, phase, story }) {
  return { type: "refus", story, phase, porte, motifs: normaliserMotifs(motifs), signature: signature(phase, porte, motifs) };
}

/**
* Un refus consomme-t-il un essai ? Non pour un délai (le tour est rejoué), une panne, une question de
* revue, ni pour la revue elle-même : ses défauts sont déjà enregistrés, lentille par lentille.
*/
export function refusCompte(porte) {
  const p = porte.replace(/^DELIVER : /, "");
  return !(p === "délai" || p === "question de revue" || p.startsWith("revue") || p.startsWith("panne"));
}

/**
* Le fichier : les lignes déjà écrites, telles quelles, puis les nouvelles erreurs, une par ligne. Chaque
* erreur reçoit un identifiant, la story et son rang dans le fichier : une leçon cite ses sources ainsi
* (LEC-2), et une relance continue la numérotation.
*/
export function contenuDuRegistre(avant, erreurs) {
  const deja = avant.split("\n").filter((l) => l.trim()).length;
  const lignes = erreurs.map((e, i) => JSON.stringify({ id: `${e.story}#${deja + i + 1}`, ...e }));
  if (!lignes.length)
    return avant;
  return `${avant && !avant.endsWith("\n") ? `${avant}\n` : avant}${lignes.join("\n")}\n`;
}

/** Les erreurs de tous les fichiers du registre, groupées par signature, du groupe qui touche le plus de stories au moins. */
export function regrouperParSignature(contenus) {
  const groupes = new Map();
  for (const contenu of contenus)
    for (const ligne of contenu.split("\n").filter((l) => l.trim())) {
      const e = JSON.parse(ligne);
      const g = groupes.get(e.signature) ?? { signature: e.signature, stories: new Set(), erreurs: 0 };
      g.stories.add(e.story);
      g.erreurs++;
      groupes.set(e.signature, g);
    }
  return [...groupes.values()].map((g) => ({ signature: g.signature, stories: g.stories.size, erreurs: g.erreurs })).sort((a, b) => b.stories - a.stories || b.erreurs - a.erreurs);
}

// ---------- Collecte et écriture -------------------------------------------------------------

/** Les étapes qui sont des phases : un refus est rattaché à la dernière ouverte. */
const PHASES = ["CLASSIFY", "RESEARCH", "DESIGN", "DISTILL", "DELIVER"];

/** Le registre d'un run, en mémoire : recalculé à l'identique à chaque rejeu du script. */
export function nouveauRegistre() {
  return { story: null, chemin: null, avant: "", dernierEcrit: "", phase: null, erreurs: [], modifie: false };
}

/**
* `w` qui relève les refus de porte comptés, au moment où le code les trace, et la phase en cours.
* Rien d'autre ne change : les appels passent tels quels.
*/
export function suivreLesRefus(w, registre) {
  return {
    ...w,
    etape: async (nom) => {
      if (PHASES.includes(nom))
        registre.phase = nom;
      return w.etape(nom);
    },
    rejet: async (porte, motifs) => {
      if (registre.story && refusCompte(porte))
        registre.erreurs.push(erreurDeRefus({ porte: porte.replace(/^DELIVER : /, ""), motifs, phase: registre.phase ?? "?", story: registre.story }));
      return w.rejet(porte, motifs);
    },
  };
}

/** La story est connue : le registre part de ce que le fichier contient déjà (une relance s'y ajoute). */
export async function ouvrirLeRegistre(w, registre, slug) {
  registre.story = slug;
  registre.chemin = cheminDuRegistre(slug);
  registre.avant = (await w.listerFichiers()).includes(registre.chemin) ? await w.lireFichier(registre.chemin) : "";
  registre.dernierEcrit = registre.avant;
}

/** Les défauts retenus d'une phase, relevés une seule fois chacun : à son succès, ou avant son rembobinage. */
export function releverLesDefauts(registre, suivi, phase) {
  suivi.releves ??= new Set();
  for (const f of defautsRetenus(suivi.fils)) {
    if (suivi.releves.has(f.id))
      continue;
    suivi.releves.add(f.id);
    registre.erreurs.push(erreurDeDefaut(f, phase, registre.story));
  }
}

/**
* Écrit le fichier de la story : ses lignes d'avant le run, puis les erreurs de ce run. Un fichier qui
* ne porte plus ce que le code y a écrit a été modifié hors du code : c'est dit au bilan, et le code
* le rétablit.
*/
export async function ecrireLeRegistre(w, registre, { apresRembobinage = false } = {}) {
  if (!registre.chemin)
    return;
  const contenu = contenuDuRegistre(registre.avant, registre.erreurs);
  const disque = (await w.listerFichiers()).includes(registre.chemin) ? await w.lireFichier(registre.chemin) : "";
  // Après un rembobinage, le disque est revenu au checkpoint : ce n'est pas une modification par un agent.
  if (!apresRembobinage && disque !== registre.dernierEcrit && disque !== contenu)
    registre.modifie = true;
  if (contenu === disque)
    return;
  await w.ecrireFichier(registre.chemin, contenu);
  registre.dernierEcrit = contenu;
}

/** La ligne du bilan. */
export function ligneDuRegistre(registre) {
  if (!registre.erreurs.length && !registre.modifie)
    return null;
  return [
    `Registre des erreurs : ${registre.erreurs.length} erreur(s) enregistrée(s) dans ${registre.chemin}.`,
    ...(registre.modifie ? ["Le registre a été modifié hors du code pendant le run : le code l'a rétabli."] : []),
  ].join(" ");
}
