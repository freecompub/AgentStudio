import { detecterBdd, partiesTrouvees, proposeProfile, type DetectionBdd, type IndicesDuProjet, type StackProfile } from "@agent-studio/stack-adapters";

/**
 * La pile découverte par un agent, vérifiée par le code (ADR 0076). L'agent propose ; ce fichier dit
 * ce qu'on lui donne (les indices du code) et ce que le code exige d'une proposition avant qu'elle
 * puisse être écrite. Pur : l'agent, la lecture d'une pile et son exécution sont injectés.
 */

/** Une pile proposée : sa racine (`.` pour le projet entier), et son profil en YAML. */
export interface PileProposee {
  racine: string;
  nom?: string;
  yaml: string;
}

export interface DemandeDecouverte {
  /** Les faits de départ, en Markdown : ce que le code a trouvé. */
  indices: string;
  /** La proposition précédente et les motifs de son refus, pour l'essai suivant. */
  precedent?: { piles: PileProposee[]; motifs: string[] };
}

export type ReponseDecouverte = { piles: PileProposee[]; justification: string } | { question: string; choix: string[] } | { erreur: string };

export interface Decouverte {
  decouvrir(d: DemandeDecouverte): Promise<ReponseDecouverte>;
  /**
   * Accord sur les programmes hors de la liste (ADR 0075), puis schéma : jamais d'exécution avant.
   * `racine` : celle de la pile, relative au projet ; ses `outils` sont jugés contre le projet.
   */
  lirePile(yaml: string, racine?: string): Promise<{ profile: StackProfile } | { error: string }>;
}

/** Le budget d'essais, appliqué par le code. */
export const ESSAIS_DE_DECOUVERTE = 3;

/** Au-delà, l'arborescence est tronquée : l'agent peut lire le reste avec ses outils. */
const FICHIERS_MONTRES = 400;

/** Une partie du projet : ses fichiers et manifestes, chemins relatifs à sa racine. */
function partie(indices: IndicesDuProjet, racine: string) {
  const sous = (p: string) => (racine === "." ? p : p.startsWith(`${racine}/`) ? p.slice(racine.length + 1) : null);
  const fichiers = (indices.arborescence ?? indices.fichiers).flatMap((f) => sous(f) ?? []);
  const manifestes = (indices.manifestes ?? []).flatMap((m) => {
    const p = sous(m.path);
    return p === null ? [] : [{ path: p, content: m.content }];
  });
  return { fichiers, manifestes };
}

/** Le BDD que montre une racine du projet. */
export function bddSous(indices: IndicesDuProjet, racine: string): DetectionBdd {
  return detecterBdd(partie(indices, racine));
}

/** Les faits de départ de l'agent, en Markdown. */
export function indicesPourLAgent(o: { indices: IndicesDuProjet; sousProjets: readonly { racine: string; indices: IndicesDuProjet }[]; sansBdd: boolean }): string {
  const arbo = o.indices.arborescence ?? o.indices.fichiers;
  const liste = (xs: readonly string[]) => (xs.length ? xs.map((x) => `- \`${x}\``).join("\n") : "(aucun)");
  const sections = [
    `## Fichiers à la racine\n\n${liste(o.indices.fichiers)}`,
    `## Dépendances déclarées (package.json)\n\n${liste(o.indices.dependances)}`,
    `## Arborescence (${arbo.length} fichier(s)${arbo.length > FICHIERS_MONTRES ? `, les ${FICHIERS_MONTRES} premiers` : ""})\n\n${liste(arbo.slice(0, FICHIERS_MONTRES))}`,
  ];
  // Ce que reconnaissent les règles du code : un point de départ, pas une obligation.
  const racines = [{ racine: ".", indices: o.indices }, ...o.sousProjets.filter((s) => s.racine !== ".")];
  const modeles = racines.flatMap((r) => {
    const m = proposeProfile(r.indices);
    return m ? [`Racine \`${r.racine}\` :\n\n\`\`\`yaml\n${m}\`\`\``] : [];
  });
  sections.push(`## Ce que reconnaissent les règles du code\n\n${modeles.length ? modeles.join("\n\n") : "Rien : aucune règle du code ne reconnaît ce projet."}`);
  const bdd = racines.map((r) => {
    const d = bddSous(o.indices, r.racine);
    const t = partiesTrouvees(d);
    return `- Racine \`${r.racine}\` : ${t || "aucun signe de BDD"}`;
  });
  sections.push(`## BDD détecté par le code\n\n${bdd.join("\n")}`);
  if (o.sansBdd) sections.push("## Choix de l'utilisateur\n\nLe projet est **sans BDD** : déclare `bdd: false`.");
  return sections.join("\n\n");
}

