/**
 * Préparer une user story donnée par une issue GitHub (ADR 0078), avant de lancer le workflow :
 * 1. `gh` vérifié, l'US et ses dépendances lues (le code, en lecture seule) ;
 * 2. refus si une issue qui la bloque est encore ouverte : on ne démarre pas ;
 * 3. le contexte écrit dans `.skraft/github/<ID>-contexte.md` ;
 * 4. la story `.skraft/github/<ID>.md`, reprise telle quelle si l'issue est déjà au format et sans
 *    commentaire, sinon mise en forme par un agent puis vérifiée par le code : aucune valeur qui ne
 *    vienne de l'issue, de ses commentaires ou de ses dépendances. Trois essais au plus.
 * Le format de story est celui du workflow, qu'on lit avec son propre code (`parseStory`).
 */
import { bloqueursOuverts, lireRefIssue, rendreContexte, type RefIssue, type UsGithub } from "@agent-studio/github-auth";
import { extractLiterals, normalizeLiteral, parseStory, slugOf } from "../../../workflows/skraft/story.mjs";

export interface GhLecteur {
  verifier(ref: RefIssue): Promise<{ ok: true } | { ok: false; motif: string }>;
  lire(ref: RefIssue): Promise<UsGithub>;
}

/** L'agent écrit la story dans `chemin` ; il reçoit l'US lue, son contexte et, après un refus, les motifs. */
export type MiseEnForme = (e: { us: UsGithub; contexte: string; chemin: string; identifiant: string; precedent?: { motifs: string[] } }) => Promise<{ ok: true } | { erreur: string }>;

export const ESSAIS_DE_MISE_EN_FORME = 3;

/** Les textes d'où une valeur de la story peut venir : l'issue, ses commentaires, ses dépendances. */
function sources(us: UsGithub): string[] {
  const deps = [...(us.parent ? [us.parent] : []), ...us.sousIssues, ...us.bloqueePar, ...us.bloque, ...us.citees];
  return [us.issue.titre, us.issue.corps, ...us.commentaires.map((c) => c.corps), ...deps.flatMap((i) => [i.titre, i.corps])];
}

/** Ce que rend `parseStory` (module JavaScript du workflow, non typé). */
type StoryLue = { ok: true; story: { id: string; title: string; criteria: { n: number; literals: string[] }[]; openQuestions: string[] } } | { ok: false; errors: string[] };

