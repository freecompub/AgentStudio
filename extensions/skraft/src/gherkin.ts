import type { ExtensionContext } from "@agent-studio/extension-api";
import type { SourceFile } from "./distill.js";

/**
 * Porte `gherkin` (§7.3) : la partie **mécanisable** de la skill `bdd-methodology`, portée en code.
 *
 * Pourquoi une porte et pas seulement une consigne dans le prompt. Les tests d'acceptance sont
 * **gelés** à la sortie de DISTILL : un scénario couplé à un détail technique ne devient pas
 * seulement médiocre, il devient la spécification que toute la phase de livraison doit satisfaire,
 * et plus personne ne peut le corriger. Ailleurs, une faiblesse de méthode coûte un réessai ; ici
 * elle se fige. La consigne améliore les chances, la porte donne la garantie.
 *
 * Ce que cette porte ne fait pas : juger le style, la pertinence ou la couverture. Elle refuse ce
 * qui est reconnaissable **sans interprétation** — un verbe HTTP, un nom de classe, deux
 * déclencheurs. Le reste appartient aux lentilles, qui disposent des mêmes critères sous leur forme
 * d'origine (`acceptance-review-criteria`).
 */

/**
 * Frontières de mot **sûres avec les accents**. `\b` de JavaScript ne connaît que `[A-Za-z0-9_]` :
 * après « donné » ou avant « ça », il ne voit aucune transition et ne reconnaît rien. Tout le
 * contenu de ce fichier étant français, s'en remettre à `\b` rendait la porte silencieuse.
 */
const AVANT = "(?<![A-Za-zÀ-ÿ0-9])";
const APRES = "(?![A-Za-zÀ-ÿ0-9])";

/** Mots-clés d'étape, français et anglais : un projet écrit ses scénarios dans sa langue. */
const DECLENCHEUR = new RegExp(`^\\s*(?:Quand|When)${APRES}`, "i");
const ASSERTION = new RegExp(`^\\s*(?:Alors|Then)${APRES}`, "i");
const ETAPE = new RegExp(`^\\s*(?:Étant donné|Etant donné|Soit|Quand|Alors|Et|Mais|Given|When|Then|And|But)${APRES}`, "i");

/** Au-delà, le scénario décrit plusieurs comportements (`bdd-methodology`, règle de granularité). */
const ETAPES_MAX = 7;

interface Motif {
  /** Reconnu dans le TEXTE d'une étape. */
  re: RegExp;
  dit: (trouve: string) => string;
}

/**
 * Fuites de couche. Chaque motif vise une forme que le métier n'emploie jamais — et non un simple
 * mot, qui serait trop souvent légitime : « base » est courant, « base de données » ne l'est pas.
 */
const FUITES: Motif[] = [
  { re: new RegExp(`${AVANT}(?:POST|GET|PUT|DELETE|PATCH|HEAD)${APRES}`), dit: (t) => `verbe HTTP « ${t} »` },
  { re: /\/(?:api|v\d+)\/|\s\/[a-z][\w-]*\/[\w{}:-]+/i, dit: (t) => `chemin d'URL « ${t.trim()} »` },
  // Un identifiant à plusieurs bosses — `CalculDuPanier`, `PanierRepository` — n'apparaît jamais
  // dans une phrase métier. Un mot simplement capitalisé (`Panier`) reste permis : c'en serait un.
  { re: new RegExp(`${AVANT}[A-Z][a-zÀ-ÿ0-9]+(?:[A-Z][a-zÀ-ÿ0-9]+)+${APRES}`), dit: (t) => `nom de classe « ${t} »` },
  {
    re: new RegExp(`${AVANT}(?:bases? de données|database|file d'attente|broker|DTO|schéma SQL|table SQL)${APRES}`, "i"),
    dit: (t) => `vocabulaire d'infrastructure « ${t} »`,
  },
];

/** Assertions qui n'affirment rien d'observable. */
const ASSERTION_VAGUE = new RegExp(
  `${AVANT}(?:[çc]a marche|c'est correct|tout est ok|c'est ok|it works|it is correct|everything is fine)${APRES}`,
  "i",
);

/** Tags qui nomment une couche technique au lieu d'un comportement. */
const TAG_TECHNIQUE = /@(?:frontend|backend|api|http|ui|infrastructure|database|sql)\b/i;

