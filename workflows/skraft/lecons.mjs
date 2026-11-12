/**
* Leçons tirées des erreurs répétées (LEC-2, freecompub/AgentStudio#33). L'agent de classement rattache
* chaque groupe d'erreurs du registre (LEC-1) à une entrée d'un catalogue d'anti-patrons ; le code
* vérifie sa proposition, choisit le rôle qui recevra la leçon, et tient son statut. Pur.
*
* Classer plutôt que généraliser : rattacher une erreur à une entrée de catalogue se vérifie, une règle
* inventée librement dérive vers des platitudes.
*
* Les fonctions du haut sont pures ; celles du bas (« Fin de run ») ne touchent le disque que par `w`.
*/
import { TourInterrompu } from "@agent-studio/workflow";
import { CATALOGUES } from "./catalogues.mjs";

/** Le fichier des leçons, écrit seulement par le code. */
export const FICHIER_DES_LECONS = ".agent-studio/lecons/lecons.jsonl";
/** L'ordre des stories, pour compter celles qui passent sans nouvelle occurrence d'une leçon. */
export const FICHIER_DES_STORIES = ".agent-studio/lecons/stories.jsonl";
/** Une leçon validée qui ne revient pas pendant autant de stories consécutives est retirée. */
const STORIES_AVANT_RETRAIT = 10;
/** Une leçon est validée quand ses erreurs couvrent au moins autant de stories distinctes. */
const STORIES_POUR_VALIDER = 2;

/** Ce que le code refuse d'une leçon proposée : référence de catalogue, sources, exemple (critères 3 à 5). */
export function verifierLecon(lecon, erreurs) {
  const motifs = [];
  const g = lecon.groupe;
  const c = lecon.catalogue;
  if (c.nouvelle) {
    if (!CATALOGUES[c.nouvelle.skill])
      motifs.push(`${g} : ${c.nouvelle.skill} n'est pas un catalogue connu (${Object.keys(CATALOGUES).join(", ")}).`);
  }
  else if (!CATALOGUES[c.skill])
    motifs.push(`${g} : ${c.skill} n'est pas un catalogue connu (${Object.keys(CATALOGUES).join(", ")}).`);
  else if (!CATALOGUES[c.skill].includes(c.section))
    motifs.push(`${g} : « ${c.section} » n'est pas une section de ${c.skill}.`);
  const parId = new Map(erreurs.map((e) => [e.id, e]));
  for (const s of lecon.sources) {
    const e = parId.get(s);
    if (!e)
      motifs.push(`${g} : la source ${s} n'existe pas dans le registre.`);
    else if (e.signature !== g)
      motifs.push(`${g} : la source ${s} n'appartient pas à ce groupe d'erreurs.`);
  }
  if (!lecon.sources.includes(lecon.exemple))
    motifs.push(`${g} : l'exemple ${lecon.exemple} n'est pas une de ses sources.`);
  return motifs;
}

/** L'agent qui produit un livrable de chaque phase : il reçoit les leçons de ce livrable. */
const AGENT_DE_LA_PHASE = { CLASSIFY: "skraft-classifier", RESEARCH: "skraft-researcher", DESIGN: "skraft-architect-decide", DISTILL: "skraft-acceptance", DELIVER: "skraft-dev" };

/** Le rôle qui corrige les erreurs d'une leçon, tiré de leur cible (critère 6) : un refus va à l'agent de sa phase. */
export function roleDeLecon(erreurs) {
  const e = erreurs[0];
  if (e.cible === "test")
    return "skraft-test";
  if (e.cible === "code")
    return "skraft-dev";
  return AGENT_DE_LA_PHASE[e.phase] ?? "skraft-dev";
}

/** Le statut d'une leçon, recalculé à chaque run (critères 7 à 10). Une leçon retirée le reste. */
function statut(lecon, erreurs, stories) {
  if (lecon.statut === "retiree")
    return "retiree";
  if (lecon.catalogue.nouvelle && !lecon.ratifiee)
    return "candidate";
  const touchees = new Set(erreurs.map((e) => e.story));
  if (touchees.size < STORIES_POUR_VALIDER)
    return "candidate";
  const derniere = Math.max(...[...touchees].map((s) => stories.indexOf(s)));
  return stories.length - 1 - derniere >= STORIES_AVANT_RETRAIT ? "retiree" : "validee";
}