/** Une pile qui a passé la vérification. */
export interface PileVerifiee extends PileProposee {
  profile: StackProfile;
}

/**
 * Ce que le code exige d'une proposition (ADR 0076 §3), dans l'ordre : racine, lecture (programmes
 * et schéma), BDD, diagnostic, canaris. Rend les motifs de refus ; aucun, la proposition est bonne.
 * Les canaris ne tournent que sur une pile dont le diagnostic est sans problème.
 */
export async function verifierPiles(
  piles: readonly PileProposee[],
  o: {
    lirePile: Decouverte["lirePile"];
    diagnostiquer(profile: StackProfile, racine: string): Promise<{ gravite: string; message: string }[]>;
    canaris?(profile: StackProfile, racine: string): Promise<{ gravite: string; message: string }[]>;
    indices: IndicesDuProjet;
    sansBdd: boolean;
  },
): Promise<{ motifs: string[]; verifiees: PileVerifiee[] }> {
  const motifs: string[] = [];
  const verifiees: PileVerifiee[] = [];
  const vues = new Set<string>();
  const problemes = (cs: readonly { gravite: string; message: string }[]) => cs.filter((c) => c.gravite === "probleme").map((c) => c.message);
  for (const p of piles) {
    const racine = p.racine.replace(/\/+$/, "") || ".";
    if (racine.startsWith("/") || /^[A-Za-z]:/.test(racine) || racine.split(/[\\/]/).includes("..")) {
      motifs.push(`Racine « ${p.racine} » refusée : elle doit être relative au projet, sans \`..\`.`);
      continue;
    }
    if (vues.has(racine)) {
      motifs.push(`Racine « ${racine} » proposée deux fois : une seule pile par racine.`);
      continue;
    }
    vues.add(racine);
    const ou = (m: string) => (racine === "." ? m : `Composant \`${racine}\` : ${m}`);
    const lu = await o.lirePile(p.yaml, racine);
    if ("error" in lu) {
      motifs.push(ou(lu.error));
      continue;
    }
    const d = bddSous(o.indices, racine);
    if (o.sansBdd && lu.profile.bdd?.length) {
      motifs.push(ou("l'utilisateur a choisi un projet sans BDD : déclare `bdd: false`."));
      continue;
    }
    if (!o.sansBdd && (d.lanceur || d.features) && lu.profile.bdd === undefined) {
      motifs.push(ou(`le projet montre des signes de BDD (${partiesTrouvees(d)}) : déclare \`bdd\` (lanceur, features, etapes), ou \`bdd: false\` s'il n'en fait pas.`));
      continue;
    }
    const diag = problemes(await o.diagnostiquer(lu.profile, racine));
    if (diag.length) {
      motifs.push(...diag.map(ou));
      continue;
    }
    let canaris: string[];
    try {
      canaris = o.canaris ? problemes(await o.canaris(lu.profile, racine)) : [];
    } catch (e) {
      // Ne pas pouvoir éprouver la pile n'est pas la déclarer saine.
      canaris = [`Les canaris n'ont pas pu être lancés : ${e instanceof Error ? e.message : String(e)}.`];
    }
    if (canaris.length) {
      motifs.push(...canaris.map(ou));
      continue;
    }
    verifiees.push({ ...p, racine, profile: lu.profile });
  }
  return { motifs, verifiees };
}
