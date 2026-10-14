import { adrId, parseAdr, parseSupersessions } from "./adr.js";
import { extractCodeIdentifiers, extractPascalIdentifiers } from "./text-analysis.js";

/** Documents de conception attendus (§6.2) et sources des noms du modèle. */
export const MODEL_DOCS = ["event-model.md", "domain-model.md"] as const;
export const CITING_DOCS = ["contracts.md", "diagrams.md"] as const;

export interface DesignInput {
  /** Contenu des documents de `.skraft/<slug>/design/`, par nom de fichier. */
  docs: Record<string, string>;
  /** Tous les ADR du dépôt après la phase ; `isNew` pour ceux créés pendant la phase. */
  adrs: { path: string; md: string; isNew: boolean }[];
  supersessions: string;
  /** ADR qui existaient au début de la phase et ont été modifiés ou supprimés. */
  modifiedExistingAdrs: string[];
}

/**
 * Porte cohérence (code) : en-têtes des nouveaux ADR, numérotation continue, noms cités présents
 * dans le modèle, remplacements consignés des deux côtés, ADR existants inchangés.
 */
export function checkDesign(i: DesignInput): string[] {
  const reasons: string[] = [];

  if (i.docs["event-model.md"] === undefined) reasons.push("Document de conception manquant : event-model.md.");
  // Asymétrie voulue : un document CITE un nom en l'écrivant seul entre backticks, mais le modèle
  // le DÉFINIT n'importe où dans son code (signature dans un bloc, appel `Taux.AppliqueA(x)`).
  const known = new Set(MODEL_DOCS.flatMap((d) => extractCodeIdentifiers(i.docs[d] ?? "")));
  for (const doc of CITING_DOCS) {
    for (const id of extractPascalIdentifiers(i.docs[doc] ?? ""))
      if (!known.has(id)) reasons.push(`\`${id}\` cité dans ${doc} n'existe pas dans ${MODEL_DOCS.join(" ni dans ")}.`);
  }

  for (const x of commandesSansEvenement(i.docs["event-model.md"] ?? ""))
    reasons.push(`Commande \`${x}\` : aucun événement dans event-model.md. Chaque commande produit au moins un événement : « Commande \`${x}\` → événement \`…\` ».`);
  for (const r of relationsSansPatron(i.docs["context-map.md"] ?? ""))
    reasons.push(`context-map.md : la relation « ${r} » ne nomme aucun patron (ACL, Conformist, Shared Kernel, Customer-Supplier, Open Host Service, Published Language, Partnership, Separate Ways).`);

  reasons.push(...matriceDeCoherence(i).incoherences);

  for (const p of i.modifiedExistingAdrs)
    reasons.push(`ADR existant modifié : ${p} (les ADR sont append-only ; en rédiger un nouveau qui le remplace).`);

  const parsed = i.adrs.map((a) => ({ ...a, adr: parseAdr(a.md) }));
  for (const a of parsed.filter((x) => x.isNew)) {
    if (!a.adr.id) reasons.push(`${a.path} : titre « # ADR-NNN — titre » absent.`);
    for (const m of a.adr.missing) reasons.push(`${a.path} : section manquante « ${m} ».`);
    if (a.adr.status && a.adr.status !== "Proposed") reasons.push(`${a.path} : statut ${a.adr.status}, Proposed attendu.`);

    // Le nom de fichier nomme le SUJET ; le verdict vit dans `Statut`, et lui seul change quand la
    // décision évolue. Un verdict dans le nom oblige à renommer le fichier — donc à casser tous les
    // liens qui le citent. Suffixe seulement : « rejet-des-paiements » est un sujet légitime.
    const suffixe = /-(rejected|accepted|deprecated|superseded|rejete|rejeté|accepte|accepté)\.md$/i.exec(a.path);
    if (suffixe)
      reasons.push(
        `${a.path} : le nom de fichier porte un verdict (« ${suffixe[1]} »). Il doit nommer le sujet ; le verdict appartient au champ « Statut ».`,
      );

    // Un ADR justifie un choix entre options ; « éviter X », « toujours Y » n'en est pas un — c'est
    // une bonne pratique, qui relève du linter, d'une skill ou d'une convention, pas d'une décision
    // d'architecture à ratifier.
    const pratique = /^\s*(?:ne pas |éviter |eviter |toujours |jamais |avoid |always |never |no(?:t)? )/i.exec(a.adr.title ?? "");
    if (pratique)
      reasons.push(
        `${a.path} : « ${a.adr.title} » énonce une bonne pratique, pas une décision entre options. Un ADR arbitre un choix ; une règle de ce genre relève d'une convention ou du linter.`,
      );
  }

  const numbers = parsed.map((a) => a.adr.number).filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  const seen = new Set<number>();
  for (const n of numbers) {
    if (seen.has(n)) reasons.push(`Numérotation des ADR : ${adrId(n)} en double.`);
    seen.add(n);
  }
  // Seuls les trous que cette phase creuse sont reprochés : un ADR archivé avant la story
  // laisse un trou que l'agent ne peut pas combler, et le lui reprocher ferait échouer DESIGN
  // à chaque tentative, jusqu'à épuisement du budget.
  const dejaLa = parsed.filter((a) => !a.isNew).map((a) => a.adr.number).filter((n) => Number.isFinite(n));
  const depuis = (dejaLa.length ? Math.max(...dejaLa) : 0) + 1;
  const max = numbers.at(-1) ?? 0;
  for (let n = depuis; n <= max; n++) if (!seen.has(n)) reasons.push(`Numérotation des ADR : ${adrId(n)} manque.`);

  const registry = parseSupersessions(i.supersessions);
  for (const a of parsed.filter((x) => x.isNew))
    for (const replaced of a.adr.supersedes)
      if (!registry.some((r) => r.by === a.adr.id && r.replaced === replaced))
        reasons.push(`${a.adr.id} remplace ${replaced} mais le registre supersessions.md ne le mentionne pas.`);
  for (const r of registry) {
    const by = parsed.find((a) => a.adr.id === r.by);
    if (!by?.adr.supersedes.includes(r.replaced)) reasons.push(`supersessions.md indique qu'${r.by} remplace ${r.replaced}, mais ${r.by} ne le déclare pas.`);
  }
  return reasons;
}