/**
* Les leçons après un run : les existantes prennent les nouvelles erreurs de leur groupe et leur statut
* est recalculé ; une leçon proposée pour un groupe sans leçon est ajoutée, candidate. `stories` : les
* stories dans l'ordre de leurs runs.
*/
export function mettreAJourLesLecons({ lecons, erreurs, stories, proposees, recidives = new Map() }) {
  const duGroupe = (g) => erreurs.filter((e) => e.signature === g);
  const couverts = new Set(lecons.map((l) => l.groupe));
  let rang = Math.max(0, ...lecons.map((l) => Number(/^L-(\d+)$/.exec(l.id)?.[1] ?? 0)));
  const ajoutees = [];
  for (const p of proposees) {
    if (couverts.has(p.groupe) || !duGroupe(p.groupe).length)
      continue;
    couverts.add(p.groupe);
    rang++;
    const src = duGroupe(p.groupe);
    ajoutees.push({ id: `L-${String(rang).padStart(2, "0")}`, groupe: p.groupe, regle: p.regle, quand: p.quand, aFaire: p.aFaire, exemple: p.exemple, catalogue: p.catalogue, role: roleDeLecon(src), phase: src[0].phase, sources: [], statut: "candidate" });
  }
  return [...lecons, ...ajoutees].map((l) => {
    const src = duGroupe(l.groupe);
    const recidive = (l.recidivesMalgreLecon ?? 0) + (recidives.get(l.id) ?? 0);
    return { ...l, sources: src.map((e) => e.id), statut: statut(l, src, stories), ...(recidive ? { recidivesMalgreLecon: recidive } : {}) };
  });
}

// ---------- Réinjection (LEC-3) ---------------------------------------------------------------

/** Au plus autant de leçons par section, et autant de caractères : un rappel, pas une consigne de plus. */
const LECONS_PAR_SECTION = 6;
const CARACTERES_PAR_SECTION = 2000;
/** Un exemple réel est cité, borné : la leçon compte, pas le détail de l'occurrence. */
const CARACTERES_PAR_EXEMPLE = 200;

/**
* Les leçons validées, classées par nombre de stories touchées puis par dernière occurrence. Le
* registre ne date pas les erreurs : la dernière occurrence est le rang, dans l'ordre des runs, de
* la dernière story touchée (choix provisoire, LEC-3).
*/
function classees(lecons, erreurs, stories) {
  const mesure = (l) => {
    const touchees = new Set(erreurs.filter((e) => e.signature === l.groupe).map((e) => e.story));
    return { touchees: touchees.size, derniere: Math.max(-1, ...[...touchees].map((s) => stories.indexOf(s))) };
  };
  return lecons
    .filter((l) => l.statut === "validee")
    .map((l) => ({ l, ...mesure(l) }))
    .sort((a, b) => b.touchees - a.touchees || b.derniere - a.derniere)
    .map((x) => x.l);
}

const reference = (c) => (c.nouvelle ? `${c.nouvelle.skill}, nouvelle entrée « ${c.nouvelle.titre} »` : `${c.skill} § ${c.section}`);

function exempleDe(l, erreurs) {
  const e = erreurs.find((x) => x.id === l.exemple);
  if (!e)
    return null;
  const t = texteDe(e);
  return `${e.story}, ${t.length > CARACTERES_PAR_EXEMPLE ? `${t.slice(0, CARACTERES_PAR_EXEMPLE)}…` : t}`;
}

/** Les lignes retenues sous un titre, en ôtant les dernières leçons tant que la section est trop longue. */
function borne(titre, blocs, fin = []) {
  let retenus = blocs.slice(0, LECONS_PAR_SECTION);
  const texte = (b) => [titre, ...b.map((x) => x.texte), ...fin].join("\n");
  while (retenus.length && texte(retenus).length > CARACTERES_PAR_SECTION)
    retenus = retenus.slice(0, -1);
  return retenus.length ? { texte: texte(retenus), ids: retenus.map((x) => x.id) } : null;
}

/**
* La section du dossier de passation d'un agent (critères 1 à 5) : les leçons validées de sa phase et
* de son rôle. `null` s'il n'y en a aucune : pas de section vide.
*/
export function sectionDesLecons({ lecons, erreurs, stories, phase, role }) {
  const blocs = classees(lecons.filter((l) => l.phase === phase && l.role === role), erreurs, stories).map((l) => {
    const exemple = exempleDe(l, erreurs);
    return { id: l.id, texte: [`  - [${l.id}] ${l.regle} (${reference(l.catalogue)})`, `    Quand : ${l.quand}`, `    À faire : ${l.aFaire}`, ...(exemple ? [`    Déjà vu : ${/[.!?…]$/.test(exemple) ? exemple : `${exemple}.`}`] : [])].join("\n") };
  });
  return borne(`Erreurs déjà commises en ${phase} sur ce projet (à éviter) :`, blocs);
}