/** Les critères suivis d'une ligne de suite (non vide, ni critère, ni titre, ni liste). */
function criteresSurPlusieursLignes(md: string): number[] {
  const lignes = md.split("\n");
  const debut = lignes.findIndex((l) => /^##\s+crit[èe]res d'acceptation/i.test(l));
  if (debut === -1) return [];
  const coupes: number[] = [];
  let courant: number | null = null;
  for (const l of lignes.slice(debut + 1)) {
    if (/^##?\s+/.test(l)) break;
    const c = /^\s*(\d+)\.\s+/.exec(l);
    if (c) courant = Number(c[1]);
    else if (l.trim() === "") courant = null;
    else if (courant !== null && !coupes.includes(courant)) coupes.push(courant);
  }
  return coupes;
}

/** Ce que le code exige de la story : son format, son identifiant, et aucune valeur inventée dans les critères. */
function verifierStory(md: string, identifiant: string, us: UsGithub): string[] {
  const lue = parseStory(md) as StoryLue;
  if (!lue.ok) return lue.errors;
  if (lue.story.id !== identifiant) return [`Le titre doit porter l'identifiant ${identifiant} (« # ${identifiant} — <titre> »), pas ${lue.story.id}.`];
  // `parseStory` ne lit que la première ligne d'un critère : une suite indentée serait perdue.
  const coupes = criteresSurPlusieursLignes(md);
  if (coupes.length) return coupes.map((n) => `Critère ${n} : il tient sur plusieurs lignes ; écris chaque critère sur une seule ligne, sinon sa suite est perdue.`);
  // Chaque question ouverte est posée à l'utilisateur avant RESEARCH : une ligne qui n'en est pas une
  // (« Aucune : … ») serait posée quand même.
  const pasDesQuestions = lue.story.openQuestions.filter((q) => !/\?\s*$/.test(q));
  if (pasDesQuestions.length)
    return pasDesQuestions.map((q) => `Question ouverte « ${q} » : ce n'est pas une question. Écris-la comme une question (« … ? »), ou retire la section s'il n'y en a pas.`);
  const connues = new Set(sources(us).flatMap((t) => extractLiterals(t)).map(normalizeLiteral));
  return lue.story.criteria.flatMap((c) =>
    c.literals.filter((l) => !connues.has(normalizeLiteral(l))).map((l) => `Critère ${c.n} : « ${l} » ne vient ni de l'issue, ni de ses commentaires, ni de ses dépendances.`),
  );
}

/** Le lien vers le contexte, juste sous le titre : les agents de RESEARCH et DESIGN le liront. */
function avecLienContexte(md: string, ligne: string): string {
  if (md.includes(ligne)) return md;
  return md.replace(/^(#\s+.+\n)/m, `$1\n${ligne}\n`);
}

export async function preparerUsGithub(o: {
  texte: string;
  hote: string;
  gh: GhLecteur;
  lire(rel: string): Promise<string | null>;
  ecrire(rel: string, contenu: string): Promise<void>;
  /**
   * Commite ces seuls chemins sur cette branche (créée si besoin), avant le run : la story a son propre
   * commit, et le diff de chaque phase se lit sans elle (demande du responsable, 10/11).
   */
  commiter?(branche: string, chemins: string[], message: string): Promise<void>;
  mettreEnForme?: MiseEnForme;
}): Promise<{ ok: true; chemin: string; notes: string[] } | { ok: false; motif: string }> {
  const ref = lireRefIssue(o.texte, o.hote);
  if (!ref) return { ok: false, motif: `« ${o.texte} » n'est pas une issue GitHub (URL d'issue, ou org/dépôt#n).` };
  const v = await o.gh.verifier(ref);
  if (!v.ok) return v;
  let us: UsGithub;
  try {
    us = await o.gh.lire(ref);
  } catch (e) {
    return { ok: false, motif: e instanceof Error ? e.message : String(e) };
  }
  const nom = `${ref.owner}/${ref.repo}#${ref.numero}`;
  const bloqueurs = bloqueursOuverts(us);
  if (bloqueurs.length)
    return {
      ok: false,
      motif:
        `L'US ${nom} est bloquée par ${bloqueurs.map((b) => `${b.depot ?? ""}#${b.numero} « ${b.titre} » (ouverte)`).join(", ")}. ` +
        "skraft ne démarre pas tant qu'elle l'est : livre ou ferme d'abord ce qui la bloque.",
    };

  // Un identifiant en tête du titre (« US-7 — … ») l'emporte : le numéro de l'issue peut en désigner une autre.
  const enTete = /^\s*\[?([A-Za-z][\w]*-\d+)\]?\s*[—–:-]\s*(.+)$/.exec(us.issue.titre);
  const identifiant = enTete ? enTete[1]! : `US-${ref.numero}`;
  const titre = enTete ? enTete[2]!.trim() : us.issue.titre;
  const chemin = `.skraft/github/${identifiant}.md`;
  const cheminContexte = `.skraft/github/${identifiant}-contexte.md`;
  const contexte = rendreContexte(us);
  await o.ecrire(cheminContexte, contexte);
  const lien = `Issue : ${us.issue.url}. Ses commentaires et ses dépendances sont dans \`${cheminContexte}\`.`;
  // La branche est celle que le run reprendra (`skraft/<slug>`, `preparer` du workflow) : son slug vient
  // du titre écrit dans la story, qu'un agent de mise en forme a pu changer.
  const commiter = (md: string) => {
    const lue = parseStory(md) as StoryLue;
    const slug = slugOf(identifiant, lue.ok ? lue.story.title : titre);
    return o.commiter?.(`skraft/${slug}`, [chemin, cheminContexte], `docs(${slug}): story ${identifiant} depuis ${nom}`);
  };

  // Déjà au format, et rien de décidé dans les commentaires : reprise telle quelle.
  const telleQuelle = `# ${identifiant} — ${titre}\n\n${lien}\n\n${us.issue.corps.trim()}\n`;
  if (us.commentaires.length === 0 && verifierStory(telleQuelle, identifiant, us).length === 0) {
    await o.ecrire(chemin, telleQuelle);
    await commiter(telleQuelle);
    return { ok: true, chemin, notes: [`Story ${identifiant} reprise telle quelle de ${nom}.`] };
  }
  if (!o.mettreEnForme)
    return {
      ok: false,
      motif: `L'issue ${nom} n'est pas au format d'une story (critères numérotés sous « ## Critères d'acceptation »), ou ses commentaires la précisent, et aucun agent ne peut la mettre en forme ici.`,
    };

  let precedent: { motifs: string[] } | undefined;
  for (let essai = 1; essai <= ESSAIS_DE_MISE_EN_FORME; essai++) {
    const r = await o.mettreEnForme({ us, contexte, chemin, identifiant, ...(precedent ? { precedent } : {}) });
    if ("erreur" in r) return { ok: false, motif: `La mise en forme de ${nom} n'a pas abouti : ${r.erreur}` };
    const md = (await o.lire(chemin)) ?? "";
    const motifs = verifierStory(md, identifiant, us);
    if (!motifs.length) {
      await o.ecrire(chemin, avecLienContexte(md, lien));
      await commiter(md);
      return { ok: true, chemin, notes: [`Story ${identifiant} mise en forme par un agent à partir de ${nom}, vérifiée par le code.`] };
    }
    precedent = { motifs };
  }
  return { ok: false, motif: `La story mise en forme pour ${nom} a été refusée ${ESSAIS_DE_MISE_EN_FORME} fois. Derniers motifs :\n${precedent!.motifs.map((m) => `- ${m}`).join("\n")}` };
}