/**
 * Commandes de `event-model.md` sans événement (G8 de skraft-plugin v1.6.1, solution-architect-reviewer,
 * vérifié ici par le code). Une commande est un nom écrit « Commande `X` » ; elle est reliée quand une
 * ligne la fait suivre d'une flèche et d'un nom (« `X` → événement `Y` »), ou quand une ligne de
 * tableau la met à côté d'un autre nom. Une requête n'est pas une commande : elle n'en a pas besoin.
 */
export function commandesSansEvenement(eventModel: string): string[] {
  const commandes = [...new Set([...eventModel.matchAll(/\b(?:Commande|Command)\s+`([A-Z]\w*)`/g)].map((m) => m[1]!))];
  const lignes = eventModel.split("\n");
  const reliee = (x: string) =>
    lignes.some((l) => {
      const i = l.indexOf(`\`${x}\``);
      if (i < 0) return false;
      if (l.trim().startsWith("|")) return [...l.matchAll(/`([A-Z]\w*)`/g)].some((m) => m[1] !== x);
      const fleche = /→|->/.exec(l.slice(i));
      return fleche !== null && /`[A-Z]\w*`/.test(l.slice(i + fleche.index + fleche[0].length));
    });
  return commandes.filter((x) => !reliee(x));
}

const PATRONS = /\bACL\b|anti-?corruption|conformist|conformiste|shared kernel|noyau partag|customer[- ]supplier|client[- ]fournisseur|open host|published language|langage publi|partnership|partenariat|separate ways|chemins s[ée]par/i;

/** Relations de `context-map.md` qui ne nomment aucun patron (G6 de skraft-plugin v1.6.1). */
export function relationsSansPatron(contextMap: string): string[] {
  const out: string[] = [];
  for (const l of contextMap.split("\n")) {
    const m = /`([A-Z]\w*)`\s*(?:→|->|↔|<->)\s*`([A-Z]\w*)`/.exec(l);
    if (m && !PATRONS.test(l)) out.push(`\`${m[1]}\` → \`${m[2]}\``);
  }
  return out;
}

/**
 * Matrice de cohérence (G10 de skraft-plugin v1.6.1). Chez le plugin, l'architecte la remplit puis se
 * déclare `consistency-gate: PASS` ; ici, le code relève la catégorie donnée à chaque nom dans chaque
 * document (« Commande `X` », « objet-valeur `Y` ») et juge seul. Sont incompatibles, comme chez le
 * plugin : commande et requête, entité et objet-valeur, agrégat et service de domaine.
 */
export type Categorie = "command" | "query" | "event" | "aggregate" | "entity" | "valueObject" | "domainService" | "repository" | "readModel";