/** Le dossier d'une lentille (critère 6) : les leçons validées de la phase, tous rôles, puis la consigne. */
export function vigilanceDesLecons({ lecons, erreurs, stories, phase }) {
  const blocs = classees(lecons.filter((l) => l.phase === phase), erreurs, stories).map((l) => ({ id: l.id, texte: `  - [${l.id}] ${l.regle} (${reference(l.catalogue)})` }));
  return borne("Points de vigilance connus :", blocs, ["Cette liste ne remplace pas ton examen général : juge tout le livrable, pas seulement ces points."]);
}

/**
* Récidives malgré une leçon (critère 8) : une erreur établie pendant ce run qui a la signature d'une
* leçon injectée dans un dossier de la même phase. Seules les erreurs du run comptent : celles d'un run
* précédent de la même story, restées dans le registre, ne sont pas des récidives. `injectees` :
* `[{ phase, ids }]`, une entrée par dossier.
*/
export function recidivesMalgreLecons({ lecons, erreursDuRun, injectees }) {
  const r = new Map();
  for (const l of lecons) {
    const phases = new Set(injectees.filter((x) => x.ids.includes(l.id)).map((x) => x.phase));
    if ([...phases].some((p) => erreursDuRun.some((e) => e.signature === l.groupe && e.phase === p)))
      r.set(l.id, 1);
  }
  return r;
}

/** Une leçon qui ne suffit pas : à signaler comme candidate à devenir une porte de code (critère 9). */
const RECIDIVES_POUR_UNE_PORTE = 2;
export function ligneDesRecidives(lecons) {
  const ids = lecons.filter((l) => (l.recidivesMalgreLecon ?? 0) >= RECIDIVES_POUR_UNE_PORTE).map((l) => l.id);
  return ids.length ? `Leçons qui n'ont pas suffi (au moins ${RECIDIVES_POUR_UNE_PORTE} récidives) : ${ids.join(", ")}, candidate${ids.length > 1 ? "s" : ""} à devenir une porte de code.` : null;
}

/** Les lignes d'un fichier JSONL, parsées ; les lignes vides sont ignorées. */
export const lireJsonl = (texte) => texte.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
/** Un fichier JSONL, une valeur par ligne. */
export const ecrireJsonl = (valeurs) => (valeurs.length ? `${valeurs.map((v) => JSON.stringify(v)).join("\n")}\n` : "");

// ---------- Fin de run -----------------------------------------------------------------------

/** Les fichiers du registre des erreurs (LEC-1), un par story. */
const FICHIER_BRUT = /^\.agent-studio\/lecons\/brut\/[^/]+\.jsonl$/;
/** Au plus autant d'erreurs montrées par groupe : l'agent classe un genre d'erreur, pas chaque occurrence. */
const ERREURS_MONTREES = 5;
/** Un groupe refusé est reproposé une fois, avec ses motifs ; au-delà, il attendra le run suivant. */
const TOURS_DE_CLASSEMENT = 2;

const texteDe = (e) => (e.type === "defaut" ? e.description : e.motifs.join(" ; "));
const sourceDe = (e) => (e.type === "defaut" ? `lentille ${e.lentille}` : `porte « ${e.porte} »`);

/** Le dossier de passation de l'agent de classement : les groupes, les catalogues, le rejet précédent. */
export function briefDuClassement(slug, groupes, motifs = []) {
  const lignes = [`Story : ${slug}`, "Groupes d'erreurs à classer, une leçon par groupe :"];
  for (const g of groupes) {
    const e0 = g.erreurs[0];
    const stories = new Set(g.erreurs.map((e) => e.story)).size;
    lignes.push(`Groupe ${g.signature} : ${g.erreurs.length} erreur(s) dans ${stories} story(ies), phase ${e0.phase}, ${sourceDe(e0)}.`);
    for (const e of g.erreurs.slice(0, ERREURS_MONTREES))
      lignes.push(`  - ${e.id} (${e.story}) : ${texteDe(e)}`);
    lignes.push(`  Sources : ${g.erreurs.map((e) => e.id).join(", ")}`);
  }
  lignes.push("Catalogues et leurs sections (recopie le chemin et le titre à l'identique) :");
  for (const [chemin, titres] of Object.entries(CATALOGUES))
    lignes.push(`- ${chemin} :`, ...titres.map((t) => `  - ${t}`));
  if (motifs.length)
    lignes.push("Rejet précédent :", ...motifs.map((m) => `  - ${m}`));
  return lignes.join("\n");
}