interface Scenario {
  path: string;
  titre: string;
  tags: string;
  etapes: string[];
}

/** Découpe un fichier `.feature` en scénarios, en ignorant les commentaires et les tableaux. */
function scenarios(fichier: SourceFile): Scenario[] {
  const out: Scenario[] = [];
  let courant: Scenario | null = null;
  let tags = "";
  for (const brute of fichier.content.split("\n")) {
    const ligne = brute.replace(/\r$/, "");
    if (/^\s*#/.test(ligne)) continue; // commentaire : jamais une étape
    if (/^\s*@/.test(ligne)) {
      tags = `${tags} ${ligne.trim()}`.trim();
      continue;
    }
    const titre = /^\s*(?:Scénario|Scenario|Plan du scénario|Scenario Outline)\s*:\s*(.*)$/i.exec(ligne);
    if (titre) {
      if (courant) out.push(courant);
      courant = { path: fichier.path, titre: titre[1]!.trim(), tags, etapes: [] };
      tags = "";
      continue;
    }
    if (courant && ETAPE.test(ligne)) courant.etapes.push(ligne.trim());
  }
  if (courant) out.push(courant);
  return out;
}

/**
 * Motifs de refus, un par manquement, nommant le fichier et le scénario pour que la correction
 * soit possible sans chercher.
 */
export function checkGherkin(features: SourceFile[]): string[] {
  const reasons: string[] = [];
  for (const f of features)
    for (const s of scenarios(f)) {
      const ou = `${f.path}, scénario « ${s.titre} »`;

      for (const etape of s.etapes)
        for (const { re, dit } of FUITES) {
          const m = re.exec(etape);
          if (m) reasons.push(`${ou} : ${dit(m[0])} dans « ${etape} ». Le Gherkin décrit ce que fait le métier, pas comment le code s'y prend.`);
        }

      const declencheurs = s.etapes.filter((e) => DECLENCHEUR.test(e));
      if (declencheurs.length > 1)
        reasons.push(`${ou} : ${declencheurs.length} étapes « Quand ». Un seul déclencheur par scénario — deux comportements font deux scénarios.`);

      for (const a of s.etapes.filter((e) => ASSERTION.test(e) && ASSERTION_VAGUE.test(e)))
        reasons.push(`${ou} : l'assertion « ${a} » ne nomme aucun résultat métier observable.`);

      if (s.etapes.length > ETAPES_MAX)
        reasons.push(`${ou} : ${s.etapes.length} étapes (maximum ${ETAPES_MAX}). Un scénario aussi long décrit plusieurs comportements.`);

      const tag = TAG_TECHNIQUE.exec(s.tags);
      if (tag) reasons.push(`${ou} : le tag « ${tag[0]} » nomme une couche technique. Les tags décrivent un comportement (@happy-path, @error-case).`);
    }
  return reasons;
}

// ---------- BDD (ADR 0074) ----------------------------------------------------------------

/** Où vit le Gherkin de la story : les dossiers `features` des couples BDD, sinon le dossier de DISTILL. */
export function dossiersDesFeatures(slug: string, bdd: readonly { lanceur?: string; features: string; etapes?: string }[] | undefined): string[] {
  return bdd?.length ? bdd.map((c) => c.features) : [`.skraft/${slug}/distill/features`];
}

/**
 * En BDD, le titre de chaque scénario `@ac-<n>` commence par `AC-<n>` (décision du 08/11) : c'est
 * ce qui le relie à son test, le lanceur nommant le test d'après le titre (Reqnroll : `AC_1LeClient…`)
 * et l'enregistreur JUnit ne gardant pas le tag.
 */
export function checkTitresBdd(features: readonly SourceFile[]): string[] {
  const out: string[] = [];
  for (const f of features)
    for (const sc of scenarios(f)) {
      const n = /@ac-(\d+)\b/i.exec(sc.tags)?.[1];
      if (n === undefined) continue;
      if (new RegExp(`^ac[-_ ]?${n}(?![0-9])`, "i").test(sc.titre)) continue;
      out.push(`${f.path} : le titre du scénario « ${sc.titre} » (@ac-${n}) doit commencer par « AC-${n} » : c'est ce qui le relie à son test.`);
    }
  return out;
}

/** Début d'un scénario : mêmes mots-clés que `scenarios`. */
const TITRE_SCENARIO = /^\s*(?:Scénario|Scenario|Plan du scénario|Scenario Outline)\s*:\s*(.*)$/i;
/**
 * Un fichier `.feature` en en-tête (langue, tags et titre de la fonctionnalité, contexte partagé) et
 * blocs de scénario, chacun avec ses tags. Texte brut, pour comparer deux versions d'un fichier.
 */
function decouper(content: string): { entete: string[]; blocs: string[][] } {
  const lignes = content.split("\n").map((l) => l.replace(/\s+$/, ""));
  const debuts: number[] = [];
  lignes.forEach((l, i) => {
    if (!TITRE_SCENARIO.test(l)) return;
    let d = i;
    while (d > 0 && /^\s*@/.test(lignes[d - 1]!)) d--;
    debuts.push(d);
  });
  return {
    entete: lignes.slice(0, debuts[0] ?? lignes.length),
    blocs: debuts.map((d, k) => lignes.slice(d, debuts[k + 1] ?? lignes.length)),
  };
}
/** Lignes vides et espaces de fin ne changent pas un scénario. */
const cle = (lignes: readonly string[]) => lignes.map((l) => l.trim()).filter(Boolean).join("\n");
const titreDe = (bloc: readonly string[]) => TITRE_SCENARIO.exec(bloc.find((l) => TITRE_SCENARIO.test(l)) ?? "")?.[1]?.trim() ?? "";
const NE_PAS_TOUCHER = "Il appartient à une story précédente : n'y touche pas ; si cette story change ce comportement, pose la question.";
/**
 * Le Gherkin de la story (ADR 0074, run du 08/11) : en BDD, le dossier `features` contient aussi les
 * scénarios des stories précédentes. `avant` est relevé au début de DISTILL. Les scénarios nouveaux
 * sont ceux de la story, rendus avec l'en-tête de leur fichier : ce sont eux seuls que les portes
 * jugent et que DELIVER reçoit. Un scénario existant modifié ou supprimé, ou l'en-tête d'un fichier
 * existant modifié, est refusé (décision du responsable le 08/11) : il change une autre story.
 */
export function gherkinDeLaStory(avant: readonly SourceFile[], apres: readonly SourceFile[]): { features: SourceFile[]; modifies: string[] } {
  const modifies: string[] = [];
  const maintenant = new Map(apres.map((f) => [f.path, decouper(f.content)]));
  const anciens = new Map<string, Set<string>>();
  for (const f of avant) {
    const a = decouper(f.content);
    anciens.set(f.path, new Set(a.blocs.map(cle)));
    const n = maintenant.get(f.path);
    if (n && cle(a.entete) !== cle(n.entete))
      modifies.push(`${f.path} : l'en-tête du fichier (fonctionnalité, contexte partagé) existait avant DISTILL et a été modifié. ${NE_PAS_TOUCHER}`);
    const restants = new Set((n?.blocs ?? []).map(cle));
    for (const b of a.blocs)
      if (!restants.has(cle(b))) modifies.push(`${f.path} : le scénario « ${titreDe(b)} » existait avant DISTILL et a été modifié ou supprimé. ${NE_PAS_TOUCHER}`);
  }
  const features: SourceFile[] = [];
  for (const f of apres) {
    const n = maintenant.get(f.path)!;
    const vus = anciens.get(f.path) ?? new Set<string>();
    const neufs = n.blocs.filter((b) => !vus.has(cle(b)));
    if (neufs.length) features.push({ path: f.path, content: `${[...n.entete, ...neufs.flat()].join("\n")}\n` });
  }
  return { features, modifies };
}

/** Les `.feature` de la story, sur le disque : dossiers `features` en BDD, sinon celui de DISTILL. */
export async function gherkinDuDisque(ctx: ExtensionContext, slug: string): Promise<SourceFile[]> {
  const dossiers = dossiersDesFeatures(slug, ctx.stack.bdd);
  const chemins = (await ctx.workspace.listFiles()).filter((f) => dossiers.some((x) => f.startsWith(`${x}/`)) && f.endsWith(".feature"));
  return Promise.all(chemins.map(async (path) => ({ path, content: await ctx.workspace.readFile(path) })));
}