const LIBELLES: [Categorie, string[]][] = [
  ["command", ["commande", "command"]],
  ["query", ["requête", "requete", "query"]],
  ["event", ["événement de domaine", "domain event", "événement", "evenement", "event"]],
  ["aggregate", ["racine d'agrégat", "aggregate root", "agrégat", "agregat", "aggregate"]],
  ["entity", ["entité", "entite", "entity"]],
  ["valueObject", ["objet-valeur", "objet valeur", "value object", "vo"]],
  ["domainService", ["service de domaine", "domain service"]],
  ["repository", ["interface de dépôt", "dépôt", "depot", "repository"]],
  ["readModel", ["read model", "vue", "view"]],
];
const NOM_DE: Record<Categorie, string> = {
  command: "Commande",
  query: "Requête",
  event: "Événement",
  aggregate: "Agrégat",
  entity: "Entité",
  valueObject: "Objet-valeur",
  domainService: "Service de domaine",
  repository: "Dépôt",
  readModel: "Vue",
};
const INCOMPATIBLES: [Categorie, Categorie][] = [
  ["command", "query"],
  ["entity", "valueObject"],
  ["aggregate", "domainService"],
];
// Libellé insensible à la casse (« Commande », « commande », « VO »), nom en PascalCase strict : pas
// de drapeau `i`, qui ferait aussi accepter un nom en minuscules.
const ALTERNATIVES = [...new Set(LIBELLES.flatMap(([, ls]) => ls.flatMap((l) => [l, l[0]!.toUpperCase() + l.slice(1), l.toUpperCase()])))]
  .sort((a, b) => b.length - a.length)
  .map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const CLASSE = new RegExp(`(?<![\\p{L}-])(${ALTERNATIVES.join("|")})\\s+\`([A-Z]\\w*)\``, "gu");
const categorieDe = (libelle: string): Categorie => LIBELLES.find(([, ls]) => ls.includes(libelle.toLowerCase()))![0];

/** Catégories données à chaque nom dans un document. */
function classements(md: string): Map<string, Categorie[]> {
  const m = new Map<string, Categorie[]>();
  for (const x of md.matchAll(CLASSE)) {
    const c = categorieDe(x[1]!);
    const deja = m.get(x[2]!) ?? [];
    if (!deja.includes(c)) m.set(x[2]!, [...deja, c]);
  }
  return m;
}

export interface LigneDeMatrice {
  concept: string;
  /** Catégories relevées, par document où le nom est classé. */
  cellules: Record<string, Categorie[]>;
  verdict: "PASS" | "FAIL";
}
export interface Matrice {
  colonnes: string[];
  lignes: LigneDeMatrice[];
  incoherences: string[];
  verdict: "PASS" | "FAIL";
}

/** Documents descriptifs, puis nouveaux ADR qui classent au moins un nom. */
export function matriceDeCoherence(i: DesignInput): Matrice {
  const sources: [string, Map<string, Categorie[]>][] = [];
  for (const d of [...MODEL_DOCS, ...CITING_DOCS]) if (i.docs[d] !== undefined) sources.push([d, classements(i.docs[d]!)]);
  for (const a of i.adrs.filter((x) => x.isNew)) {
    const c = classements(a.md);
    if (c.size) sources.push([parseAdr(a.md).id ?? a.path, c]);
  }
  const concepts: string[] = [];
  for (const [, c] of sources) for (const n of c.keys()) if (!concepts.includes(n)) concepts.push(n);
  const incoherences: string[] = [];
  const lignes = concepts.map((concept): LigneDeMatrice => {
    const cellules: Record<string, Categorie[]> = {};
    for (const [s, c] of sources) if (c.has(concept)) cellules[s] = c.get(concept)!;
    const ou = (cat: Categorie) => Object.keys(cellules).filter((s) => cellules[s]!.includes(cat));
    let verdict: "PASS" | "FAIL" = "PASS";
    for (const paire of INCOMPATIBLES) {
      if (!ou(paire[0]).length || !ou(paire[1]).length) continue;
      verdict = "FAIL";
      const rang = (cat: Categorie) => Object.keys(cellules).findIndex((s) => cellules[s]!.includes(cat));
      const [a, b] = rang(paire[0]) <= rang(paire[1]) ? paire : [paire[1], paire[0]];
      incoherences.push(`\`${concept}\` est classé ${NOM_DE[a]} (${ou(a).join(", ")}) et ${NOM_DE[b]} (${ou(b).join(", ")}) : catégories incompatibles (matrice de cohérence).`);
    }
    return { concept, cellules, verdict };
  });
  return { colonnes: sources.map(([s]) => s), lignes, incoherences, verdict: incoherences.length ? "FAIL" : "PASS" };
}

/** La matrice en Markdown, écrite par le code dans `design/consistency-matrix.md`. */
export function matriceMarkdown(m: Matrice): string {
  const cellule = (cs: Categorie[] | undefined) => (cs?.length ? cs.map((c) => NOM_DE[c]).join(" + ") : "—");
  return [
    "# Matrice de cohérence",
    "",
    "Écrite par le code à chaque essai de DESIGN, d'après la catégorie donnée à chaque nom dans chaque document. Ne pas la modifier.",
    "",
    `| Concept | ${m.colonnes.join(" | ")} | Verdict |`,
    `|---|${m.colonnes.map(() => "---|").join("")}---|`,
    ...m.lignes.map((l) => `| \`${l.concept}\` | ${m.colonnes.map((c) => cellule(l.cellules[c])).join(" | ")} | ${l.verdict} |`),
    "",
    `consistency-gate: ${m.verdict}`,
    "",
  ].join("\n");
}