/**
* À la fin d'un run (LEC-2) : les groupes d'erreurs que la story a touchés et qui n'ont pas encore de
* leçon sont classés par l'agent, sa proposition vérifiée par le code ; puis toutes les leçons sont
* recalculées et commitées. Un classement qui échoue ne fait pas échouer le run : le groupe attend le
* run suivant.
*/
/** Le registre, les leçons et l'ordre des stories du projet, tels que le disque les porte. */
async function lireLaMemoire(w) {
  const fichiers = await w.listerFichiers();
  const lire = async (p) => (fichiers.includes(p) ? w.lireFichier(p) : "");
  const erreurs = [];
  for (const p of fichiers.filter((f) => FICHIER_BRUT.test(f)).sort())
    erreurs.push(...lireJsonl(await w.lireFichier(p)));
  const avantLecons = await lire(FICHIER_DES_LECONS);
  const avantStories = await lire(FICHIER_DES_STORIES);
  return { erreurs, avantLecons, avantStories, lecons: lireJsonl(avantLecons), stories: lireJsonl(avantStories).map((x) => x.story) };
}

/** Au début du run (LEC-3) : ce que les dossiers de passation citeront. */
export async function chargerLaMemoire(w) {
  const { erreurs, lecons, stories } = await lireLaMemoire(w);
  return { erreurs, lecons, stories };
}

/**
* La section d'un dossier de passation (LEC-3) : les leçons du rôle pour la phase, notées comme
* injectées (critère 7). `null` si le run n'a pas de mémoire ou s'il n'y a pas de leçon.
*/
export function leconsPour(d, phase, role) {
  if (!d.memoire)
    return null;
  const s = role === "lentilles" ? vigilanceDesLecons({ ...d.memoire, phase }) : sectionDesLecons({ ...d.memoire, phase, role });
  if (s)
    (d.injectees ??= []).push({ phase, role, ids: s.ids });
  return s;
}

export async function tirerLesLecons(w, slug, injectees = [], erreursDuRun = []) {
  const { erreurs, avantLecons, avantStories, lecons, stories } = await lireLaMemoire(w);
  if (!stories.includes(slug))
    stories.push(slug);
  const couverts = new Set(lecons.map((l) => l.groupe));
  let restants = [...new Set(erreurs.filter((e) => e.story === slug && !couverts.has(e.signature)).map((e) => e.signature))].map((signature) => ({ signature, erreurs: erreurs.filter((e) => e.signature === signature) }));
  const proposees = [];
  if (restants.length) {
    await w.etape("LECONS");
    let motifs = [];
    for (let tour = 1; tour <= TOURS_DE_CLASSEMENT && restants.length; tour++) {
      let recues = [];
      try {
        recues = (await w.agent("skraft-lecons", briefDuClassement(slug, restants, motifs))).sortie?.lecons ?? [];
      }
      catch (e) {
        if (!(e instanceof TourInterrompu))
          throw e;
      }
      motifs = [];
      const encore = [];
      for (const g of restants) {
        const l = recues.find((x) => x.groupe === g.signature);
        const refus = l ? verifierLecon(l, erreurs) : [`${g.signature} : aucune leçon rendue pour ce groupe.`];
        if (refus.length) {
          motifs.push(...refus);
          encore.push(g);
        }
        else
          proposees.push(l);
      }
      restants = encore;
    }
  }
  // Récidives malgré une leçon donnée pendant ce run (LEC-3, critère 8).
  const recidives = recidivesMalgreLecons({ lecons, erreursDuRun, injectees });
  const apres = mettreAJourLesLecons({ lecons, erreurs, stories, proposees, recidives });
  const ecrits = [];
  for (const [chemin, contenu, avant] of [[FICHIER_DES_LECONS, ecrireJsonl(apres), avantLecons], [FICHIER_DES_STORIES, ecrireJsonl(stories.map((story) => ({ story }))), avantStories]])
    if (contenu !== avant) {
      await w.ecrireFichier(chemin, contenu);
      ecrits.push(chemin);
    }
  if (ecrits.length)
    await w.commiter(`docs(skraft): leçons après ${slug}`, ecrits);
  return { nouvelles: apres.length - lecons.length, validees: apres.filter((l) => l.statut === "validee").length, enAttente: restants.map((g) => g.signature), recidives: ligneDesRecidives(apres) };
}

/** La ligne du bilan. */
export function ligneDesLecons(r) {
  if (!r || (!r.nouvelles && !r.validees && !r.enAttente.length && !r.recidives))
    return null;
  const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
  return [
    `Leçons : ${pluriel(r.nouvelles, "nouvelle")}, ${pluriel(r.validees, "validée")} au total (${FICHIER_DES_LECONS}).`,
    ...(r.enAttente.length ? [`Groupes d'erreurs sans leçon acceptée, repris au prochain run : ${r.enAttente.join(", ")}.`] : []),
    ...(r.recidives ? [r.recidives] : []),
  ].join(" ");
}
